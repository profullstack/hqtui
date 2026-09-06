//! Native translations of the TypeScript graphics, themes, input and stress screens.
use crate::{dashboard::*, model::*};
use hqtui::{
    buffer::Style,
    color::Gradient,
    graphics::{FillMode, Series},
    prelude::*,
    theme::theme_list,
};

pub fn graphics<'a>(ui: &mut Container<'a>, s: &'a State) {
    let time = n(&s.sample["time"]);
    ui.row(Row::new().gap(1), move |r| {
        r.column(Column::new().gap(1), move |left| {
            for (title, mode) in [
                ("Braille (2×4 pixels per cell)", FillMode::Braille),
                ("Block elements", FillMode::Block),
                ("ASCII fallback", FillMode::Ascii),
            ] {
                left.panel(Panel::new().title(title), move |p| {
                    let mut o = GraphOptions::new(wave(time / 3., 9.));
                    o.plot.min = Some(0.);
                    o.plot.max = Some(100.);
                    o.plot.mode = Some(mode);
                    match mode {
                        FillMode::Braille => {
                            o.plot.fill = Some(true);
                            o.plot.color = Some(p.theme().accent);
                            o.plot.grid = true;
                        }
                        FillMode::Block => o.plot.colors = Some(p.theme().heat.clone()),
                        _ => o.plot.color = Some(p.theme().foreground),
                    }
                    p.graph(o);
                });
            }
        });
        r.column(Column::new().gap(1), move |right| {
            right.panel(Panel::new().title("Multi-series"), move |p| {
                let t = p.theme();
                let mut o = GraphOptions::series(vec![
                    Series::new(wave(time / 3., 9.))
                        .color(t.primary)
                        .label("alpha"),
                    Series::new(wave(time / 3. + 2., 5.))
                        .color(t.success)
                        .label("beta"),
                    Series::new(wave(time / 2., 17.))
                        .color(t.secondary)
                        .label("gamma"),
                ])
                .with_axis()
                .with_legend();
                o.plot.min = Some(0.);
                o.plot.max = Some(100.);
                p.graph(o);
            });
            right.panel(Panel::new().title("Gradients"), |p| {
                p.draw(|surface| {
                    let steps = Gradient::new(&surface.theme.heat).steps(surface.width());
                    for y in 0..surface.height() {
                        for (x, &c) in steps.iter().enumerate() {
                            surface.glyph(x as isize, y as isize, '█', &Style::new().with_fg(c));
                        }
                    }
                });
            });
            right.panel(Panel::new().title("Raw Braille canvas"), move |p| {
                p.canvas(Some(p.theme().accent), move |c| {
                    let (cx, cy) = (c.width as f64 / 2., c.height as f64 / 2.);
                    let r = cx.min(cy) - 2.;
                    c.circle(cx, cy, r);
                    for i in 0..12 {
                        let a = i as f64 / 12. * std::f64::consts::TAU + time / 4.;
                        c.line(cx, cy, cx + a.cos() * r, cy + a.sin() * r * 0.9);
                    }
                });
            });
        });
    });
}
fn wave(phase: f64, freq: f64) -> Vec<f64> {
    (0..240)
        .map(|i| (i as f64 / freq + phase).sin() * 50. + 50.)
        .collect()
}
pub fn themes<'a>(ui: &mut Container<'a>, s: &'a State) {
    ui.label(&format!(
        "Theme {}/9: {}   ←/→ or F2 to change",
        s.theme + 1,
        ui.theme().name
    ));
    ui.spacer(1);
    ui.grid(
        GridSpec::new().column_count(3).row_count(3).gap(1),
        move |g| {
            for (i, (_, entry)) in theme_list().into_iter().enumerate() {
                let mut opts = Panel::new().title(&entry.name).background(entry.background);
                opts.border_color = Some(if i == s.theme {
                    entry.border_focused
                } else {
                    entry.border
                });
                g.panel(opts, Span::new(1, 1), move |p| {
                    let e = entry.clone();
                    p.row(Row::new().size(1).gap(1), move |r| {
                        for (label, color, width) in [
                            ("primary", e.primary, 10),
                            ("ok", e.success, 5),
                            ("warn", e.warning, 7),
                            ("err", e.danger, 6),
                        ] {
                            r.sized(width, move |c| {
                                c.badge(BadgeOptions::new(label).color(color));
                            });
                        }
                        r.spacer("fill");
                    });
                    p.meter(MeterOptions {
                        value: 0.72,
                        label: Some("cpu".into()),
                        background: Some(entry.background),
                        ..Default::default()
                    });
                    let mut o = GraphOptions::new(values(&s.sample["cpu"]["history"])).filled();
                    o.plot.min = Some(0.);
                    o.plot.max = Some(100.);
                    o.plot.color = Some(entry.graph[0]);
                    o.plot.background = Some(entry.background);
                    p.graph(o);
                    p.sized(1, move |c| {
                        c.draw(move |surface| {
                            for (ci, &color) in entry.graph.iter().enumerate() {
                                for x in 0..3 {
                                    surface.glyph(
                                        (ci * 4 + x) as isize,
                                        0,
                                        '█',
                                        &Style::new().with_fg(color).with_bg(entry.background),
                                    );
                                }
                            }
                        });
                    });
                });
            }
        },
    );
}
pub fn input<'a>(ui: &mut Container<'a>, s: &'a State) {
    ui.row(Row::new().gap(1), move |r| {
        r.panel(Panel::new().title("Last Events"), move |p| {
            kv(
                p,
                vec![
                    item("Key", s.last_key.clone(), p.theme().accent),
                    item("Mouse", s.last_mouse.clone(), p.theme().primary),
                ],
                true,
            );
            p.spacer(1);
            p.divider(DividerOptions {
                label: Some("history".into()),
                ..Default::default()
            });
            p.list(
                ListOptions {
                    items: s
                        .key_log
                        .iter()
                        .rev()
                        .take(20)
                        .map(|v| ListItem::new(text(v)))
                        .collect(),
                    ..Default::default()
                },
                "input.events",
            );
        });
        r.panel(Panel::new().title("Try it"), move |p| {
            tx(
                p,
                "Press any key — modifiers are normalized.",
                p.theme().foreground,
            );
            p.label("Arrows, Function keys, Ctrl/Alt/Shift combinations,");
            p.label("paste, focus, mouse move, click, drag and scroll.");
            p.spacer(1);
            p.divider(DividerOptions {
                label: Some("focusable controls".into()),
                ..Default::default()
            });
            p.spacer(1);
            p.row(Row::new().size(1).gap(2), move |r| {
                for (name, variant) in [
                    ("Button A", ButtonVariant::Primary),
                    ("Button B", ButtonVariant::Success),
                ] {
                    r.sized(12, move |c| {
                        c.button(
                            ButtonOptions {
                                label: name.into(),
                                width: Some(12),
                                variant,
                                ..Default::default()
                            },
                            name,
                        );
                    });
                }
                r.sized(12, move |c| {
                    c.checkbox(CheckboxOptions::new("Check", s.checked), "check");
                });
                r.spacer("fill");
            });
            p.spacer(1);
            p.label("Tab / Shift+Tab moves focus. Enter activates.");
            p.spacer("fill");
            kv(
                p,
                vec![
                    KeyValueRow::new("Mouse tracking", "on"),
                    KeyValueRow::new("Bracketed paste", "on"),
                    KeyValueRow::new("Focus events", "on"),
                ],
                true,
            );
        });
    });
}
pub fn stress<'a>(ui: &mut Container<'a>, s: &'a State) {
    ui.row(Row::new().size(3).gap(1), move |r| {
        for (title, value, color) in [
            (
                "Render",
                format!("{:.2} ms/frame", s.render_ms),
                r.theme().success,
            ),
            (
                "Changed cells",
                s.changed_cells.to_string(),
                r.theme().warning,
            ),
            ("Bytes/frame", s.bytes.to_string(), r.theme().primary),
            ("FPS", format!("{:.1}", s.fps), r.theme().accent),
        ] {
            r.panel(Panel::new().title(title), move |p| tx(p, value, color));
        }
    });
    let time = n(&s.sample["time"]);
    ui.panel(Panel::new().title("Full-screen churn"), move |p| {
        p.draw(move |surface| {
            let ramp = Gradient::new(&surface.theme.graph);
            let chars: Vec<_> = "▖▗▘▙▚▛▜▝▞▟█▓▒░".chars().collect();
            for y in 0..surface.height() {
                for x in 0..surface.width() {
                    let v = ((x as f64 / 6. + time).sin() + (y as f64 / 4. - time).cos()) / 2.;
                    let n = (v + 1.) / 2.;
                    surface.glyph(
                        x as isize,
                        y as isize,
                        chars[(n * (chars.len() - 1) as f64).floor() as usize],
                        &Style::new().with_fg(ramp.sample(n)),
                    );
                }
            }
        });
    });
}
