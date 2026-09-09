//! Direct native layout ports of the telemetry screens.
use crate::{dashboard::*, model::*};
use hqtui::{color::Color, prelude::*, unicode::Align};
use serde_json::Value;

pub fn panel(title: impl Into<String>, color: Color) -> Panel {
    let mut p = Panel::new().title(title);
    p.border_color = Some(color);
    p
}
pub fn col(
    key: &'static str,
    title: &str,
    width: usize,
    min: usize,
    color: Option<Color>,
    right: bool,
) -> (&'static str, TableColumn) {
    let mut c = TableColumn::new(title);
    if width > 0 {
        c.width = Some(width.into());
    }
    if min > 0 {
        c.min = Some(min);
    }
    c.color = color;
    if right {
        c.align = Align::Right;
    }
    (key, c)
}
pub fn table(
    p: &mut Container<'_>,
    s: &State,
    id: &str,
    data: Vec<Value>,
    cols: Vec<(&str, TableColumn)>,
    zebra: bool,
    header: bool,
) {
    let mut panes = s.panes.borrow_mut();
    let pane = panes.entry(id.into()).or_default();
    pane.total = data.len();
    pane.move_by(0);
    pane.offset = resolve_offset(
        Some(pane.offset),
        Some(pane.selected),
        p.height().saturating_sub(if header { 1 } else { 0 }),
        pane.total,
        true,
    );
    let rows = data
        .iter()
        .map(|row| {
            let mut r = TableRow::new(cols.iter().map(|(key, _)| {
                if id == "services.filesystems" {
                    match *key {
                        "size" | "used" => return bytes(n(&row[*key]), 0),
                        "pct" => {
                            return if n(&row["size"]) > 0. {
                                percent(n(&row["used"]) / n(&row["size"]))
                            } else {
                                "-".into()
                            }
                        }
                        "inodes" => {
                            return if n(&row["inodesTotal"]) > 0. {
                                format!(
                                    "{} of {:.1}M",
                                    percent(n(&row["inodesUsed"]) / n(&row["inodesTotal"])),
                                    n(&row["inodesTotal"]) / 1e6
                                )
                            } else {
                                "-".into()
                            }
                        }
                        _ => {}
                    }
                }
                text(&row[*key])
            }));
            r.cell_colors = cols
                .iter()
                .map(|(key, c)| {
                    if id == "sessions.logins" && *key == "status" {
                        Some(if text(&row[*key]) == "still" {
                            p.theme().success
                        } else {
                            p.theme().muted
                        })
                    } else if id == "services.units" && *key == "active" {
                        Some(match text(&row[*key]).as_str() {
                            "failed" => p.theme().danger,
                            "active" => p.theme().success,
                            _ => p.theme().muted,
                        })
                    } else if id == "services.filesystems" && *key == "pct" {
                        Some(
                            if n(&row["size"]) > 0. && n(&row["used"]) / n(&row["size"]) > 0.9 {
                                p.theme().danger
                            } else {
                                p.theme().warning
                            },
                        )
                    } else if id == "traffic.ssh" && *key == "action" {
                        Some(match text(&row[*key]).as_str() {
                            "accepted" => p.theme().success,
                            "disconnect" => p.theme().muted,
                            _ => p.theme().danger,
                        })
                    } else if id == "traffic.requests" && *key == "status" {
                        Some(status_color(
                            p.theme(),
                            &format!("{}xx", text(&row[*key]).chars().next().unwrap_or('0')),
                        ))
                    } else {
                        c.color
                    }
                })
                .collect();
            r
        })
        .collect();
    p.table(
        TableOptions {
            rows,
            columns: cols.into_iter().map(|(_, c)| c).collect(),
            selected: Some(pane.selected),
            offset: Some(pane.offset),
            follow_selection: true,
            scrollbar: id != "components.files",
            zebra,
            header,
            ..Default::default()
        },
        id,
    );
}

