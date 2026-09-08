//! Meters, gauges, graphs and the rest of the "how full is it" family.

use crate::buffer::{Attrs, Style};
use crate::color::{round_half_up, Color, Gradient};
use crate::graphics::blocks::{vertical_glyph, FillMode};
use crate::graphics::plot::{
    bar, plot, sparkline, BarOptions, BarStyle, PlotOptions, Series, SparklineOptions,
};
use crate::surface::{Surface, TextOptions};
use crate::theme::{heat_color, series_color};
use crate::unicode::{fit, string_width, truncate, Align};

pub use crate::graphics::plot::{donut as draw_donut, gauge as draw_gauge};
pub use crate::graphics::plot::{DonutOptions, DonutSegment, GaugeOptions};

/// A 0-1 ratio. Ordered so NaN falls through to 0 — `min`/`max` propagate it in
/// the reference implementation, which rendered "NaN%" in black on black.
pub fn clamp_ratio(value: f64) -> f64 {
    if value > 1.0 {
        1.0
    } else if value > 0.0 {
        value
    } else {
        0.0
    }
}

#[derive(Clone, Debug, Default)]
pub struct MeterOptions {
    /// 0-1, or supply `max` and pass an absolute value.
    pub value: f64,
    pub max: Option<f64>,
    pub label: Option<String>,
    /// Right-hand readout. Defaults to a percentage.
    pub text: Option<String>,
    pub label_width: Option<usize>,
    pub value_width: Option<usize>,
    pub color: Option<Color>,
    /// Green-to-red by fill level. Defaults on unless a `color` is given.
    pub heat: Option<bool>,
    pub background: Option<Color>,
    pub style: Option<BarStyle>,
    pub show_value: Option<bool>,
}

impl MeterOptions {
    pub fn new(value: f64) -> MeterOptions {
        MeterOptions { value, ..Default::default() }
    }

    pub fn label(mut self, l: impl Into<String>) -> MeterOptions {
        self.label = Some(l.into());
        self
    }

    pub fn max(mut self, m: f64) -> MeterOptions {
        self.max = Some(m);
        self
    }

    pub fn color(mut self, c: Color) -> MeterOptions {
        self.color = Some(c);
        self
    }

    pub fn style(mut self, s: BarStyle) -> MeterOptions {
        self.style = Some(s);
        self
    }
}

/// `label ████████░░░░ 42%` on a single row. The most-used widget here.
pub fn draw_meter(surface: &Surface, options: &MeterOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let ratio = clamp_ratio(match options.max {
        // 0 and NaN are both falsy in the reference, which then treats `value`
        // as an already-normalised ratio instead of dividing by them.
        Some(m) if m != 0.0 && !m.is_nan() => options.value / m,
        _ => options.value,
    });
    let label = options.label.clone().unwrap_or_default();
    let label_width = if label.is_empty() {
        0
    } else {
        options.label_width.unwrap_or(string_width(&label) + 1)
    };
    let value_text = if options.show_value == Some(false) {
        String::new()
    } else {
        options
            .text
            .clone()
            .unwrap_or_else(|| format!("{}%", round_half_up(ratio * 100.0) as i64))
    };
    let value_width = if value_text.is_empty() {
        0
    } else {
        options.value_width.unwrap_or(string_width(&value_text) + 1)
    };
    let bar_width = surface.width().saturating_sub(label_width + value_width);

    if label_width > 0 {
        surface.text(
            0,
            0,
            &fit(&truncate(&label, label_width), label_width, Align::Left),
            &TextOptions { fg: Some(theme.muted), bg: options.background, ..Default::default() },
        );
    }
    if bar_width > 0 {
        bar(
            &surface.sub(label_width as isize, 0, bar_width, 1),
            &BarOptions {
                value: ratio,
                color: options.color,
                heat: Some(options.heat.unwrap_or(options.color.is_none())),
                background: options.background,
                style: options.style,
                track: None,
                track_char: None,
            },
        );
    }
    if value_width > 0 {
        surface.text(
            surface.width() as isize - value_width as isize,
            0,
            &fit(&value_text, value_width, Align::Right),
            &TextOptions {
                fg: Some(options.color.unwrap_or(if options.heat == Some(false) {
                    theme.foreground
                } else {
                    heat_color(&theme, ratio)
                })),
                bg: options.background,
                attrs: Some(Attrs::BOLD),
                ..Default::default()
            },
        );
    }
}

