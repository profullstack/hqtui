//! Collapsed borders in Rust: `cargo run --example collapse`.
//!
//! The same scene as `examples/collapse.ts` in the TypeScript reference, so
//! the two outputs can be diffed. They are expected to be byte for byte the
//! same, which is what keeps the ports honest.

use hqtui::graphics::plot::Series;
use hqtui::prelude::*;
use hqtui::testing::{render_collapsed_to_text, render_to_text};
use hqtui::widgets::{MeterOptions, SparklineWidgetOptions};

fn view(ui: &mut Container) {
    ui.row(Row::new().size(5), |row| {
        row.panel(Panel::new().title("CPU"), |p| {
            p.meter(MeterOptions::new(0.62).label("all"));
        });
        row.panel(Panel::new().title("Memory"), |p| {
            p.meter(MeterOptions::new(0.31).label("used"));
        });
        row.panel(Panel::new().title("Disk"), |p| {
            p.meter(MeterOptions::new(0.87).label("root"));
        });
    });
    ui.row(Row::new().size(4), |row| {
        row.panel(Panel::new().title("Network"), |p| {
            p.sparkline(SparklineWidgetOptions {
                values: vec![3., 7., 2., 9., 4., 8., 6.],
                label: Some("rx ".into()),
                ..Default::default()
            });
        });
        row.panel(Panel::new().title("Errors"), |p| {
            p.text("none");
        });
    });
    let _ = Series::new(vec![0.0]);
}

fn main() {
    println!("--- default ---");
    println!("{}", render_to_text(60, 9, "dark", view));
    println!("--- collapsed ---");
    println!("{}", render_collapsed_to_text(60, 9, "dark", view));
}
