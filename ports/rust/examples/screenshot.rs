//! Renders a dashboard headlessly and prints it, so the whole stack can be
//! exercised without a TTY: `cargo run --example screenshot`.
//!
//! Add `--ansi` for the colored form, or `--html` for a standalone page.

use hqtui::graphics::Series;
use hqtui::prelude::*;
use hqtui::testing::{render_to_html, render_to_screen, HtmlOptions};

fn main() {
    let arg = std::env::args().nth(1).unwrap_or_default();
    let cpu: Vec<f64> = (0..120).map(|i| ((i as f64) / 9.0).sin() * 35.0 + 55.0).collect();
    let net: Vec<f64> = (0..120).map(|i| ((i as f64) / 5.0).cos() * 25.0 + 40.0).collect();

    let screen = render_to_screen(84, 22, "dark", move |ui| {
        ui.row(Row::new().size(1), |r| {
            r.heading("hqtui — rust port");
            r.spacer("fill");
            r.badge(BadgeOptions::new("LIVE"));
        });
        ui.grid(
            GridSpec::new()
                .columns(["2fr", "1fr"])
                .rows([Size::Cells(11), Size::Fr(1.0)])
                .gap(1),
            |g| {
                g.panel(
                    Panel::new().title("Throughput").subtitle("60s"),
                    Span::new(1, 1),
                    |p| {
                        p.graph(
                            GraphOptions::series(vec![
                                Series::new(cpu).label("cpu"),
                                Series::new(net).label("net"),
                            ])
                            .with_axis()
                            .with_legend()
                            .filled(),
                        );
                    },
                );
                g.panel(Panel::new().title("Cores"), Span::new(1, 1), |p| {
                    p.meters(MetersOptions {
                        items: (0..8)
                            .map(|i| MeterItem::new(format!("c{i}"), 0.15 + (i as f64) * 0.11))
                            .collect(),
                        ..Default::default()
                    });
                });
                g.panel(Panel::new().title("Processes"), Span::new(2, 1), |p| {
                    p.table(
                        TableOptions {
                            rows: vec![
                                TableRow::new(["1", "systemd", "0.1", "12M"]),
                                TableRow::new(["412", "hqtui", "12.5", "48M"]),
                                TableRow::new(["1201", "rustc", "41.8", "1.2G"]),
                            ],
                            columns: vec![
                                TableColumn::new("PID").align(Align::Right),
                                TableColumn::new("NAME"),
                                TableColumn::new("CPU%").align(Align::Right),
                                TableColumn::new("MEM").align(Align::Right),
                            ],
                            selected: Some(1),
                            zebra: true,
                            ..Default::default()
                        },
                        "",
                    );
                });
            },
        );
        ui.status_bar(StatusBarOptions {
            items: vec![StatusItem::new("quit").key("q"), StatusItem::new("select").key("↑↓")],
            right: vec![StatusItem::new("30fps")],
            ..Default::default()
        });
    });

    match arg.as_str() {
        "--ansi" => println!("{}", screen.ansi()),
        "--html" => println!("{}", render_to_html(&screen, &HtmlOptions::default())),
        _ => println!("{}", screen.text()),
    }
}