#[derive(Clone, Debug, Default)]
pub struct MeterItem {
    pub label: String,
    pub value: f64,
    pub max: Option<f64>,
    pub color: Option<Color>,
    pub text: Option<String>,
}

impl MeterItem {
    pub fn new(label: impl Into<String>, value: f64) -> MeterItem {
        MeterItem { label: label.into(), value, ..Default::default() }
    }
}

#[derive(Clone, Debug, Default)]
pub struct MetersOptions {
    pub items: Vec<MeterItem>,
    pub label_width: Option<usize>,
    pub value_width: Option<usize>,
    pub heat: Option<bool>,
    pub background: Option<Color>,
    pub style: Option<BarStyle>,
    /// Lay out in N columns when there is room, like btop's core grid.
    pub columns: Option<usize>,
    pub gap: Option<usize>,
}

/// A stack (or grid) of meters — per-core CPU, per-disk usage, and so on.
pub fn draw_meters(surface: &Surface, options: &MetersOptions) {
    if surface.is_empty() {
        return;
    }
    let columns = options.columns.unwrap_or(1).max(1);
    let gap = options.gap.unwrap_or(2);
    let col_width = ((surface.width() as f64 - (gap * (columns - 1)) as f64)
        / columns as f64)
        .floor() as isize;
    let per_column = options.items.len().div_ceil(columns);
    if per_column == 0 {
        return;
    }

    for (i, item) in options.items.iter().enumerate() {
        let col = i / per_column;
        let row = i % per_column;
        if row >= surface.height() || col >= columns {
            continue;
        }
        draw_meter(
            &surface.sub(
                col as isize * (col_width + gap as isize),
                row as isize,
                col_width.max(0) as usize,
                1,
            ),
            &MeterOptions {
                value: item.value,
                max: item.max,
                label: Some(item.label.clone()),
                text: item.text.clone(),
                color: item.color,
                label_width: options.label_width,
                value_width: options.value_width,
                heat: options.heat,
                background: options.background,
                style: options.style,
                show_value: None,
            },
        );
    }
}

#[derive(Clone, Debug, Default)]
pub struct ProgressOptions {
    pub value: f64,
    pub max: Option<f64>,
    pub label: Option<String>,
    pub color: Option<Color>,
    pub background: Option<Color>,
    /// Show `37 / 120` instead of a percentage.
    pub show_count: bool,
}

pub fn draw_progress(surface: &Surface, options: &ProgressOptions) {
    let max = options.max.unwrap_or(1.0);
    draw_meter(
        surface,
        &MeterOptions {
            value: options.value,
            max: Some(max),
            label: options.label.clone(),
            color: Some(options.color.unwrap_or(surface.theme.primary)),
            heat: Some(false),
            background: options.background,
            text: if options.show_count {
                Some(format!(
                    "{}/{}",
                    round_half_up(options.value) as i64,
                    round_half_up(max) as i64
                ))
            } else {
                None
            },
            ..Default::default()
        },
    );
}

/// The axis label format the reference implementation uses when none is given.
pub fn nice_label(value: f64) -> String {
    if value.abs() >= 1000.0 {
        return format!("{}k", round_half_up(value / 100.0) / 10.0);
    }
    if value.fract() == 0.0 && value.is_finite() {
        return format!("{}", value);
    }
    format!("{:.1}", value)
}

#[derive(Clone, Debug, Default)]
pub struct GraphOptions {
    /// A single series, or several.
    pub values: Option<Vec<f64>>,
    pub series: Option<Vec<Series>>,
    pub plot: PlotOptions,
    /// Draw min/max labels down the left edge.
    pub axis: bool,
    pub axis_format: Option<fn(f64) -> String>,
    pub axis_color: Option<Color>,
    /// Time labels along the bottom, e.g. `["60s", "30s", "0s"]`.
    pub time_axis: Option<Vec<String>>,
    pub legend: bool,
    pub legend_align: Option<Align>,
}

impl GraphOptions {
    pub fn new(values: impl Into<Vec<f64>>) -> GraphOptions {
        GraphOptions { values: Some(values.into()), ..Default::default() }
    }

    pub fn series(series: Vec<Series>) -> GraphOptions {
        GraphOptions { series: Some(series), ..Default::default() }
    }

    pub fn with_axis(mut self) -> GraphOptions {
        self.axis = true;
        self
    }

