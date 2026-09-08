//! Line, area, bar and dial rendering. With `FillMode::Braille` each cell
//! carries a 2x4 pixel matrix, so a 40x10 panel plots at 80x40 resolution.

use std::collections::HashMap;

use crate::buffer::{Attrs, Style};
use crate::color::{round_half_up, Color, Gradient};
use crate::graphics::blocks::{horizontal_glyph, vertical_glyph, FillMode};
use crate::graphics::braille::BrailleCanvas;
use crate::surface::{Surface, TextOptions};
use crate::theme::series_color;
use crate::unicode::Align;

#[derive(Clone, Debug, Default)]
pub struct Series {
    pub values: Vec<f64>,
    pub color: Option<Color>,
    pub label: Option<String>,
    /// Shade the area beneath the line.
    pub fill: Option<bool>,
}

impl Series {
    pub fn new(values: impl Into<Vec<f64>>) -> Series {
        Series { values: values.into(), ..Default::default() }
    }

    pub fn color(mut self, c: Color) -> Series {
        self.color = Some(c);
        self
    }

    pub fn label(mut self, l: impl Into<String>) -> Series {
        self.label = Some(l.into());
        self
    }

    pub fn filled(mut self) -> Series {
        self.fill = Some(true);
        self
    }
}

#[derive(Clone, Debug, Default)]
pub struct PlotOptions {
    /// Braille is sharpest; block and ascii are the graceful degradations.
    pub mode: Option<FillMode>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub color: Option<Color>,
    /// Color the plot along a ramp by value rather than one flat color.
    pub colors: Option<Vec<Color>>,
    pub fill: Option<bool>,
    /// 0-1 opacity of the area fill against the background.
    pub fill_alpha: Option<f64>,
    pub background: Option<Color>,
    /// Draw a faint dotted grid behind the series.
    pub grid: bool,
    pub grid_color: Option<Color>,
    pub baseline: Option<f64>,
}

/// Every glyph ramp entry is a single character; this is the reference
/// implementation's `codePointAt(0)` on a one-glyph string.
pub(crate) fn first_char(s: &str) -> char {
    s.chars().next().unwrap_or(' ')
}

/// A finite number, or `None` — `sum / count` with no samples is NaN.
fn bound(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.is_finite())
}

fn extent(series: &[Series], options: &PlotOptions) -> (f64, f64) {
    // A caller's axis bound is data, and data can be NaN. Falling back to the
    // computed extent keeps every plotted coordinate finite.
    let mut min = bound(options.min);
    let mut max = bound(options.max);
    if min.is_none() || max.is_none() {
        let mut lo = f64::INFINITY;
        let mut hi = f64::NEG_INFINITY;
        for s in series {
            for &v in &s.values {
                if !v.is_finite() {
                    continue;
                }
                if v < lo {
                    lo = v;
                }
                if v > hi {
                    hi = v;
                }
            }
        }
        if !lo.is_finite() {
            lo = 0.0;
            hi = 1.0;
        }
        min = min.or(Some(lo.min(0.0)));
        max = max.or(Some(hi));
    }
    let min = min.unwrap();
    let mut max = max.unwrap();
    if max <= min {
        max = min + 1.0;
    }
    (min, max)
}

/// The trailing window of a series that will actually be drawn.
fn tail(values: &[f64], columns: usize) -> Vec<f64> {
    let n = columns.max(1);
    if values.len() <= n {
        values.to_vec()
    } else {
        values[values.len() - n..].to_vec()
    }
}

fn draw_grid(surface: &Surface, color: Color, bg: Option<Color>) {
    let (w, h) = (surface.width(), surface.height());
    let step = (h / 4).max(2);
    let mut y = 0usize;
    while y < h {
        let mut x = 0usize;
        while x < w {
            surface.glyph(x as isize, y as isize, '·', &Style { fg: Some(color), bg, attrs: None });
            x += 2;
        }
        y += step;
    }
}

