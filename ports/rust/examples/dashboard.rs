//! A live dashboard: `cargo run --example dashboard`.
//!
//! Shows the shape a real app takes — your state stays yours, events are
//! matched where you can see them, and the view is a pure function of what you
//! already have.

use std::time::Instant;

use hqtui::graphics::Series;
use hqtui::prelude::*;
use hqtui::widgets::*;

struct State {
    cpu: Vec<f64>,
    net: Vec<f64>,
    rows: Vec<(u32, String, f64)>,
    selected: usize,
    tab: usize,
    started: Instant,
}

impl State {
    fn new() -> State {
        State {
            cpu: Vec::new(),
            net: Vec::new(),
            rows: vec![
                (1, "systemd".into(), 0.1),
                (412, "hqtui-demo".into(), 12.5),
                (900, "cargo".into(), 3.2),
                (1201, "rustc".into(), 41.8),
                (1888, "ssh".into(), 0.4),
            ],
            selected: 0,
            tab: 0,
            started: Instant::now(),
        }
    }

    /// Something that looks like a machine under load, with no data source.
    fn tick(&mut self) {
        let t = self.started.elapsed().as_secs_f64();
        push_capped(&mut self.cpu, (t * 1.7).sin() * 0.3 + (t * 0.4).cos() * 0.2 + 0.5);
        push_capped(&mut self.net, ((t * 0.9).sin() * 0.5 + 0.5) * 90.0);
    }

    fn cpu_now(&self) -> f64 {
        self.cpu.last().copied().unwrap_or(0.0)
    }
}

fn push_capped(values: &mut Vec<f64>, value: f64) {
    values.push(value);
    if values.len() > 400 {
        values.remove(0);
    }
}

const TABS: [&str; 3] = ["cpu", "net", "procs"];

fn main() -> std::io::Result<()> {
    let mut app = App::new()?;
    let mut state = State::new();

    while app.running() {
        for event in app.poll()? {
            if let InputEvent::Key(key) = event {
                match key.name.as_str() {
                    "down" => state.selected = (state.selected + 1).min(state.rows.len() - 1),
                    "up" => state.selected = state.selected.saturating_sub(1),
                    "left" => state.tab = state.tab.saturating_sub(1),
                    "right" => state.tab = (state.tab + 1).min(TABS.len() - 1),
                    _ => {}
                }
            }
        }
        // A click on a table row selects it; the wheel scrolls the same widget.
        if let Some(row) = app.clicked_row("procs") {
            state.selected = row.min(state.rows.len() - 1);
        }
        for i in 0..TABS.len() {
            if app.pressed(&format!("tabs:{i}")) {
                state.tab = i;
            }
        }

        state.tick();

        // Everything the view needs, built before the borrow starts.
        let cpu = state.cpu.clone();
        let net = state.net.clone();
        let cpu_now = state.cpu_now();
        let net_now = state.net.last().copied().unwrap_or(0.0);
        let selected = state.selected;
        let tab = state.tab;
        let rows: Vec<TableRow> = state
            .rows
            .iter()
            .map(|(pid, name, cpu)| TableRow::new([pid.to_string(), name.clone(), format!("{cpu:.1}")]))
            .collect();

        app.draw(|f| {
            f.ui.row(Row::new().size(1), |r| {
                r.heading("hqtui — rust");
                r.spacer("fill");
                r.badge(BadgeOptions::new("LIVE"));
            });
            f.ui.tabs(TabsOptions::new(TABS, tab), "tabs");
            f.ui.grid(
                GridSpec::new().columns(["1fr", "1fr"]).rows(["1fr"]).gap(1),
                |g| {
                    g.panel(Panel::new().title("Load"), Span::new(1, 1), |p| {
                        p.meter(MeterOptions::new(cpu_now).label("cpu"));
                        p.sparkline(SparklineWidgetOptions {
                            values: net.clone(),
                            label: Some("net".into()),
                            text: Some(format!("{net_now:.0}M")),
                            ..Default::default()
                        });
                        p.graph(
                            GraphOptions::series(vec![
                                Series::new(cpu.iter().map(|v| v * 100.0).collect::<Vec<_>>())
                                    .label("cpu"),
                                Series::new(net.clone()).label("net"),
                            ])
                            .with_axis()
                            .with_legend()
                            .filled(),
                        );
                    });
                    g.panel(Panel::new().title("Processes"), Span::new(1, 1), |p| {
                        p.table(
                            TableOptions {
                                rows,
                                columns: vec![
                                    TableColumn::new("PID").align(Align::Right),
                                    TableColumn::new("NAME"),
                                    TableColumn::new("CPU%").align(Align::Right),
                                ],
                                selected: Some(selected),
                                follow_selection: true,
                                zebra: true,
                                scrollbar: true,
                                ..Default::default()
                            },
                            "procs",
                        );
                    });
                },
            );
            f.ui.status_bar(StatusBarOptions {
                items: vec![
                    StatusItem::new("quit").key("q"),
                    StatusItem::new("select").key("↑↓"),
                    StatusItem::new("tab").key("←→"),
                ],
                right: vec![StatusItem::new(format!("{}x{}", f.width, f.height))],
                ..Default::default()
            });
        })?;
    }

    app.restore();
    Ok(())
}
