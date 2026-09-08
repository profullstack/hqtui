//! Charts of arbitrary (x, y) data.
//!
//! `plot` takes `&[f64]` and puts one sample per column: the x axis is the
//! array index. That is the right model for a history buffer and the wrong one
//! for everything else -- two series of different lengths silently render at
//! different horizontal scales, a gap in the data is indistinguishable from a
//! shorter series, and there is no way at all to say where on the x axis a
//! point belongs.
//!
//! This takes points and a domain for each axis, so a series is placed rather
//! than appended. `plot` is untouched and still means what it meant.

use crate::buffer::Style;
use crate::color::{round_half_up, Color};
use crate::graphics::blocks::{vertical_glyph, FillMode};
use crate::graphics::braille::BrailleCanvas;
use crate::graphics::plot::{blit, first_char};
use crate::surface::Surface;
use crate::theme::series_color;

pub type Point = (f64, f64);

/// How a series is marked: joined, dotted, or dropped to the baseline.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MarkType {
    #[default]
    Line,
    Scatter,
    Bar,
}

#[derive(Clone, Debug, Default)]
pub struct ChartSeries {
    pub points: Vec<Point>,
    pub color: Option<Color>,
    pub label: Option<String>,
    pub mark: MarkType,
    /// Shade between the line and the baseline. Ignored for a scatter.
    pub fill: bool,
}

impl ChartSeries {
    pub fn new(points: impl Into<Vec<Point>>) -> ChartSeries {
        ChartSeries { points: points.into(), ..Default::default() }
    }

    pub fn mark(mut self, mark: MarkType) -> ChartSeries {
        self.mark = mark;
        self
    }

    pub fn label(mut self, label: impl Into<String>) -> ChartSeries {
        self.label = Some(label.into());
        self
    }

    pub fn filled(mut self) -> ChartSeries {
        self.fill = true;
        self
    }
}

/// One axis: what it spans and how its numbers read.
#[derive(Clone, Default)]
pub struct AxisOptions {
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub format: Option<std::sync::Arc<dyn Fn(f64) -> String + Send + Sync>>,
    /// How many labels to place. Default 2 -- the ends.
    pub ticks: Option<usize>,
}

impl std::fmt::Debug for AxisOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AxisOptions")
            .field("min", &self.min)
            .field("max", &self.max)
            .field("ticks", &self.ticks)
            .finish()
    }
}

#[derive(Clone, Debug, Default)]
pub struct ChartPlotOptions {
    /// Braille is sharpest; block and ascii are the graceful degradations.
    pub mode: Option<FillMode>,
    pub x: Option<AxisOptions>,
    pub y: Option<AxisOptions>,
    pub background: Option<Color>,
    pub grid: bool,
    pub grid_color: Option<Color>,
    /// 0-1 opacity of the area fill against the background.
    pub fill_alpha: Option<f64>,
    /// Where a bar or an area is measured from. Defaults to the y minimum.
    pub baseline: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Domain {
    pub min: f64,
    pub max: f64,
}

/// A finite number, or none: a caller's bound is data, and data can be NaN.
fn bound(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.is_finite())
}