/// Draw one or more series across the whole surface.
pub fn plot(surface: &Surface, series: &[Series], options: &PlotOptions) {
    if surface.is_empty() || series.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let mode = options.mode.unwrap_or(FillMode::Braille);
    let bg = options.background;
    let w = surface.width();
    let h = surface.height();

    // Only the samples that will actually be drawn should set the scale, or an
    // old spike still sitting in the history buffer flattens the live line.
    let columns = if mode == FillMode::Braille { w * 2 } else { w };
    let visible: Vec<Series> = series
        .iter()
        .map(|s| Series { values: tail(&s.values, columns), ..s.clone() })
        .collect();
    let (min, max) = extent(&visible, options);
    let span = max - min;

    if options.grid {
        let color = options
            .grid_color
            .unwrap_or_else(|| theme.border.mix(theme.background, 0.4));
        draw_grid(surface, color, bg);
    }

    if matches!(mode, FillMode::Block | FillMode::Ascii | FillMode::Half) {
        // One column per cell, newest value on the right.
        for (si, s) in visible.iter().enumerate() {
            let color = s.color.or(options.color).unwrap_or_else(|| series_color(&theme, si as i64));
            let ramp = options.colors.as_ref().map(|c| Gradient::new(c));
            for x in 0..w {
                let idx = s.values.len() as isize - w as isize + x as isize;
                let v = if idx >= 0 { s.values.get(idx as usize).copied() } else { None };
                let v = match v {
                    Some(v) if v.is_finite() => v,
                    _ => continue,
                };
                let ratio = (v - min) / span;
                let filled = ratio * h as f64;
                let full = filled.floor();
                let cell_color = ramp.as_ref().map(|r| r.sample(ratio)).unwrap_or(color);
                let style = Style { fg: Some(cell_color), bg, attrs: None };
                let full_i = if full.is_finite() { full as i64 } else { 0 };
                for k in 0..full_i.min(h as i64) {
                    surface.glyph(x as isize, h as isize - 1 - k as isize, '█', &style);
                }
                if full_i < h as i64 {
                    let glyph = vertical_glyph(filled - full, mode);
                    if glyph != " " {
                        surface.glyph(
                            x as isize,
                            h as isize - 1 - full_i as isize,
                            first_char(glyph),
                            &style,
                        );
                    }
                }
            }
        }
        return;
    }

    // Braille: build one canvas per series so colors stay separable.
    let mut canvas = BrailleCanvas::new(w, h);
    let px = canvas.width;
    let py = canvas.height;

    for (si, s) in visible.iter().enumerate() {
        canvas.clear();
        let color = s.color.or(options.color).unwrap_or_else(|| series_color(&theme, si as i64));
        if s.values.is_empty() {
            continue;
        }
        let count = s.values.len().min(px);
        let start = s.values.len() - count;
        let mut points: Vec<(f64, f64)> = Vec::with_capacity(count);
        for i in 0..count {
            let v = s.values[start + i];
            if !v.is_finite() {
                continue;
            }
            let ratio = (v - min) / span;
            let x = if count == 1 {
                px as f64 - 1.0
            } else {
                round_half_up(i as f64 / (count - 1) as f64 * (px as f64 - 1.0))
            };
            let y = round_half_up((1.0 - ratio.clamp(0.0, 1.0)) * (py as f64 - 1.0));
            points.push((x, y));
        }
        if points.is_empty() {
            continue;
        }
        if points.len() == 1 {
            canvas.pixel(points[0].0, points[0].1);
        } else {
            canvas.polyline(&points);
        }

        let want_fill = s.fill.or(options.fill).unwrap_or(false);
        let fill_alpha = options.fill_alpha.unwrap_or(0.5);
        if want_fill {
            // The area is drawn with block elements rather than Braille: eight
            // scattered dots per cell reads as noise, a block reads as an area.
            // The line stays Braille, so it keeps the sub-cell resolution.
            let base = bg.unwrap_or(theme.background);
            // The fill has to walk the same window as the line, averaging the
            // samples that land inside each cell — otherwise the area drifts
            // out of step.
            let sample_count = s.values.len().min(px);
            let sample_start = s.values.len() - sample_count;
            for x in 0..w {
                let from = sample_start + (x as f64 / w as f64 * sample_count as f64) as usize;
                let to = (from + 1).max(
                    sample_start
                        + ((x + 1) as f64 / w as f64 * sample_count as f64) as usize,
                );
                let mut sum = 0.0;
                let mut seen = 0usize;
                for i in from..to.min(s.values.len()) {
                    let sample = s.values[i];
                    if sample.is_finite() {
                        sum += sample;
                        seen += 1;
                    }
                }
                if seen == 0 {
                    continue;
                }
                let value = sum / seen as f64;
                let ratio = ((value - min) / span).clamp(0.0, 1.0);
                let filled = ratio * h as f64;
                let full = filled.floor() as i64;
                for k in 0..full.min(h as i64) {
                    let row = h as i64 - 1 - k;
                    let depth = if h <= 1 { 0.0 } else { row as f64 / (h - 1) as f64 };
                    surface.glyph(
                        x as isize,
                        row as isize,
                        '█',
                        &Style {
                            fg: Some(base.mix(color, fill_alpha * (1.0 - depth * 0.3))),
                            bg,
                            attrs: None,
                        },
                    );
                }
                if full < h as i64 {
                    let glyph = vertical_glyph(filled - filled.floor(), FillMode::Block);
                    if glyph != " " {
                        let row = h as i64 - 1 - full;
                        let depth = if h <= 1 { 0.0 } else { row as f64 / (h - 1) as f64 };
                        surface.glyph(
                            x as isize,
                            row as isize,
                            first_char(glyph),
                            &Style {
                                fg: Some(
                                    base.mix(color, fill_alpha * (1.0 - depth * 0.3) + 0.12),
                                ),
                                bg,
                                attrs: None,
                            },
                        );
                    }
                }
            }
        }

        let ramp = options.colors.as_ref().map(|c| Gradient::new(c));
        blit(
            surface,
            &canvas,
            |_col, row| match &ramp {
                None => color,
                Some(r) => r.sample(1.0 - row as f64 / (h.max(2) - 1) as f64),
            },
            bg,
        );
    }
}

