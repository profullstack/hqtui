//! Native translation of apps/demo/src/screens/components.ts.
use crate::{
    dashboard::*,
    model::*,
    telemetry::{col, table},
};
use hqtui::{graphics::BarStyle, prelude::*, unicode::Align};
use serde_json::json;

fn node(label: &str, a: &str, b: &str, children: Vec<TreeNode>) -> TreeNode {
    TreeNode {
        label: label.into(),
        values: vec![
            TreeValue {
                text: a.into(),
                width: 6,
                ..Default::default()
            },
            TreeValue {
                text: b.into(),
                width: 6,
                ..Default::default()
            },
        ],
        children,
        expanded: Some(true),
        ..Default::default()
    }
}
pub fn render<'a>(ui: &mut Container<'a>, s: &'a State) {
    let gap = s.panel_gap();
    ui.row(Row::new().gap(gap), move |r| {
        r.column(Column::new().gap(gap).bordered(true), move |left| {
            left.panel(Panel::new().title("Buttons & Inputs").size(13), move |p| {
                p.row(Row::new().size(1).gap(1), |r| {
                    for (label, width, variant) in [
                        ("Primary", 11, ButtonVariant::Primary),
                        ("Success", 11, ButtonVariant::Success),
                        ("Warning", 11, ButtonVariant::Warning),
                        ("Danger", 10, ButtonVariant::Danger),
                    ] {
                        r.sized(width, move |c| {
                            c.button(
                                ButtonOptions {
                                    label: label.into(),
                                    width: Some(width),
                                    variant,
                                    ..Default::default()
                                },
                                &format!("button:{label}"),
                            );
                        });
                    }
                    r.spacer("fill");
                });
                p.spacer(1);
                p.row(Row::new().size(1).gap(2), move |r| {
                    r.sized(20, move |c| {
                        let names = ["Dark", "Dracula", "Nord", "Tokyo Night"];
                        c.select(
                            SelectOptions {
                                value: names[s.select_index.min(3)].into(),
                                width: Some(20),
                                open: s.select_open,
                                options: names.iter().map(|v| v.to_string()).collect(),
                                selected_index: Some(s.select_index),
                                ..Default::default()
                            },
                            "select",
                        );
                    });
                    r.sized(12, move |c| {
                        c.checkbox(
                            CheckboxOptions::new("Toggle", s.toggle)
                                .variant(CheckboxVariant::Toggle),
                            "toggle",
                        );
                    });
                    r.sized(14, move |c| {
                        c.checkbox(CheckboxOptions::new("Checkbox", s.checked), "check");
                    });
                    r.spacer("fill");
                });
                p.spacer(1);
                p.text_input(
                    TextInputOptions {
                        label: Some("Search".into()),
                        value: s.input.clone(),
                        placeholder: Some("type to filter…".into()),
                        focused: s.editing,
                        ..Default::default()
                    },
                    "input",
                );
                p.spacer(1);
                p.meter(MeterOptions {
                    label: Some("Slider".into()),
                    value: 0.7,
                    style: Some(BarStyle::Smooth),
                    heat: Some(false),
                    color: Some(p.theme().primary),
                    ..Default::default()
                });
                p.progress(ProgressOptions {
                    label: Some("Progress".into()),
                    value: 37.,
                    max: Some(120.),
                    show_count: true,
                    ..Default::default()
                });
            });
            left.panel(Panel::new().title("Table Widget"), move |p| {
                let data = json!([
                    {"name":"src","size":"4.2 KB","type":"dir","modified":"2m ago"},
                    {"name":"test","size":"1.1 KB","type":"dir","modified":"5m ago"},
                    {"name":"package.json","size":"1.2 KB","type":"file","modified":"10m ago"},
                    {"name":"README.md","size":"3.4 KB","type":"file","modified":"1h ago"},
                    {"name":"bun.lockb","size":"12 KB","type":"file","modified":"1h ago"}
                ]);
                let t = p.theme();
                let cols = vec![
                    col("name", "Name", 0, 10, Some(t.primary), false),
                    col("size", "Size", 9, 0, None, true),
                    col("type", "Type", 6, 0, None, false),
                    col("modified", "Modified", 10, 0, Some(t.muted), true),
                ];
                table(
                    p,
                    s,
                    "components.files",
                    array(&data).to_vec(),
                    cols,
                    true,
                    true,
                );
            });
            left.panel(Panel::new().title("Log Viewer").size(11), move |p| {
                let logs = array(&s.sample["logs"]);
                let mut panes = s.panes.borrow_mut();
                let pane = panes.entry("components.logs".into()).or_default();
                pane.total = logs.len();
                pane.log = true;
                p.log(
                    LogOptions {
                        entries: logs
                            .iter()
                            .map(|l| LogEntry {
                                time: Some(text(&l["time"])),
                                level: Some(text(&l["level"])),
                                message: text(&l["message"]),
                                meta: Some(format!("{{{}}}", text(&l["meta"]))),
                                ..Default::default()
                            })
                            .collect(),
                        from_end: Some(pane.offset),
                        scrollbar: true,
                        ..Default::default()
                    },
                    "components.logs",
                );
            });
        });
        r.column(Column::new().gap(gap).bordered(true), move |right| {
            right.panel(Panel::new().title("Process Tree").size(13), move |p| {
                let muted = p.theme().muted;
                p.row(Row::new().size(1), move |r| {
                    r.styled_text("Name", TextStyle::new().fg(muted).bold());
                    r.styled_text(
                        "CPU%   MEM%",
                        TextStyle::new().fg(muted).bold().align(Align::Right),
                    );
                });
                let mut panes = s.panes.borrow_mut();
                let pane = panes.entry("components.tree".into()).or_default();
                pane.total = 8;
                let roots = vec![node(
                    "systemd",
                    "1.3",
                    "0.1",
                    vec![
                        node("bash", "0.1", "0.2", vec![]),
                        node(
                            "bun",
                            "32.8",
                            "4.2",
                            vec![
                                node("bun:worker", "12.4", "1.8", vec![]),
                                node("bun:worker", "8.7", "1.3", vec![]),
                            ],
                        ),
                        node(
                            "node",
                            "18.1",
                            "2.1",
                            vec![node("node:worker", "6.1", "0.8", vec![])],
                        ),
                        node("postgres", "6.7", "1.8", vec![]),
                    ],
                )];
                pane.offset = resolve_offset(
                    Some(pane.offset),
                    Some(pane.selected),
                    p.height().saturating_sub(1),
                    8,
                    true,
                );
                p.tree(
                    TreeOptions {
                        nodes: roots,
                        selected: Some(pane.selected),
                        offset: Some(pane.offset),
                        follow_selection: true,
                        ..Default::default()
                    },
                    "components.tree",
                );
            });
            right.panel(
                Panel::new().title("Sparklines & Gauges").size(12),
                move |p| {
                    let t = p.theme().clone();
                    let d = &s.sample;
                    for (label, v, readout, c) in [
                        (
                            "CPU ",
                            &d["cpu"]["history"],
                            percent(n(&d["cpu"]["total"])),
                            t.success,
                        ),
                        (
                            "Mem ",
                            &d["memory"]["history"],
                            percent(n(&d["memory"]["used"]) / n(&d["memory"]["total"]).max(1.)),
                            t.warning,
                        ),
                        (
                            "Net ",
                            &d["network"]["downHistory"],
                            format!("{}/s", bytes(n(&d["network"]["downRate"]), 2)),
                            t.primary,
                        ),
                    ] {
                        p.sparkline(SparklineWidgetOptions {
                            label: Some(label.into()),
                            values: values(v),
                            text: Some(readout),
                            color: Some(c),
                            ..Default::default()
                        });
                    }
                    p.spacer(1);
                    p.row(Row::new().gap(2), move |r| {
                        r.gauge(GaugeOptions {
                            value: n(&d["cpu"]["total"]),
                            label: Some(percent(n(&d["cpu"]["total"]))),
                            ..Default::default()
                        });
                        r.donut(DonutOptions {
                            segments: vec![
                                DonutSegment {
                                    value: n(&d["memory"]["used"]),
                                    color: Some(t.primary),
                                    label: Some("Used".into()),
                                },
                                DonutSegment {
                                    value: n(&d["memory"]["available"]),
                                    color: Some(t.warning),
                                    label: Some("Free".into()),
                                },
                            ],
                            ..Default::default()
                        });
                    });
                },
            );
            right.panel(Panel::new().title("Lists & Badges"), move |p| {
                let t = p.theme().clone();
                p.row(Row::new().size(1).gap(1), move |r| {
                    for (label, color, width, variant) in [
                        ("active", t.success, 10, BadgeVariant::Filled),
                        ("idle", t.warning, 8, BadgeVariant::Subtle),
                        ("failed", t.danger, 10, BadgeVariant::Outline),
                    ] {
                        r.sized(width, move |c| {
                            c.badge(BadgeOptions::new(label).color(color).variant(variant));
                        });
                    }
                    r.spacer("fill");
                });
                p.spacer(1);
                let mut panes = s.panes.borrow_mut();
                let pane = panes.entry("components.list".into()).or_default();
                pane.total = 4;
                pane.offset = resolve_offset(
                    Some(pane.offset),
                    Some(pane.selected),
                    p.height().saturating_sub(2),
                    4,
                    true,
                );
                p.list(
                    ListOptions {
                        items: vec![
                            ListItem {
                                label: "apps/demo".into(),
                                color: Some(t.primary),
                                ..Default::default()
                            },
                            ListItem::new("packages/hqtui"),
                            ListItem::new("apps/web"),
                            ListItem::new("docs"),
                        ],
                        selected: Some(pane.selected),
                        offset: Some(pane.offset),
                        follow_selection: true,
                        bullet: Some("▸".into()),
                        scrollbar: true,
                        ..Default::default()
                    },
                    "components.list",
                );
            });
        });
    });
}