/// The span an axis covers, from the caller where they said and from the data
/// where they did not.
///
/// A domain of zero width cannot be mapped -- every point would land in the
/// same place and a division would blow up -- so a flat series is given room
/// around itself rather than being collapsed onto one line.
pub fn domain_of(series: &[ChartSeries], axis: Option<&AxisOptions>, which: usize) -> Domain {
    let mut min = bound(axis.and_then(|a| a.min));
    let mut max = bound(axis.and_then(|a| a.max));
    if min.is_none() || max.is_none() {
        let mut lo = f64::INFINITY;
        let mut hi = f64::NEG_INFINITY;
        for s in series {
            for p in &s.points {
                let v = if which == 0 { p.0 } else { p.1 };
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
        min = min.or(Some(lo));
        max = max.or(Some(hi));
    }
    let min = min.unwrap_or(0.0);
    let max = max.unwrap_or(1.0);
    if !(max > min) {
        // A flat series still has to be drawn somewhere sensible.
        let pad = if min.abs() > 0.0 { min.abs() * 0.5 } else { 0.5 };
        return Domain { min: min - pad, max: min + pad };
    }
    Domain { min, max }
}

/// Where a value sits in its domain, 0 at the minimum and 1 at the maximum.
fn ratio(value: f64, domain: Domain) -> f64 {
    (value - domain.min) / (domain.max - domain.min)
}

fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

fn draw_grid(surface: &Surface, color: Color, bg: Option<Color>) {
    let w = surface.width();
    let h = surface.height();
    let step = std::cmp::max(2, h / 4);
    let mut y = 0;
    while y < h {
        let mut x = 0;
        while x < w {
            surface.glyph(x as isize, y as isize, '·', &Style { fg: Some(color), bg, attrs: None });
            x += 2;
        }
        y += step;
    }
}

/// Draw point series across the whole surface.
///
/// Points are drawn in the order they are given: a line joins them as they
/// come, which is what lets a chart draw a loop or a path that doubles back.
/// Sorting them would quietly make that impossible.
pub fn plot_points(surface: &Surface, series: &[ChartSeries], options: &ChartPlotOptions) {
    if surface.is_empty() || series.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let mode = options.mode.unwrap_or(FillMode::Braille);
    let bg = options.background;
    let w = surface.width();
    let h = surface.height();

    let xd = domain_of(series, options.x.as_ref(), 0);
    let yd = domain_of(series, options.y.as_ref(), 1);
    let baseline = bound(options.baseline).unwrap_or(yd.min);

    if options.grid {
        let color = options
            .grid_color
            .unwrap_or_else(|| theme.border.mix(theme.background, 0.4));
        draw_grid(surface, color, bg);
    }

    if mode != FillMode::Braille {
        plot_cells(surface, series, mode, xd, yd, baseline, bg);
        return;
    }

    let mut canvas = BrailleCanvas::new(w, h);
    let px = canvas.width as f64;
    let py = canvas.height as f64;

    for (si, s) in series.iter().enumerate() {
        canvas.clear();
        let color = s.color.unwrap_or_else(|| series_color(&theme, si as i64));
        let finite: Vec<Point> = s
            .points
            .iter()
            .copied()
            .filter(|p| p.0.is_finite() && p.1.is_finite())
            .collect();
        if finite.is_empty() {
            continue;
        }
        let pixels: Vec<(f64, f64)> = finite
            .iter()
            .map(|p| {
                (
                    round_half_up(clamp01(ratio(p.0, xd)) * (px - 1.0)),
                    round_half_up((1.0 - clamp01(ratio(p.1, yd))) * (py - 1.0)),
                )
            })
            .collect();

        match s.mark {
            MarkType::Scatter => {
                for (x, y) in &pixels {
                    canvas.pixel(*x, *y);
                }
            }
            MarkType::Bar => {
                let floor = round_half_up((1.0 - clamp01(ratio(baseline, yd))) * (py - 1.0));
                for (x, y) in &pixels {
                    canvas.vline(*x, y.min(floor), y.max(floor));
                }
            }
            MarkType::Line => {
                if pixels.len() == 1 {
                    canvas.pixel(pixels[0].0, pixels[0].1);
                } else {
                    canvas.polyline(&pixels);
                }
            }
        }

        if s.fill && s.mark != MarkType::Scatter {
            fill_under(
                surface,
                &finite,
                xd,
                yd,
                baseline,
                color,
                bg,
                options.fill_alpha.unwrap_or(0.5),
            );
        }
        blit(surface, &canvas, |_, _| color, bg);
    }
}

/// The area between a series and its baseline, in block elements.
///
/// Braille would give eight scattered dots per cell, which reads as noise where
/// an area should read as an area. The line itself stays Braille, so it keeps
/// the sub-cell resolution.
///
/// The height of each column is interpolated along the line rather than sampled
/// from the points that happen to land in it. Sampling leaves a gap wherever a
/// column has no point of its own, which with arbitrary x values is most of
/// them -- the area comes out striped instead of solid.
#[allow(clippy::too_many_arguments)]
fn fill_under(
    surface: &Surface,
    points: &[Point],
    xd: Domain,
    yd: Domain,
    baseline: f64,
    color: Color,
    bg: Option<Color>,
    alpha: f64,
) {
    let w = surface.width();
    let h = surface.height();
    if w == 0 || h == 0 || points.is_empty() {
        return;
    }
    let base = bg.unwrap_or(surface.theme.background);
    let floor = clamp01(ratio(baseline, yd));
    let column = |x: f64| ratio(x, xd) * (w as f64 - 1.0);

    let mut tops = vec![f64::NAN; w];
    let mut record = |col: isize, value: f64, tops: &mut Vec<f64>| {
        if col < 0 || col as usize >= tops.len() {
            return;
        }
        // A path that doubles back covers a column twice; the outer edge is the
        // one that bounds the area.
        let previous = tops[col as usize];
        if previous.is_nan() || (value - floor).abs() > (previous - floor).abs() {
            tops[col as usize] = value;
        }
    };

    if points.len() == 1 {
        record(round_half_up(column(points[0].0)) as isize, clamp01(ratio(points[0].1, yd)), &mut tops);
    }
    for pair in points.windows(2) {
        let (x0, y0) = pair[0];
        let (x1, y1) = pair[1];
        let c0 = column(x0);
        let c1 = column(x1);
        let from = c0.min(c1).floor().max(0.0) as usize;
        let to = std::cmp::min(w - 1, c0.max(c1).ceil().max(0.0) as usize);
        for col in from..=to {
            let t = if c1 == c0 { 0.0 } else { (col as f64 - c0) / (c1 - c0) };
            if !(-0.5..=1.5).contains(&t) {
                continue;
            }
            let y = y0 + (y1 - y0) * clamp01(t);
            record(col as isize, clamp01(ratio(y, yd)), &mut tops);
        }
    }

    for x in 0..w {
        let top = tops[x];
        if top.is_nan() {
            continue;
        }
        let from01 = floor.min(top);
        let filled = (floor.max(top) - from01) * h as f64;
        let bottom = (from01 * h as f64).floor() as isize;
        let full = filled.floor() as isize;
        for k in 0..full.min(h as isize) {
            let row = h as isize - 1 - bottom - k;
            if row < 0 || row >= h as isize {
                continue;
            }
            let depth = if h <= 1 { 0.0 } else { row as f64 / (h as f64 - 1.0) };
            surface.glyph(
                x as isize,
                row,
                '█',
                &Style {
                    fg: Some(base.mix(color, alpha * (1.0 - depth * 0.3))),
                    bg,
                    attrs: None,
                },
            );
        }
        if full < h as isize {
            let glyph = vertical_glyph(filled - full as f64, FillMode::Block);
            let row = h as isize - 1 - bottom - full;
            if glyph != " " && row >= 0 && row < h as isize {
                let depth = if h <= 1 { 0.0 } else { row as f64 / (h as f64 - 1.0) };
                surface.glyph(
                    x as isize,
                    row,
                    first_char(glyph),
                    &Style {
                        fg: Some(base.mix(color, alpha * (1.0 - depth * 0.3) + 0.12)),
                        bg,
                        attrs: None,
                    },
                );
            }
        }
    }
}

/// The block and ascii degradations: one column per cell, tallest point wins.
///
/// A scatter keeps its dots rather than growing columns, because a scatter that
/// fills to the baseline is a bar chart wearing the wrong name.
fn plot_cells(
    surface: &Surface,
    series: &[ChartSeries],
    mode: FillMode,
    xd: Domain,
    yd: Domain,
    baseline: f64,
    bg: Option<Color>,
) {
    let w = surface.width();
    let h = surface.height();
    let theme = surface.theme.clone();
    let floor_ratio = clamp01(ratio(baseline, yd));

    for (si, s) in series.iter().enumerate() {
        let color = s.color.unwrap_or_else(|| series_color(&theme, si as i64));
        // Highest value per column, so a column shows the peak that fell in it
        // rather than whichever point happened to be last.
        let mut tops = vec![f64::NAN; w];
        for p in &s.points {
            if !p.0.is_finite() || !p.1.is_finite() {
                continue;
            }
            let col = (round_half_up(ratio(p.0, xd) * (w as f64 - 1.0)) as isize)
                .clamp(0, w as isize - 1) as usize;
            let value = clamp01(ratio(p.1, yd));
            if tops[col].is_nan() || value > tops[col] {
                tops[col] = value;
            }
        }

        for x in 0..w {
            let top = tops[x];
            if top.is_nan() {
                continue;
            }
            if s.mark == MarkType::Scatter {
                let row = h as isize - 1 - ((top * h as f64).floor() as isize).min(h as isize - 1);
                let glyph = if mode == FillMode::Ascii { '*' } else { '•' };
                surface.glyph(x as isize, row, glyph, &Style { fg: Some(color), bg, attrs: None });
                continue;
            }
            let from = floor_ratio.min(top) * h as f64;
            let filled = (floor_ratio.max(top) - floor_ratio.min(top)) * h as f64;
            let full = filled.floor() as isize;
            for k in 0..full {
                let row = h as isize - 1 - from.floor() as isize - k;
                if row >= 0 && row < h as isize {
                    surface.glyph(x as isize, row, '█', &Style { fg: Some(color), bg, attrs: None });
                }
            }
            let glyph = vertical_glyph(filled - full as f64, mode);
            let row = h as isize - 1 - from.floor() as isize - full;
            if glyph != " " && row >= 0 && row < h as isize {
                surface.glyph(x as isize, row, first_char(glyph), &Style { fg: Some(color), bg, attrs: None });
            }
        }
    }
}