    pub fn with_legend(mut self) -> GraphOptions {
        self.legend = true;
        self
    }

    pub fn filled(mut self) -> GraphOptions {
        self.plot.fill = Some(true);
        self
    }
}

/// Line/area graph. Braille by default, so it reads at 2x4 the cell resolution.
pub fn draw_graph(surface: &Surface, options: &GraphOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let series_list: Vec<Series> = match &options.series {
        Some(s) => s.clone(),
        None => vec![Series::new(options.values.clone().unwrap_or_default())],
    };

    let mut plot_surface = surface.clone();
    let axis_color = options.axis_color.unwrap_or(theme.muted);

    // Whether the bottom row belongs to the time axis rather than the plot.
    // Decided before the y-axis labels are written: the minimum marks the
    // bottom of the *plot*, and the time axis takes that row away. Writing it
    // at `height - 1` regardless put it against the first time label, so "$0"
    // and "08-10" rendered as "$008-10".
    let time_axis_row = options.time_axis.is_some() && surface.height() > 2;

    if options.axis {
        // Match the window the plot itself will use, so the labels stay truthful.
        let columns = if options.plot.mode.unwrap_or(FillMode::Braille) == FillMode::Braille {
            surface.width() * 2
        } else {
            surface.width()
        };
        let n = columns.max(1);
        let values: Vec<f64> = series_list
            .iter()
            .flat_map(|s| {
                let start = s.values.len().saturating_sub(n);
                s.values[start..].to_vec()
            })
            .filter(|v| v.is_finite())
            .collect();
        let max = options.plot.max.unwrap_or_else(|| {
            values.iter().copied().fold(f64::NEG_INFINITY, f64::max)
        });
        let max = if values.is_empty() && options.plot.max.is_none() { 1.0 } else { max };
        let min = options.plot.min.unwrap_or(0.0);
        let format = options.axis_format.unwrap_or(nice_label);
        let label_width = string_width(&format(max)).max(string_width(&format(min))) + 1;
        surface.text(
            0,
            0,
            &fit(&format(max), label_width, Align::Right),
            &TextOptions::new().fg(axis_color),
        );
        if surface.height() > 1 {
            let bottom = if time_axis_row {
                surface.height() as isize - 2
            } else {
                surface.height() as isize - 1
            };
            surface.text(
                0,
                bottom,
                &fit(&format(min), label_width, Align::Right),
                &TextOptions::new().fg(axis_color),
            );
        }
        plot_surface = surface.sub(
            label_width as isize,
            0,
            surface.width().saturating_sub(label_width),
            surface.height(),
        );
    }

    let mut graph_surface = plot_surface.clone();
    if let Some(labels) = &options.time_axis {
        if plot_surface.height() > 1 {
            graph_surface =
                plot_surface.sub(0, 0, plot_surface.width(), plot_surface.height() - 1);
            let step = if labels.len() > 1 {
                (plot_surface.width() as f64 - 1.0) / (labels.len() - 1) as f64
            } else {
                0.0
            };
            for (i, label) in labels.iter().enumerate() {
                let x = (plot_surface.width() as isize - string_width(label) as isize)
                    .min(round_half_up(i as f64 * step) as isize);
                plot_surface.text(
                    x.max(0),
                    plot_surface.height() as isize - 1,
                    label,
                    &TextOptions::new().fg(axis_color),
                );
            }
        }
    }

    plot(&graph_surface, &series_list, &options.plot);

    if options.legend {
        let parts: Vec<(String, Color)> = series_list
            .iter()
            .enumerate()
            .filter_map(|(i, s)| {
                s.label
                    .as_ref()
                    .map(|l| (l.clone(), s.color.unwrap_or_else(|| series_color(&theme, i as i64))))
            })
            .collect();
        let total: usize = parts.iter().map(|(l, _)| string_width(l) + 3).sum();
        let mut x = if options.legend_align == Some(Align::Right) {
            (graph_surface.width() as isize - total as isize).max(0)
        } else {
            0
        };
        // Sit the legend on the last row when there is one to spare, so it never
        // lands on top of the plot's busiest corner.
        let y = if graph_surface.height() > 3 { graph_surface.height() as isize - 1 } else { 0 };
        for (label, color) in parts {
            x += graph_surface.text(x, y, "■ ", &TextOptions::new().fg(color)) as isize;
            x += graph_surface.text(
                x,
                y,
                &format!("{label} "),
                &TextOptions::new().fg(theme.muted),
            ) as isize;
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct SparklineWidgetOptions {
    pub values: Vec<f64>,
    pub color: Option<Color>,
    pub colors: Option<Vec<Color>>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub label: Option<String>,
    pub text: Option<String>,
    pub background: Option<Color>,
}

/// One-row trend, optionally with a label and a right-hand readout.
pub fn draw_sparkline(surface: &Surface, options: &SparklineWidgetOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let label_width = options.label.as_ref().map(|l| string_width(l) + 1).unwrap_or(0);
    let value_width = options.text.as_ref().map(|t| string_width(t) + 1).unwrap_or(0);
    if let Some(label) = &options.label {
        surface.text(
            0,
            0,
            label,
            &TextOptions { fg: Some(theme.muted), bg: options.background, ..Default::default() },
        );
    }
    let width = surface.width() as isize - label_width as isize - value_width as isize;
    if width > 0 {
        sparkline(
            &surface.sub(label_width as isize, 0, width as usize, 1),
            &options.values,
            &SparklineOptions {
                color: options.color,
                colors: options.colors.clone(),
                min: options.min,
                max: options.max,
                background: options.background,
                mode: None,
            },
        );
    }
    if value_width > 0 {
        surface.text(
            surface.width() as isize - value_width as isize,
            0,
            &fit(options.text.as_deref().unwrap_or(""), value_width, Align::Right),
            &TextOptions {
                fg: Some(options.color.unwrap_or(theme.accent)),
                bg: options.background,
                attrs: Some(Attrs::BOLD),
                ..Default::default()
            },
        );
    }
}

#[derive(Clone, Debug, Default)]
pub struct HeatBarOptions {
    /// 0-1. Renders like btop's temperature bars.
    pub value: f64,
    pub width: Option<usize>,
    pub color: Option<Color>,
    pub background: Option<Color>,
    pub char: Option<char>,
}

/// A segmented heat bar: discrete ticks colored along the theme ramp.
pub fn draw_heat_bar(surface: &Surface, options: &HeatBarOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let ratio = options.value.clamp(0.0, 1.0);
    let width = options.width.unwrap_or(surface.width()).min(surface.width());
    let filled = round_half_up(ratio * width as f64) as usize;
    let ramp = Gradient::new(&theme.heat);
    let ch = options.char.unwrap_or('▮');
    let off = theme.background.mix(theme.border, 0.75);
    for x in 0..width {
        let on = x < filled;
        let fg = if on {
            options.color.unwrap_or_else(|| {
                ramp.sample(if width <= 1 { ratio } else { x as f64 / (width - 1) as f64 })
            })
        } else {
            off
        };
        surface.glyph(
            x as isize,
            0,
            ch,
            &Style { fg: Some(fg), bg: options.background, attrs: None },
        );
    }
}

#[derive(Clone, Debug, Default)]
pub struct ColumnsOptions {
    pub values: Vec<f64>,
    pub color: Option<Color>,
    pub colors: Option<Vec<Color>>,
    pub max: Option<f64>,
    pub background: Option<Color>,
}

/// Block-mode column chart. Cheaper than Braille and reads well when short.
pub fn draw_columns(surface: &Surface, options: &ColumnsOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let max = options.max.unwrap_or_else(|| {
        options.values.iter().copied().fold(1.0f64, |a, b| if b > a { b } else { a })
    });
    let ramp = options.colors.as_ref().map(|c| Gradient::new(c));
    let count = options.values.len().min(surface.width());
    let start = options.values.len() - count;
    let h = surface.height();
    for i in 0..count {
        let ratio = (options.values[start + i] / max).clamp(0.0, 1.0);
        let filled = ratio * h as f64;
        let full = filled.floor() as usize;
        let color = ramp
            .as_ref()
            .map(|r| r.sample(ratio))
            .or(options.color)
            .unwrap_or(theme.primary);
        let style = Style { fg: Some(color), bg: options.background, attrs: None };
        for k in 0..full {
            surface.glyph(i as isize, h as isize - 1 - k as isize, '█', &style);
        }
        if full < h {
            let glyph = vertical_glyph(filled - filled.floor(), FillMode::Block);
            if glyph != " " {
                surface.glyph(
                    i as isize,
                    h as isize - 1 - full as isize,
                    glyph.chars().next().unwrap(),
                    &style,
                );
            }
        }
    }
}
