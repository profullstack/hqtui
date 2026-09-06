//! Direct native port of apps/demo/src/screens/dashboard.ts.
//! Keep the responsive tracks, widget options and formatting aligned with it.
use crate::model::*;
use hqtui::{
    color::Color,
    graphics::{BarStyle, Series},
    prelude::*,
    theme::heat_color,
    unicode::Align,
};
use serde_json::Value;

pub fn bytes(v: f64, digits: usize) -> String {
    if !v.is_finite() {
        return "—".into();
    }
    let mut v = v.max(0.);
    let mut unit = 0;
    let units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    while v >= 1024. && unit < 5 {
        v /= 1024.;
        unit += 1;
    }
    format!(
        "{:.*} {}",
        if unit == 0 { 0 } else { digits },
        v,
        units[unit]
    )
}
pub fn percent(v: f64) -> String {
    format!("{:.0}%", (v.clamp(0., 1.) * 100.).round())
}
pub fn bit_rate(v: f64) -> String {
    let b = v.max(0.) * 8.;
    for (scale, unit) in [(1e9, "Gb/s"), (1e6, "Mb/s"), (1e3, "Kb/s")] {
        if b >= scale {
            return format!("{:.1} {unit}", b / scale);
        }
    }
    format!("{b:.0} b/s")
}
fn axis_bits(v: f64) -> String {
    bit_rate(v).replace(' ', "")
}
pub fn byte_rate(v: f64) -> String {
    for (scale, unit) in [(1e9, "GB/s"), (1e6, "MB/s"), (1e3, "KB/s")] {
        if v >= scale {
            return format!("{:.1} {unit}", v / scale);
        }
    }
    format!("{:.0} B/s", v.max(0.))
}
pub fn duration(v: f64) -> String {
    let v = v.max(0.) as u64;
    let (d, h, m) = (v / 86400, v % 86400 / 3600, v % 3600 / 60);
    if d > 0 {
        format!("{d}d {h}h {m}m")
    } else if h > 0 {
        format!("{h}h {m}m")
    } else {
        format!("{m}m {}s", v % 60)
    }
}
pub fn tx(p: &mut Container<'_>, v: impl AsRef<str>, c: Color) {
    p.styled_text(v.as_ref(), TextStyle::new().fg(c));
}
pub fn kv(p: &mut Container<'_>, rows: Vec<KeyValueRow>, spread: bool) {
    p.key_values(KeyValueOptions {
        rows,
        spread: Some(spread),
        ..Default::default()
    });
}
pub fn item(k: &str, v: impl Into<String>, c: Color) -> KeyValueRow {
    KeyValueRow::new(k, v).color(c)
}
pub fn plot(p: &mut Container<'_>, v: &Value, c: Color, max: Option<f64>, axis: bool) {
    let mut o = GraphOptions::new(values(v)).filled();
    o.plot.min = Some(0.);
    o.plot.max = max;
    o.plot.color = Some(c);
    o.axis = axis;
    p.graph(o);
}
pub fn multi(p: &mut Container<'_>, a: &Value, b: &Value, ca: Color, cb: Color) {
    let mut o = GraphOptions::series(vec![
        Series::new(values(a)).color(ca).filled(),
        Series::new(values(b)).color(cb).filled(),
    ]);
    o.plot.min = Some(0.);
    p.graph(o);
}
fn meter(p: &mut Container<'_>, value: f64, color: Option<Color>) {
    p.meter(MeterOptions {
        value,
        show_value: Some(false),
        style: Some(BarStyle::Segmented),
        color,
        heat: color.map(|_| false),
        ..Default::default()
    });
}
fn cpu<'a>(ui: &mut Container<'a>, s: &'a State, columns: usize) {
    let c = &s.sample["cpu"];
    ui.panel(
        Panel::new()
            .title("CPU Overview")
            .subtitle(percent(n(&c["total"]))),
        move |p| {
            let t = p.theme().clone();
            p.label(&format!(
                "{}   {:.1} GHz",
                text(&c["model"]),
                n(&c["frequencyGhz"])
            ));
            plot(p, &c["history"], t.success, Some(100.), false);
            p.meters(MetersOptions {
                items: array(&c["cores"])
                    .iter()
                    .enumerate()
                    .map(|(i, v)| MeterItem::new(format!("P{i}"), n(v)))
                    .collect(),
                columns: Some(columns),
                label_width: Some(4),
                value_width: Some(5),
                style: Some(BarStyle::Segmented),
                ..Default::default()
            });
            p.divider(Default::default());
            kv(
                p,
                vec![item(
                    "Load Avg",
                    format!(
                        "{:.2}   {:.2}   {:.2}",
                        n(&c["load"][0]),
                        n(&c["load"][1]),
                        n(&c["load"][2])
                    ),
                    t.warning,
                )],
                true,
            );
        },
    );
}
fn memory<'a>(ui: &mut Container<'a>, s: &'a State) {
    let m = &s.sample["memory"];
    let used = n(&m["used"]) / n(&m["total"]).max(1.);
    let swap = n(&m["swapUsed"]) / n(&m["swapTotal"]).max(1.);
    ui.panel(Panel::new().title("Memory & Swap"), move |p| {
        let t = p.theme().clone();
        tx(
            p,
            format!(
                "Memory      {} / {} ({})",
                bytes(n(&m["used"]), 2),
                bytes(n(&m["total"]), 2),
                percent(used)
            ),
            t.foreground,
        );
        meter(p, used, None);
        p.spacer(1);
        kv(
            p,
            vec![
                item("Used:", bytes(n(&m["used"]), 2), t.warning),
                item("Available:", bytes(n(&m["available"]), 2), t.success),
                item("Cached:", bytes(n(&m["cached"]), 2), t.accent),
                item("Buffers:", bytes(n(&m["buffers"]), 2), t.secondary),
                item("Free:", bytes(n(&m["free"]), 2), t.muted),
            ],
            true,
        );
        p.spacer("fill");
        p.divider(Default::default());
        tx(
            p,
            format!(
                "Swap        {} / {} ({})",
                bytes(n(&m["swapUsed"]), 2),
                bytes(n(&m["swapTotal"]), 2),
                percent(swap)
            ),
            t.foreground,
        );
        meter(p, swap, Some(t.secondary));
        kv(
            p,
            vec![
                item("Used:", bytes(n(&m["swapUsed"]), 2), t.secondary),
                item(
                    "Free:",
                    bytes((n(&m["swapTotal"]) - n(&m["swapUsed"])).max(0.), 2),
                    t.muted,
                ),
            ],
            true,
        );
    });
}
fn disks<'a>(ui: &mut Container<'a>, s: &'a State) {
    ui.panel(Panel::new().title("Disks"), move |p| {
        let t = p.theme().clone();
        let disks = array(&s.sample["disks"]);
        if disks.is_empty() {
            p.label("No disks reported");
            return;
        }
        for (i, d) in disks.iter().take(2).enumerate() {
            let used = n(&d["used"]) / n(&d["total"]).max(1.);
            tx(
                p,
                format!(
                    "{} — {} ({})",
                    text(&d["device"]),
                    bytes(n(&d["total"]), 2),
                    text(&d["type"])
                ),
                t.foreground,
            );
            tx(
                p,
                format!("Used: {} ({})", bytes(n(&d["used"]), 2), percent(used)),
                t.muted,
            );
            meter(p, used, None);
            tx(
                p,
                format!("Free: {}", bytes(n(&d["total"]) - n(&d["used"]), 2)),
                t.muted,
            );
            p.row(Row::new().size(1), move |r| {
                tx(
                    r,
                    format!("Read: {}", byte_rate(n(&d["readRate"]))),
                    t.success,
                );
                r.styled_text(
                    &format!("Write: {}", byte_rate(n(&d["writeRate"]))),
                    TextStyle::new().fg(t.secondary).align(Align::Right),
                );
            });
            multi(
                p,
                &d["readHistory"],
                &d["writeHistory"],
                t.success,
                t.secondary,
            );
            if i == 0 && disks.len() > 1 {
                p.divider(Default::default());
            }
        }
    });
}
fn system<'a>(ui: &mut Container<'a>, state: &'a State) {
    let s = &state.sample;
    ui.panel(Panel::new().title("System"), move |p| {
        let t = p.theme().clone();
        p.row(Row::new().size(6).min(6).gap(2), move |r| {
            kv(
                r,
                vec![
                    KeyValueRow::new("OS:", text(&s["system"]["os"])),
                    KeyValueRow::new("Kernel:", text(&s["system"]["kernel"])),
                    KeyValueRow::new("Uptime:", duration(n(&s["system"]["uptime"]))),
                    KeyValueRow::new("Hostname:", text(&s["system"]["hostname"])),
                    KeyValueRow::new("Shell:", text(&s["system"]["shell"])),
                    item(
                        "Source:",
                        if state.real { "real" } else { "simulated" },
                        t.accent,
                    ),
                ],
                false,
            );
            kv(
                r,
                vec![
                    item(
                        "CPU:",
                        percent(n(&s["cpu"]["total"])),
                        heat_color(&t, n(&s["cpu"]["total"])),
                    ),
                    item(
                        "Memory:",
                        format!(
                            "{} ({})",
                            percent(n(&s["memory"]["used"]) / n(&s["memory"]["total"]).max(1.)),
                            bytes(n(&s["memory"]["used"]), 2)
                        ),
                        t.warning,
                    ),
                    item(
                        "Swap:",
                        if n(&s["memory"]["swapTotal"]) > 0. {
                            percent(n(&s["memory"]["swapUsed"]) / n(&s["memory"]["swapTotal"]))
                        } else {
                            "—".into()
                        },
                        t.secondary,
                    ),
                    KeyValueRow::new(
                        "Load:",
                        format!(
                            "{:.2} {:.2} {:.2}",
                            n(&s["cpu"]["load"][0]),
                            n(&s["cpu"]["load"][1]),
                            n(&s["cpu"]["load"][2])
                        ),
                    ),
                    KeyValueRow::new("Processes:", text(&s["system"]["processCount"])),
                    KeyValueRow::new("Threads:", text(&s["system"]["threadCount"])),
                ],
                false,
            );
        });
        p.panel(
            Panel::new().title("CPU History").size("1fr").min(5),
            move |g| {
                plot(g, &s["cpu"]["history"], g.theme().success, Some(100.), true);
            },
        );
        if p.width() >= 46 && p.height() >= 16 {
            p.row(Row::new().size(6).gap(1), move |r| {
                r.panel(Panel::new().title("Quick Stats"), move |q| {
                    let c = q.theme().accent;
                    kv(
                        q,
                        vec![
                            item("Uptime", duration(n(&s["system"]["uptime"])), c),
                            item("Procs", text(&s["system"]["processCount"]), c),
                            item("Threads", text(&s["system"]["threadCount"]), c),
                            item(
                                "Ctx/s",
                                format!(
                                    "{:.1}K",
                                    n(&s["telemetry"]["kernel"]["contextSwitchRate"]) / 1000.
                                ),
                                c,
                            ),
                        ],
                        true,
                    );
                });
                r.panel(Panel::new().title("Memory"), move |q| {
                    tx(
                        q,
                        percent(n(&s["memory"]["used"]) / n(&s["memory"]["total"]).max(1.)),
                        q.theme().warning,
                    );
                    plot(
                        q,
                        &s["memory"]["history"],
                        q.theme().primary,
                        Some(100.),
                        false,
                    );
                });
                r.panel(Panel::new().title("Temp").size(14), move |q| {
                    let temp = &s["temperatures"][0];
                    let value = if temp.is_object() {
                        n(&temp["value"]) / n(&temp["max"]).max(1.)
                    } else {
                        n(&s["cpu"]["total"])
                    };
                    q.gauge(GaugeOptions {
                        value: value.min(1.),
                        label: Some(if temp.is_object() {
                            format!("{:.0}°C", n(&temp["value"]))
                        } else {
                            percent(value)
                        }),
                        ..Default::default()
                    });
                });
            });
        } else {
            p.divider(Default::default());
            kv(
                p,
                vec![
                    item(
                        "Threads",
                        text(&s["system"]["threadCount"]),
                        p.theme().accent,
                    ),
                    item(
                        "Ctx switches",
                        format!("{:.1}K", n(&s["system"]["contextSwitches"]) / 1000.),
                        p.theme().accent,
                    ),
                ],
                true,
            );
        }
    });
}
fn processes<'a>(ui: &mut Container<'a>, s: &'a State) {
    let mut opts = Panel::new()
        .title(format!(
            "Processes (sorted by {})",
            ["CPU", "MEM", "PID", "NAME"][s.sort]
        ))
        .focusable("dashboard.panel");
    if !s.filter.is_empty() {
        opts = opts.subtitle(format!("filter: {}", s.filter));
    }
    ui.panel(opts, move |p| {
        let t = p.theme().clone();
        let data = s.processes();
        let mut panes = s.panes.borrow_mut();
        let pane = panes.entry("dashboard.processes".into()).or_default();
        pane.total = data.len();
        pane.move_by(0);
        pane.offset = resolve_offset(
            Some(pane.offset),
            Some(pane.selected),
            p.height().saturating_sub(1),
            pane.total,
            true,
        );
        let mut name = TableColumn::new("Name").color(t.primary);
        name.min = Some(8);
        let mut command = TableColumn::new("Command").color(t.muted);
        command.min = Some(10);
        p.table(
            TableOptions {
                rows: data
                    .iter()
                    .map(|r| {
                        let mut row = TableRow::new([
                            text(&r["pid"]),
                            text(&r["name"]),
                            format!("{:.1}", n(&r["cpu"])),
                            format!("{:.1}", n(&r["mem"])),
                            bytes(n(&r["rss"]), 0),
                            text(&r["threads"]),
                            text(&r["state"]),
                            text(&r["user"]),
                            text(&r["command"]),
                        ]);
                        row.cell_colors = vec![
                            None,
                            Some(t.primary),
                            Some(heat_color(&t, (n(&r["cpu"]) / 100.).min(1.))),
                            Some(t.warning),
                            None,
                            None,
                            Some(if text(&r["state"]) == "R" {
                                t.success
                            } else {
                                t.muted
                            }),
                            Some(t.muted),
                            Some(t.muted),
                        ];
                        row
                    })
                    .collect(),
                columns: vec![
                    TableColumn::new("PID").width(7).align(Align::Right),
                    name,
                    TableColumn::new("CPU%").width(6).align(Align::Right),
                    TableColumn::new("MEM%")
                        .width(6)
                        .align(Align::Right)
                        .color(t.warning),
                    TableColumn::new("RSS").width(9).align(Align::Right),
                    TableColumn::new("Threads").width(7).align(Align::Right),
                    TableColumn::new("S").width(2),
                    TableColumn::new("User").width(10).color(t.muted),
                    command,
                ],
                selected: Some(pane.selected),
                offset: Some(pane.offset),
                follow_selection: true,
                scrollbar: true,
                ..Default::default()
            },
            "dashboard.processes",
        );
    });
}
fn network<'a>(ui: &mut Container<'a>, s: &'a State) {
    let net = &s.sample["network"];
    ui.panel(Panel::new().title("Network"), move |p| {
        let t = p.theme().clone();
        p.row(Row::new().size(1), move |r| {
            tx(
                r,
                format!("Download: {}", bit_rate(n(&net["downRate"]))),
                t.primary,
            );
            r.styled_text(
                &format!("Upload: {}", bit_rate(n(&net["upRate"]))),
                TextStyle::new().fg(t.secondary).align(Align::Right),
            );
        });
        for (key, c) in [("downHistory", t.primary), ("upHistory", t.secondary)] {
            let mut o = GraphOptions::new(values(&net[key])).filled().with_axis();
            o.plot.color = Some(c);
            o.plot.min = Some(0.);
            o.axis_format = Some(axis_bits);
            p.graph(o);
        }
        p.divider(Default::default());
        p.row(Row::new().size(3).gap(2), move |r| {
            for (dir, c) in [("down", t.primary), ("up", t.secondary)] {
                kv(
                    r,
                    vec![
                        item("Total:", bytes(n(&net[format!("{dir}Total")]), 2), c),
                        item("Current:", bit_rate(n(&net[format!("{dir}Rate")])), c),
                        item("Peak:", bit_rate(n(&net[format!("{dir}Peak")])), c),
                    ],
                    false,
                );
            }
        });
    });
}
fn disk_usage<'a>(ui: &mut Container<'a>, s: &'a State) {
    ui.panel(
        Panel::new()
            .title("Disk Usage")
            .subtitle(text(&s.sample["disks"][0]["device"])),
        move |p| {
            for d in array(&s.sample["disks"]) {
                let used = n(&d["used"]) / n(&d["total"]).max(1.);
                p.meter(MeterOptions {
                    value: used,
                    text: Some(format!(
                        "{} {} / {}",
                        percent(used),
                        bytes(n(&d["used"]), 0),
                        bytes(n(&d["total"]), 0)
                    )),
                    style: Some(BarStyle::Segmented),
                    ..Default::default()
                });
                p.label(&format!("{} ({})", text(&d["mount"]), text(&d["device"])));
            }
            p.spacer(1);
            p.panel(Panel::new().title("I/O Summary"), move |io| {
                io.row(Row::new().gap(2), move |r| {
                    for (dir, color) in
                        [("read", r.theme().success), ("write", r.theme().secondary)]
                    {
                        r.column(Column::new(), move |c| {
                            let d = &s.sample["disks"][0];
                            tx(
                                c,
                                format!(
                                    "{}: {}",
                                    if dir == "read" { "Read" } else { "Write" },
                                    byte_rate(n(&d[format!("{dir}Rate")]))
                                ),
                                color,
                            );
                            plot(c, &d[format!("{dir}History")], color, None, false);
                        });
                    }
                });
            });
        },
    );
}
fn temperatures<'a>(ui: &mut Container<'a>, s: &'a State) {
    ui.panel(Panel::new().title("Temperatures"), move |p| {
        if array(&s.sample["temperatures"]).is_empty() {
            p.label("No thermal sensors on this host.");
            p.spacer(1);
            p.label("Run with --sim to see this panel populated.");
            return;
        }
        for temp in array(&s.sample["temperatures"]).iter().take(10) {
            p.row(Row::new().size(1), move |r| {
                let t = r.theme().clone();
                let v = (n(&temp["value"]) / n(&temp["max"]).max(1.)).min(1.);
                r.sized(16, move |c| {
                    tx(c, text(&temp["label"]), t.muted);
                });
                r.heat_bar(HeatBarOptions {
                    value: v,
                    ..Default::default()
                });
                let color = heat_color(&t, v);
                r.sized(6, move |c| {
                    c.styled_text(
                        &format!("{:.0}°C", n(&temp["value"])),
                        TextStyle::new().fg(color).align(Align::Right),
                    );
                });
            });
        }
    });
}
fn sensors<'a>(ui: &mut Container<'a>, s: &'a State) {
    ui.panel(Panel::new().title("Sensors"), move |p| {
        if array(&s.sample["sensors"]).is_empty() {
            p.label("No hardware sensors on this host.");
            p.spacer(1);
            p.label("Probed: /sys/class/hwmon, thermal zones, lm-sensors,");
            p.label("power supplies and nvidia-smi.");
            return;
        }
        kv(
            p,
            array(&s.sample["sensors"])
                .iter()
                .map(|v| item(&text(&v["label"]), text(&v["value"]), p.theme().accent))
                .collect(),
            true,
        );
    });
}
fn logs<'a>(ui: &mut Container<'a>, s: &'a State) {
    ui.panel(Panel::new().title("Logs"), move |p| {
        let logs = array(&s.sample["logs"]);
        let mut panes = s.panes.borrow_mut();
        let pane = panes.entry("dashboard.logs".into()).or_default();
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
            "dashboard.logs",
        );
    });
}
pub fn render<'a>(ui: &mut Container<'a>, s: &'a State) {
    if ui.width() >= 150 {
        ui.row(
            Row::new()
                .size(if ui.height() >= 44 { 19 } else { 16 })
                .gap(1),
            move |r| {
                r.column(Column::new().size("1fr"), move |c| cpu(c, s, 2));
                r.column(Column::new().size("0.95fr"), move |c| memory(c, s));
                r.column(Column::new().size("0.95fr"), move |c| disks(c, s));
                r.column(Column::new().size("1.35fr"), move |c| system(c, s));
            },
        );
        ui.row(Row::new().size("1fr").gap(1), move |r| {
            r.column(Column::new().size("2fr"), move |c| processes(c, s));
            r.column(Column::new().size("1.2fr"), move |c| network(c, s));
            r.column(Column::new().size("1.2fr"), move |c| disk_usage(c, s));
        });
        ui.row(Row::new().size(12).gap(1), move |r| {
            temperatures(r, s);
            sensors(r, s);
            r.column(Column::new().size("1.6fr"), move |c| logs(c, s));
        });
    } else if ui.width() >= 100 {
        ui.row(Row::new().size(14).gap(1), move |r| {
            cpu(r, s, 2);
            memory(r, s);
            system(r, s);
        });
        ui.row(Row::new().size("1fr").gap(1), move |r| {
            r.column(Column::new().size("1.6fr"), move |c| processes(c, s));
            r.column(Column::new(), move |c| network(c, s));
        });
        ui.row(Row::new().size(10).gap(1), move |r| {
            temperatures(r, s);
            logs(r, s);
        });
    } else {
        ui.row(Row::new().size(10).gap(1), move |r| {
            cpu(r, s, 1);
            memory(r, s);
        });
        ui.column(Column::new(), move |c| processes(c, s));
        ui.row(Row::new().size(8).gap(1), move |r| network(r, s));
    }
}
