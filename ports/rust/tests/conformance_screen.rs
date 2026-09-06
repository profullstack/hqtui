//! End to end: the builder driving whole screens, compared against what the
//! TypeScript reference's builder produced for the same layout.
//!
//! This is the test that would catch a layout solver that is subtly off, or a
//! panel whose interior padding drifted — neither of which shows up when a
//! widget is drawn onto a surface someone else sized.

mod common;

use common::{assert_buffer, fixture};

use hqtui::graphics::Series;
use hqtui::testing::render_to_screen;
use hqtui::layout::Size;
use hqtui::ui::{Container, GridSpec, Panel, Row, Span};
use hqtui::widgets::*;

const SERIES: [f64; 16] =
    [12., 40., 33., 71., 25., 60., 48., 19., 55., 80., 35., 62., 44., 28., 70., 51.];

// Children are drawn after the builder returns, so anything a widget needs must
// be owned by the widget rather than borrowed from the frame. `SERIES.to_vec()`
// is spelled out at each use for that reason: a local `let series = || ...`
// closure would be borrowed by the deferred draw and outlive itself.
fn build(name: &str, ui: &mut Container) {
    match name {
        "hello" => {
            ui.panel(Panel::new().title("Hello"), |p| {
                p.text("Hello, terminal.");
            });
        }
        "rows-and-columns" => {
            ui.row(Row::new().gap(1), |row| {
                row.panel(Panel::new().title("L"), |p| {
                    p.text("left");
                });
                row.panel(Panel::new().title("R").size("1fr"), |p| {
                    p.text("right");
                });
            });
        }
        "grid" => {
            ui.grid(
                GridSpec::new().columns(["2fr", "1fr"]).rows([Size::Cells(6), Size::Fr(1.0)]).gap(1),
                |g| {
                    g.panel(Panel::new().title("CPU"), Span::new(1, 1), |p| {
                        p.meter(MeterOptions::new(0.62).label("all"));
                    });
                    g.panel(Panel::new().title("MEM"), Span::new(1, 1), |p| {
                        p.meter(MeterOptions::new(0.31).label("used"));
                    });
                    g.panel(Panel::new().title("NET"), Span::new(2, 1), |p| {
                        p.graph(GraphOptions::new(SERIES.to_vec()));
                    });
                },
            );
        }
        "grid-span-overflow" => {
            ui.grid(GridSpec::new().column_count(1).row_count(2), |g| {
                g.panel(Panel::new().title("wide"), Span::new(2, 1), |p| {
                    p.text("spans");
                });
                g.panel(Panel::new().title("next"), Span::new(1, 1), |p| {
                    p.text("after");
                });
            });
        }
        "dashboard" => {
            ui.row(Row::new().size(1), |r| {
                r.heading("hqtui");
                r.spacer("fill");
                r.badge(BadgeOptions::new("LIVE"));
            });
            ui.grid(GridSpec::new().columns(["1fr", "1fr"]).rows(["1fr"]).gap(1), |g| {
                g.panel(Panel::new().title("Load"), Span::new(1, 1), |p| {
                    p.meters(MetersOptions {
                        items: vec![MeterItem::new("c0", 0.2), MeterItem::new("c1", 0.7)],
                        ..Default::default()
                    });
                    p.graph(GraphOptions::new(SERIES.to_vec()).with_axis());
                });
                g.panel(Panel::new().title("Procs"), Span::new(1, 1), |p| {
                    p.table(
                        TableOptions {
                            rows: vec![
                                TableRow::new(["1", "init"]),
                                TableRow::new(["42", "node"]),
                            ],
                            columns: vec![
                                TableColumn::new("PID").align(hqtui::unicode::Align::Right),
                                TableColumn::new("CMD"),
                            ],
                            selected: Some(0),
                            ..Default::default()
                        },
                        "",
                    );
                });
            });
            ui.status_bar(StatusBarOptions {
                items: vec![StatusItem::new("quit").key("q")],
                ..Default::default()
            });
        }
        "themed-nord" => {
            ui.panel(Panel::new().title("Nord"), |p| {
                p.meter(MeterOptions::new(0.5).label("x"));
            });
        }
        "themed-light" => {
            ui.panel(Panel::new().title("Light"), |p| {
                p.meter(MeterOptions::new(0.5).label("x"));
            });
        }
        "responsive-narrow" => {
            // The reference picks the largest breakpoint the container fits;
            // at 20 columns that is the 0 branch.
            if ui.width() >= 60 {
                ui.text("wide");
            } else {
                ui.text("narrow");
            }
        }
        "overlays" => {
            ui.panel(Panel::new().title("Behind"), |p| {
                p.text("content");
            });
            ui.modal(ModalOptions {
                buttons: vec![ModalButton::new("OK").focused()],
                ..ModalOptions::new().title("Modal").message("Are you sure?")
            });
        }
        "unicode-content" => {
            ui.panel(Panel::new().title("日本語"), |p| {
                p.text("こんにちは 世界");
                p.text("🚀 emoji ok");
            });
        }
        other => panic!("no Rust scene for screen fixture {other:?}"),
    }
}

#[test]
fn screens_match_reference() {
    let cases = fixture("screen");
    assert!(!cases.arr().is_empty(), "no screen fixtures loaded");

    let mut failures: Vec<String> = Vec::new();
    let mut cells = 0usize;

    for case in cases.arr() {
        let name = case.get("name").str();
        let (width, height) = (case.get("width").usize(), case.get("height").usize());
        cells += width * height;
        let screen = render_to_screen(width, height, case.get("theme").str(), |ui| {
            build(name, ui)
        });

        if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_buffer(&screen.buffer, case.get("result"), name)
        })) {
            let message = e
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "unknown panic".into());
            failures.push(format!("  {name}: {}", message.lines().next().unwrap_or("")));
        }
    }

    eprintln!("{} screen scenes, {cells} cells compared", cases.arr().len());
    assert!(
        failures.is_empty(),
        "{} of {} screens differ from the reference:\n{}",
        failures.len(),
        cases.arr().len(),
        failures.join("\n")
    );
}

/// A series with a label is what the legend reads, so keep the import honest.
#[test]
fn series_labels_survive() {
    let s = Series::new(vec![1.0, 2.0]).label("rx");
    assert_eq!(s.label.as_deref(), Some("rx"));
}