fn rate(v: f64) -> String {
    if v >= 1e6 {
        format!("{:.1}M/s", v / 1e6)
    } else if v >= 1000. {
        format!("{:.1}K/s", v / 1000.)
    } else {
        format!("{v:.0}/s")
    }
}
fn kernel_rate(v: f64) -> String {
    if v >= 1000. {
        format!("{:.1}K/s", v / 1000.)
    } else {
        format!("{v:.0}/s")
    }
}
fn commas(v: f64) -> String {
    let raw = format!("{v:.0}");
    raw.chars()
        .enumerate()
        .map(|(i, c)| {
            if i > 0 && (raw.len() - i) % 3 == 0 {
                format!(",{c}")
            } else {
                c.to_string()
            }
        })
        .collect()
}
fn status_color(t: &hqtui::theme::Theme, class: &str) -> Color {
    match class {
        "2xx" => t.success,
        "3xx" => t.accent,
        "4xx" => t.warning,
        "5xx" => t.danger,
        "1xx" => t.secondary,
        _ => t.muted,
    }
}
pub fn services<'a>(ui: &mut Container<'a>, s: &'a State) {
    let gap = s.panel_gap();
    let d = &s.sample["telemetry"];
    ui.row(Row::new().gap(gap), move |r| {
        let failed = array(&d["services"])
            .iter()
            .filter(|v| text(&v["active"]) == "failed")
            .count();
        let mut opts = panel(
            "Services",
            if failed > 0 {
                r.theme().danger
            } else {
                r.theme().success
            },
        )
        .subtitle(if failed > 0 {
            format!("{failed} failed")
        } else {
            format!("{} units", array(&d["services"]).len())
        });
        opts.subtitle_color = Some(if failed > 0 {
            r.theme().danger
        } else {
            r.theme().muted
        });
        r.panel(opts, move |p| {
            if array(&d["services"]).is_empty() {
                p.label("systemd not available on this host.");
                return;
            }
            let t = p.theme();
            let cols = vec![
                col("name", "Unit", 0, 18, Some(t.primary), false),
                col("active", "Active", 10, 0, None, false),
                col("sub", "Sub", 10, 0, Some(t.muted), false),
                col("description", "Description", 0, 16, Some(t.muted), false),
            ];
            table(
                p,
                s,
                "services.units",
                array(&d["services"]).to_vec(),
                cols,
                true,
                true,
            );
        });
        r.column(Column::new().size("0.85fr").gap(gap).bordered(true), move |c| {
            c.panel(panel("Kernel", c.theme().accent).size(11), move |p| {
                let t = p.theme().clone();
                let k = &d["kernel"];
                kv(
                    p,
                    vec![
                        item(
                            "Context switches",
                            kernel_rate(n(&k["contextSwitchRate"])),
                            t.accent,
                        ),
                        item("Interrupts", kernel_rate(n(&k["interruptRate"])), t.accent),
                        item("Forks", kernel_rate(n(&k["forkRate"])), t.accent),
                        item("Procs running", text(&k["procsRunning"]), t.success),
                        item(
                            "Procs blocked",
                            text(&k["procsBlocked"]),
                            if n(&k["procsBlocked"]) > 0. {
                                t.warning
                            } else {
                                t.muted
                            },
                        ),
                        item(
                            "Open file descriptors",
                            commas(n(&k["openFiles"])),
                            t.primary,
                        ),
                        item(
                            "Entropy available",
                            text(&k["entropy"]),
                            if n(&k["entropy"]) < 200. {
                                t.warning
                            } else {
                                t.success
                            },
                        ),
                        item(
                            "Page in / out",
                            format!(
                                "{:.0}K / {:.0}K",
                                n(&k["pageIn"]) / 1000.,
                                n(&k["pageOut"]) / 1000.
                            ),
                            t.muted,
                        ),
                    ],
                    true,
                );
            });
            c.panel(panel("Containers", c.theme().primary).size(9), move |p| {
                if array(&d["containers"]).is_empty() {
                    p.label("No running containers.");
                    p.label("(docker not installed or not reachable)");
                    return;
                }
                let t = p.theme();
                let cols = vec![
                    col("name", "Name", 0, 12, Some(t.primary), false),
                    col("image", "Image", 0, 14, Some(t.muted), false),
                    col("status", "Status", 0, 12, Some(t.success), false),
                ];
                table(
                    p,
                    s,
                    "services.containers",
                    array(&d["containers"]).to_vec(),
                    cols,
                    true,
                    true,
                );
            });
            c.panel(panel("Hardware", c.theme().warning), move |p| {
                let t = p.theme().clone();
                let mut rows = vec![];
                let power = &d["power"];
                if power.is_object() {
                    rows.extend([
                        item(
                            "Battery",
                            format!(
                                "{}% ({})",
                                text(&power["battery"]),
                                text(&power["timeRemaining"])
                            ),
                            t.success,
                        ),
                        item(
                            "AC",
                            if power["acConnected"].as_bool().unwrap_or(false) {
                                "connected"
                            } else {
                                "on battery"
                            },
                            t.muted,
                        ),
                        item(
                            "Draw",
                            format!("{:.1} W", n(&power["powerDraw"])),
                            t.warning,
                        ),
                    ]);
                }
                for gpu in array(&d["gpus"]) {
                    rows.extend([
                        item(
                            &text(&gpu["name"]),
                            format!(
                                "{} · {}°C",
                                percent(n(&gpu["utilization"])),
                                text(&gpu["temperature"])
                            ),
                            t.accent,
                        ),
                        item(
                            "GPU memory",
                            format!(
                                "{} / {}",
                                bytes(n(&gpu["memoryUsed"]), 2),
                                bytes(n(&gpu["memoryTotal"]), 2)
                            ),
                            t.muted,
                        ),
                    ]);
                }
                if rows.is_empty() {
                    p.label("No battery or GPU telemetry on this host.");
                } else {
                    kv(p, rows, true);
                }
            });
        });
    });
    ui.panel(
        panel("Filesystems", ui.theme().secondary).size(10),
        move |p| {
            if array(&d["filesystems"]).is_empty() {
                p.label("No filesystems reported.");
                return;
            }
            let t = p.theme();
            let cols = vec![
                col("mount", "Mount", 0, 14, Some(t.primary), false),
                col("device", "Device", 0, 12, Some(t.muted), false),
                col("type", "Type", 8, 0, Some(t.muted), false),
                col("size", "Size", 10, 0, None, true),
                col("used", "Used", 10, 0, None, true),
                col("pct", "Use%", 6, 0, None, true),
                col("inodes", "Inodes", 16, 0, Some(t.muted), true),
            ];
            table(
                p,
                s,
                "services.filesystems",
                array(&d["filesystems"]).to_vec(),
                cols,
                true,
                true,
            );
        },
    );
}
pub fn traffic<'a>(ui: &mut Container<'a>, s: &'a State) {
    let gap = s.panel_gap();
    if s.real {
        ui.label("Protocol/direction: port-based estimates; HTTP rate: estimated from log growth");
    }
    let d = &s.sample["telemetry"];
    let net = &d["net"];
    let http = &d["http"];
    ui.row(Row::new().size(13).gap(gap), move |r| {
        r.panel(
            panel("Protocols", r.theme().accent).subtitle(format!(
                "{} in / {} out",
                text(&d["inboundConnections"]),
                text(&d["outboundConnections"])
            )),
            move |p| {
                let data = array(&d["protocols"]);
                if data.is_empty() {
                    p.label("No sockets visible.");
                    return;
                }
                let max = data.iter().map(|v| n(&v["total"])).fold(1., f64::max);
                p.meters(MetersOptions {
                    items: data
                        .iter()
                        .take(9)
                        .enumerate()
                        .map(|(i, b)| MeterItem {
                            label: text(&b["protocol"]),
                            value: n(&b["total"]) / max,
                            color: Some(hqtui::theme::series_color(p.theme(), i as i64)),
                            text: Some(text(&b["total"])),
                            ..Default::default()
                        })
                        .collect(),
                    label_width: Some(13),
                    value_width: Some(5),
                    ..Default::default()
                });
            },
        );
        r.panel(panel("TCP", r.theme().primary).size("0.9fr"), move |p| {
            let t = p.theme().clone();
            p.row(Row::new().size(1), move |r| {
                tx(
                    r,
                    format!("↓ {} seg", rate(n(&net["rates"]["inSegs"]))),
                    t.primary,
                );
                r.styled_text(
                    &format!("↑ {} seg", rate(n(&net["rates"]["outSegs"]))),
                    TextStyle::new().fg(t.secondary).align(Align::Right),
                );
            });
            multi(
                p,
                &d["netInHistory"],
                &d["netOutHistory"],
                t.primary,
                t.secondary,
            );
            p.divider(Default::default());
            kv(
                p,
                vec![
                    item("Established", text(&net["tcpEstablished"]), t.success),
                    item(
                        "Opens in/out",
                        format!(
                            "{} / {}",
                            rate(n(&net["rates"]["passiveOpens"])),
                            rate(n(&net["rates"]["activeOpens"]))
                        ),
                        t.accent,
                    ),
                    item("Resets sent", commas(n(&net["tcpOutRsts"])), t.muted),
                ],
                true,
            );
        });
        let warning = n(&net["retransRatio"]) > 0.02;
        r.panel(
            panel(
                "Retransmits",
                if warning {
                    r.theme().danger
                } else {
                    r.theme().success
                },
            )
            .size("0.7fr"),
            move |p| {
                let t = p.theme().clone();
                p.styled_text(
                    &format!("{:.2}%", n(&net["retransRatio"]).clamp(0., 1.) * 100.),
                    TextStyle::new()
                        .fg(if warning { t.danger } else { t.success })
                        .bold(),
                );
                p.label("of outbound segments");
                plot(p, &d["retransHistory"], t.danger, None, false);
                kv(
                    p,
                    vec![
                        item(
                            "UDP in/out",
                            format!(
                                "{} / {}",
                                rate(n(&net["rates"]["udpIn"])),
                                rate(n(&net["rates"]["udpOut"]))
                            ),
                            t.muted,
                        ),
                        item(
                            "ICMP",
                            format!(
                                "{} / {}",
                                text(&net["icmpInMsgs"]),
                                text(&net["icmpOutMsgs"])
                            ),
                            t.muted,
                        ),
                    ],
                    true,
                );
            },
        );
    });
    ui.row(Row::new().gap(gap), move |r| {
        r.column(Column::new().gap(gap).bordered(true), move |c| {
            c.panel(
                panel("HTTP", c.theme().success).subtitle(if http.is_object() {
                    format!("{:.1} req/s", n(&http["requestsPerSecond"]))
                } else {
                    "no access log".into()
                }),
                move |p| {
                    if !http.is_object() {
                        p.label("No readable HTTP access log.");
                        p.label("nginx, apache, httpd and caddy logs are");
                        p.label("root/adm readable — run with sudo to track requests.");
                        return;
                    }
                    let t = p.theme().clone();
                    p.row(Row::new().size(1), move |r| {
                        tx(r, text(&http["source"]), t.muted);
                        r.styled_text(
                            &format!("{} upgrades (ws)", text(&http["upgrades"])),
                            TextStyle::new().fg(t.secondary).align(Align::Right),
                        );
                    });
                    p.sized(6, move |g| {
                        plot(g, &http["history"], t.success, None, false)
                    });
                    p.divider(DividerOptions {
                        label: Some("status".into()),
                        ..Default::default()
                    });
                    let entries = array(&http["statusClasses"]);
                    let max = entries.iter().map(|v| n(&v["count"])).fold(1., f64::max);
                    p.meters(MetersOptions {
                        items: entries
                            .iter()
                            .map(|v| MeterItem {
                                label: text(&v["class"]),
                                value: n(&v["count"]) / max,
                                color: Some(status_color(&t, &text(&v["class"]))),
                                text: Some(text(&v["count"])),
                                ..Default::default()
                            })
                            .collect(),
                        label_width: Some(5),
                        value_width: Some(7),
                        ..Default::default()
                    });
                    p.divider(DividerOptions {
                        label: Some("top paths".into()),
                        ..Default::default()
                    });
                    let cols = vec![
                        col("path", "Path", 0, 20, Some(t.primary), false),
                        col("count", "Hits", 7, 0, Some(t.accent), true),
                    ];
                    // This table shares its parent with fixed-height widgets. Its own
                    // final rectangle, not the panel height, determines its viewport.
                    p.column(Column::new(), move |inner| {
                        table(
                            inner,
                            s,
                            "traffic.paths",
                            array(&http["topPaths"]).to_vec(),
                            cols,
                            false,
                            false,
                        )
                    });
                },
            );
        });
        r.column(Column::new().size("0.85fr").gap(gap).bordered(true), move |c| {
            c.panel(
                panel("SSH Activity", c.theme().warning)
                    .subtitle(array(&d["ssh"]).len().to_string()),
                move |p| {
                    if array(&d["ssh"]).is_empty() {
                        p.label("No sshd events in the journal.");
                        return;
                    }
                    let t = p.theme();
                    let cols = vec![
                        col("time", "Time", 9, 0, Some(t.muted), false),
                        col("action", "Action", 11, 0, None, false),
                        col("user", "User", 12, 0, Some(t.primary), false),
                        col("from", "From", 0, 14, Some(t.accent), false),
                        col("method", "Method", 10, 0, Some(t.muted), false),
                    ];
                    table(
                        p,
                        s,
                        "traffic.ssh",
                        array(&d["ssh"]).iter().rev().cloned().collect(),
                        cols,
                        true,
                        true,
                    );
                },
            );
            c.panel(
                panel("Top Remote Hosts", c.theme().secondary).size(10),
                move |p| {
                    if array(&d["remotes"]).is_empty() {
                        p.label("No remote peers.");
                        return;
                    }
                    let t = p.theme();
                    let cols = vec![
                        col("host", "Host", 0, 16, Some(t.accent), false),
                        col("connections", "Conns", 6, 0, Some(t.success), true),
                        col("protocols", "Protocols", 0, 12, Some(t.muted), false),
                    ];
                    table(
                        p,
                        s,
                        "traffic.remotes",
                        array(&d["remotes"]).to_vec(),
                        cols,
                        true,
                        true,
                    );
                },
            );
        });
    });
    if !array(&http["recent"]).is_empty() {
        ui.panel(
            panel("Recent Requests", ui.theme().primary).size(10),
            move |p| {
                let t = p.theme();
                let cols = vec![
                    col("time", "Time", 9, 0, Some(t.muted), false),
                    col("method", "Method", 7, 0, Some(t.secondary), false),
                    col("path", "Path", 0, 24, Some(t.primary), false),
                    col("status", "Status", 7, 0, None, true),
                    col("client", "Client", 16, 0, Some(t.accent), false),
                    col("bytes", "Bytes", 9, 0, Some(t.muted), true),
                ];
                table(
                    p,
                    s,
                    "traffic.requests",
                    array(&http["recent"]).to_vec(),
                    cols,
                    true,
                    true,
                );
            },
        );
    }
}
pub fn sessions<'a>(ui: &mut Container<'a>, s: &'a State) {
    let gap = s.panel_gap();
    let d = &s.sample["telemetry"];
    ui.row(Row::new().size(9).gap(gap), move |r| {
        r.panel(
            panel("Active Sessions", r.theme().success)
                .subtitle(array(&d["sessions"]).len().to_string()),
            move |p| {
                if array(&d["sessions"]).is_empty() {
                    p.label("No interactive sessions.");
                    p.label("(`who` reports nothing on this host)");
                    return;
                }
                let t = p.theme();
                let cols = vec![
                    col("user", "User", 12, 0, Some(t.primary), false),
                    col("tty", "TTY", 10, 0, None, false),
                    col("from", "From", 0, 12, Some(t.accent), false),
                    col("loginAt", "Login", 14, 0, Some(t.muted), false),
                    col("idle", "Idle", 8, 0, None, true),
                ];
                table(
                    p,
                    s,
                    "sessions.active",
                    array(&d["sessions"]).to_vec(),
                    cols,
                    false,
                    true,
                );
            },
        );
        r.panel(
            panel("Process States", r.theme().primary).size(34),
            move |p| {
                let t = p.theme().clone();
                let st = &d["states"];
                for (label, key, c) in [
                    ("run ", "running", t.success),
                    ("slp ", "sleeping", t.primary),
                    ("stop", "stopped", t.warning),
                    ("zomb", "zombie", t.danger),
                ] {
                    p.meter(MeterOptions {
                        label: Some(label.into()),
                        value: n(&st[key]) / n(&st["total"]).max(1.),
                        text: Some(text(&st[key])),
                        heat: Some(false),
                        color: Some(c),
                        ..Default::default()
                    });
                }
                p.spacer(1);
                kv(p, vec![item("Total", text(&st["total"]), t.accent)], true);
            },
        );
    });
    ui.row(Row::new().gap(gap), move |r| {
        r.panel(
            panel("Recent Logins", r.theme().accent)
                .subtitle(format!("{} from wtmp", array(&d["logins"]).len())),
            move |p| {
                if array(&d["logins"]).is_empty() {
                    p.label("No login history available.");
                    return;
                }
                let t = p.theme();
                let cols = vec![
                    col("user", "User", 12, 0, Some(t.primary), false),
                    col("tty", "TTY", 12, 0, Some(t.muted), false),
                    col("from", "From", 0, 14, Some(t.accent), false),
                    col("when", "When", 0, 16, Some(t.muted), false),
                    col("status", "Status", 8, 0, None, false),
                ];
                table(
                    p,
                    s,
                    "sessions.logins",
                    array(&d["logins"]).to_vec(),
                    cols,
                    true,
                    true,
                );
            },
        );
        r.column(Column::new().size("0.8fr").gap(gap).bordered(true), move |c| {
            c.panel(panel("Failed Logins", c.theme().danger), move |p| {
                if array(&d["failedLogins"]).is_empty() {
                    p.label("None recorded.");
                    p.label("(btmp is usually root-only)");
                    return;
                }
                let t = p.theme();
                let cols = vec![
                    col("user", "User", 12, 0, Some(t.danger), false),
                    col("from", "From", 0, 12, None, false),
                    col("when", "When", 0, 14, Some(t.muted), false),
                ];
                table(
                    p,
                    s,
                    "sessions.failed",
                    array(&d["failedLogins"]).to_vec(),
                    cols,
                    false,
                    true,
                );
            });
            c.panel(
                panel("Session History", c.theme().secondary).size(8),
                move |p| {
                    p.label("concurrent sessions");
                    plot(p, &d["sessionHistory"], p.theme().success, None, false);
                },
            );
        });
    });
}
pub fn network<'a>(ui: &mut Container<'a>, s: &'a State) {
    let gap = s.panel_gap();
    let d = &s.sample["telemetry"];
    ui.row(Row::new().size(13).gap(gap), move |r| {
        let all = array(&d["interfaces"]);
        let active: Vec<_> = all
            .iter()
            .filter(|i| n(&i["rxTotal"]) > 0. || text(&i["state"]) == "up")
            .collect();
        let shown = if active.is_empty() {
            all.iter().collect()
        } else {
            active
        };
        if shown.is_empty() {
            r.panel(Panel::new().title("Interfaces"), |p| {
                p.label("No interfaces reported.");
            });
            return;
        }
        for (index, iface) in shown.into_iter().take(3).enumerate() {
            let color = [r.theme().primary, r.theme().success, r.theme().secondary][index];
            r.panel(
                panel(
                    format!("{} ({})", text(&iface["name"]), text(&iface["state"])),
                    color,
                )
                .subtitle(text(&iface["ip"])),
                move |p| {
                    let t = p.theme().clone();
                    p.row(Row::new().size(1), move |r| {
                        tx(
                            r,
                            format!("↓ {}", byte_rate(n(&iface["rxRate"]))),
                            t.primary,
                        );
                        r.styled_text(
                            &format!("↑ {}", byte_rate(n(&iface["txRate"]))),
                            TextStyle::new().fg(t.secondary).align(Align::Right),
                        );
                    });
                    multi(
                        p,
                        &iface["rxHistory"],
                        &iface["txHistory"],
                        t.primary,
                        t.secondary,
                    );
                    p.divider(Default::default());
                    kv(
                        p,
                        vec![
                            item("RX total", bytes(n(&iface["rxTotal"]), 2), t.primary),
                            item("TX total", bytes(n(&iface["txTotal"]), 2), t.secondary),
                            item("MAC", text(&iface["mac"]), t.muted),
                            item(
                                "MTU / err / drop",
                                format!(
                                    "{} / {} / {}",
                                    text(&iface["mtu"]),
                                    text(&iface["errors"]),
                                    text(&iface["drops"])
                                ),
                                t.muted,
                            ),
                        ],
                        true,
                    );
                },
            );
        }
    });
    ui.row(Row::new().gap(gap), move |r| {
        r.panel(
            panel("Connections", r.theme().accent)
                .subtitle(format!("{} open", array(&d["connections"]).len())),
            move |p| {
                if array(&d["connections"]).is_empty() {
                    p.label("No connections visible (`ss` unavailable).");
                    return;
                }
                let t = p.theme();
                let cols = vec![
                    col("proto", "Proto", 6, 0, Some(t.muted), false),
                    col("local", "Local", 0, 18, None, false),
                    col("remote", "Remote", 0, 18, Some(t.accent), false),
                    col("state", "State", 10, 0, Some(t.success), false),
                    col("process", "Process", 0, 12, Some(t.primary), false),
                ];
                table(
                    p,
                    s,
                    "network.connections",
                    array(&d["connections"]).to_vec(),
                    cols,
                    true,
                    true,
                );
            },
        );
        r.column(Column::new().size("0.7fr").gap(gap).bordered(true), move |c| {
            c.panel(
                panel("Listening Ports", c.theme().warning)
                    .subtitle(array(&d["listeners"]).len().to_string()),
                move |p| {
                    let t = p.theme();
                    let cols = vec![
                        col("proto", "Proto", 6, 0, Some(t.muted), false),
                        col("port", "Port", 7, 0, Some(t.warning), true),
                        col("address", "Address", 0, 10, Some(t.muted), false),
                        col("process", "Process", 0, 10, Some(t.primary), false),
                    ];
                    table(
                        p,
                        s,
                        "network.listeners",
                        array(&d["listeners"]).to_vec(),
                        cols,
                        true,
                        true,
                    );
                },
            );
            c.panel(
                panel("Open Connections", c.theme().secondary).size(6),
                move |p| plot(p, &d["connectionHistory"], p.theme().accent, None, false),
            );
        });
    });
}