/// Copy a Braille canvas onto a surface, one glyph per cell.
pub fn blit(
    surface: &Surface,
    canvas: &BrailleCanvas,
    color_at: impl Fn(usize, usize) -> Color,
    bg: Option<Color>,
) {
    for row in 0..canvas.rows {
        for col in 0..canvas.cols {
            let value = canvas.cell(col, row);
            if value == 0 {
                continue;
            }
            surface.char(
                col as isize,
                row as isize,
                value,
                &Style { fg: Some(color_at(col, row)), bg, attrs: None },
            );
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct SparklineOptions {
    pub color: Option<Color>,
    pub colors: Option<Vec<Color>>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub background: Option<Color>,
    pub mode: Option<FillMode>,
}

/// A single-row trend line. Cheap enough to put in a table cell.
pub fn sparkline(surface: &Surface, values: &[f64], options: &SparklineOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let w = surface.width();
    let windowed = tail(values, w);
    let (min, max) = extent(
        &[Series::new(windowed)],
        &PlotOptions { min: options.min, max: options.max, ..Default::default() },
    );
    let span = max - min;
    let ramp = options.colors.as_ref().map(|c| Gradient::new(c));
    let color = options.color.unwrap_or(theme.accent);
    let count = values.len().min(w);
    let start = values.len() - count;
    let offset = w - count;
    for i in 0..count {
        let v = values[start + i];
        if !v.is_finite() {
            continue;
        }
        let ratio = ((v - min) / span).clamp(0.0, 1.0);
        surface.glyph(
            (offset + i) as isize,
            0,
            first_char(vertical_glyph(ratio, options.mode.unwrap_or(FillMode::Block))),
            &Style {
                fg: Some(ramp.as_ref().map(|r| r.sample(ratio)).unwrap_or(color)),
                bg: options.background,
                attrs: None,
            },
        );
    }
}

/// How a horizontal bar's fill is drawn.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum BarStyle {
    #[default]
    Smooth,
    /// Discrete ticks with gaps, so stacked bars stay separable. The btop look.
    Segmented,
    Ascii,
}

impl BarStyle {
    pub fn parse(name: &str) -> BarStyle {
        match name {
            "segmented" => BarStyle::Segmented,
            "ascii" => BarStyle::Ascii,
            _ => BarStyle::Smooth,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct BarOptions {
    /// 0-1. Values outside are clamped.
    pub value: f64,
    pub color: Option<Color>,
    /// Color by fill level using the theme heat ramp.
    pub heat: Option<bool>,
    pub track: Option<Color>,
    pub background: Option<Color>,
    pub style: Option<BarStyle>,
    pub track_char: Option<char>,
}

/// A horizontal bar filling the surface's first row.
pub fn bar(surface: &Surface, options: &BarOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let w = surface.width();
    let ratio = options.value.clamp(0.0, 1.0);
    let style = options.style.unwrap_or(BarStyle::Smooth);
    let track_color = options.track.unwrap_or_else(|| theme.background.mix(theme.border, 0.8));
    let heat = if options.heat == Some(true) { Some(Gradient::new(&theme.heat)) } else { None };
    let color = options.color.unwrap_or(theme.primary);
    let track_char = options.track_char.unwrap_or(match style {
        BarStyle::Ascii => '-',
        BarStyle::Segmented => '▮',
        BarStyle::Smooth => '─',
    });
    let fill_char = match style {
        BarStyle::Ascii => '#',
        BarStyle::Segmented => '▮',
        BarStyle::Smooth => '█',
    };

    let filled = ratio * w as f64;
    let full = filled.floor() as i64;

    for x in 0..w as i64 {
        if x < full {
            let fg = match &heat {
                Some(g) => g.sample(if w <= 1 { ratio } else { x as f64 / (w - 1) as f64 }),
                None => color,
            };
            surface.glyph(x as isize, 0, fill_char, &Style { fg: Some(fg), bg: options.background, attrs: None });
        } else if x == full && style != BarStyle::Segmented {
            let glyph = horizontal_glyph(
                filled - filled.floor(),
                if style == BarStyle::Ascii { FillMode::Ascii } else { FillMode::Block },
            );
            let is_blank = glyph == " ";
            let fg = if is_blank {
                track_color
            } else {
                heat.as_ref().map(|g| g.sample(ratio)).unwrap_or(color)
            };
            let ch = if is_blank { track_char } else { first_char(glyph) };
            surface.glyph(
                x as isize,
                0,
                ch,
                &Style { fg: Some(fg), bg: options.background, attrs: None },
            );
        } else {
            surface.glyph(
                x as isize,
                0,
                track_char,
                &Style { fg: Some(track_color), bg: options.background, attrs: None },
            );
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct GaugeOptions {
    pub value: f64,
    pub color: Option<Color>,
    pub background: Option<Color>,
    pub label: Option<String>,
    pub heat: Option<bool>,
}

/// A semicircular dial drawn with Braille. Needs about 9x5 cells to look right.
pub fn gauge(surface: &Surface, options: &GaugeOptions) {
    if surface.is_empty() || surface.height() < 3 {
        bar(
            surface,
            &BarOptions {
                value: options.value,
                color: options.color,
                heat: options.heat,
                ..Default::default()
            },
        );
        return;
    }
    let theme = surface.theme.clone();
    let ratio = options.value.clamp(0.0, 1.0);
    let mut canvas = BrailleCanvas::new(surface.width(), surface.height());
    let cx = canvas.width as f64 / 2.0;
    let cy = canvas.height as f64 - 2.0;
    let radius = (canvas.width as f64 / 2.0 - 1.0).min(canvas.height as f64 - 3.0);
    let heat = Gradient::new(&theme.heat);

    let steps = (24.0f64).max(round_half_up(radius * 4.0)) as i64;
    for i in 0..=steps {
        let t = i as f64 / steps as f64;
        let angle = std::f64::consts::PI * (1.0 - t);
        let x = cx + angle.cos() * radius;
        let y = cy - angle.sin() * radius * 0.85;
        if t <= ratio {
            canvas.pixel(x, y);
            canvas.pixel(x, y - 1.0);
        }
    }
    let color = options
        .color
        .unwrap_or(if options.heat == Some(false) { theme.primary } else { heat.sample(ratio) });
    blit(surface, &canvas, |_, _| color, options.background);

    // Unfilled remainder of the dial, dimmed.
    let mut rest = BrailleCanvas::new(surface.width(), surface.height());
    for i in 0..=steps {
        let t = i as f64 / steps as f64;
        if t <= ratio {
            continue;
        }
        let angle = std::f64::consts::PI * (1.0 - t);
        rest.pixel(cx + angle.cos() * radius, cy - angle.sin() * radius * 0.85);
    }
    let dim = theme.background.mix(theme.border, 0.9);
    blit(surface, &rest, |_, _| dim, options.background);

    if let Some(label) = &options.label {
        surface.text_aligned(
            surface.height() as isize - 1,
            label,
            Align::Center,
            &TextOptions { fg: Some(color), attrs: Some(Attrs::BOLD), ..Default::default() },
        );
    }
}

#[derive(Clone, Debug, Default)]
pub struct DonutSegment {
    pub value: f64,
    pub color: Option<Color>,
    pub label: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct DonutOptions {
    pub segments: Vec<DonutSegment>,
    pub background: Option<Color>,
}

/// A ring chart. Reads well from about 12x6 cells.
pub fn donut(surface: &Surface, options: &DonutOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let total: f64 = options.segments.iter().map(|s| s.value.max(0.0)).sum();
    let total = if total == 0.0 { 1.0 } else { total };
    let mut canvas = BrailleCanvas::new(surface.width(), surface.height());
    let cx = canvas.width as f64 / 2.0;
    let cy = canvas.height as f64 / 2.0;
    let outer = (canvas.width as f64 / 2.0).min(canvas.height as f64 / 2.0) - 1.0;
    let inner = outer * 0.55;
    let mut color_for: HashMap<(i64, i64), Color> = HashMap::new();

    let mut angle = -std::f64::consts::PI / 2.0;
    for (i, seg) in options.segments.iter().enumerate() {
        let sweep = seg.value.max(0.0) / total * std::f64::consts::PI * 2.0;
        let color = seg.color.unwrap_or_else(|| series_color(&theme, i as i64));
        let steps = (8.0f64).max(round_half_up(sweep * outer * 3.0)) as i64;
        for s in 0..=steps {
            let a = angle + sweep * s as f64 / steps as f64;
            let mut r = inner;
            while r <= outer {
                let x = round_half_up(cx + a.cos() * r);
                let y = round_half_up(cy + a.sin() * r * 0.9);
                canvas.pixel(x, y);
                color_for.insert(((x as i64) >> 1, (y as i64) >> 2), color);
                r += 0.4;
            }
        }
        angle += sweep;
    }

    blit(
        surface,
        &canvas,
        |col, row| *color_for.get(&(col as i64, row as i64)).unwrap_or(&theme.muted),
        options.background,
    );
}

#[derive(Clone, Debug, Default)]
pub struct HistogramOptions {
    pub values: Vec<f64>,
    pub color: Option<Color>,
    pub colors: Option<Vec<Color>>,
    pub background: Option<Color>,
    pub max: Option<f64>,
}

/// Vertical column chart, one column per value, newest on the right.
pub fn histogram(surface: &Surface, options: &HistogramOptions) {
    plot(
        surface,
        &[Series::new(options.values.clone())],
        &PlotOptions {
            mode: Some(FillMode::Block),
            color: options.color,
            colors: options.colors.clone(),
            background: options.background,
            max: options.max,
            min: Some(0.0),
            ..Default::default()
        },
    );
}
