//! A chart with two real axes.
//!
//! `graph` plots a history buffer: one sample per column, x meaning "position
//! in the array". This plots data that has its own x values, with a labelled
//! domain on both axes, so two series of different lengths line up and a point
//! lands where its x says it does.

use crate::color::{round_half_up, Color};
use crate::graphics::chart::{
    domain_of, plot_points, AxisOptions, ChartPlotOptions, ChartSeries,
};
use crate::surface::{Surface, TextOptions};
use crate::theme::series_color;
use crate::unicode::{fit, string_width, Align};
use crate::widgets::meters::nice_label;

#[derive(Clone, Debug, Default)]
pub struct ChartOptions {
    pub series: Vec<ChartSeries>,
    pub plot: ChartPlotOptions,
    /// Numbers down the left edge.
    pub axis: bool,
    pub axis_color: Option<Color>,
    pub legend: bool,
    pub legend_align: Option<Align>,
}

/// Evenly spaced values across a domain, ends included.
///
/// Two ticks means the ends and nothing else, which is what an axis wants when
/// there is no room to say more.
fn ticks_for(min: f64, max: f64, count: usize) -> Vec<f64> {
    let n = count.max(2);
    (0..n).map(|i| min + (max - min) * i as f64 / (n - 1) as f64).collect()
}

fn format_with(axis: Option<&AxisOptions>, value: f64) -> String {
    match axis.and_then(|a| a.format.as_ref()) {
        Some(f) => f(value),
        None => nice_label(value),
    }
}

pub fn draw_chart(surface: &Surface, options: &ChartOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let series = &options.series;
    let axis_color = options.axis_color.unwrap_or(theme.muted);

    let xd = domain_of(series, options.plot.x.as_ref(), 0);
    let yd = domain_of(series, options.plot.y.as_ref(), 1);

    // The x labels take a row, and they can only take one when there is a row
    // to spare -- a two-row chart is all plot.
    let x_ticks = options
        .plot
        .x
        .as_ref()
        .and_then(|a| a.ticks)
        .unwrap_or(if options.axis { 2 } else { 0 });
    let want_x_axis = options.axis && x_ticks >= 2 && surface.height() > 2;

    let mut plot_surface = surface.clone();
    if options.axis {
        let hi = format_with(options.plot.y.as_ref(), yd.max);
        let lo = format_with(options.plot.y.as_ref(), yd.min);
        let width = string_width(&hi).max(string_width(&lo)) + 1;
        surface.text(0, 0, &fit(&hi, width, Align::Right), &TextOptions::new().fg(axis_color));
        if surface.height() > 1 {
            // The minimum marks the bottom of the plot, which is a row higher
            // when the x labels have taken the last one.
            let bottom = if want_x_axis {
                surface.height() as isize - 2
            } else {
                surface.height() as isize - 1
            };
            surface.text(
                0,
                bottom,
                &fit(&lo, width, Align::Right),
                &TextOptions::new().fg(axis_color),
            );
        }
        plot_surface = surface.sub(
            width as isize,
            0,
            surface.width().saturating_sub(width),
            surface.height(),
        );
    }

    let mut area = plot_surface.clone();
    if want_x_axis && plot_surface.height() > 1 && plot_surface.width() > 0 {
        area = plot_surface.sub(0, 0, plot_surface.width(), plot_surface.height() - 1);
        let row = plot_surface.height() as isize - 1;
        let labels: Vec<String> = ticks_for(xd.min, xd.max, x_ticks)
            .into_iter()
            .map(|v| format_with(options.plot.x.as_ref(), v))
            .collect();
        let step = if labels.len() > 1 {
            (plot_surface.width() as f64 - 1.0) / (labels.len() - 1) as f64
        } else {
            0.0
        };
        for (i, label) in labels.iter().enumerate() {
            // The last label is right-aligned to the edge, so it cannot run off it.
            let x = (plot_surface.width() as isize - string_width(label) as isize)
                .min(round_half_up(i as f64 * step) as isize);
            plot_surface.text(x.max(0), row, label, &TextOptions::new().fg(axis_color));
        }
    }

    // The domain is resolved once and handed down, so the labels and the marks
    // cannot disagree about what the axis spans.
    let mut plot_options = options.plot.clone();
    plot_options.x = Some(AxisOptions {
        min: Some(xd.min),
        max: Some(xd.max),
        ..options.plot.x.clone().unwrap_or_default()
    });
    plot_options.y = Some(AxisOptions {
        min: Some(yd.min),
        max: Some(yd.max),
        ..options.plot.y.clone().unwrap_or_default()
    });
    plot_points(&area, series, &plot_options);

    if options.legend {
        let parts: Vec<(String, Color)> = series
            .iter()
            .enumerate()
            .filter_map(|(i, s)| {
                s.label
                    .clone()
                    .map(|l| (l, s.color.unwrap_or_else(|| series_color(&theme, i as i64))))
            })
            .collect();
        let mut x: isize = if options.legend_align == Some(Align::Right) {
            let total: usize = parts.iter().map(|(l, _)| string_width(l) + 3).sum();
            (area.width() as isize - total as isize).max(0)
        } else {
            0
        };
        let y = if area.height() > 3 { area.height() as isize - 1 } else { 0 };
        for (label, color) in &parts {
            x += area.text(x, y, "■ ", &TextOptions::new().fg(*color)) as isize;
            x += area.text(x, y, &format!("{label} "), &TextOptions::new().fg(theme.muted)) as isize;
        }
    }
}
