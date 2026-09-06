use crate::model::*;
use hqtui::prelude::*;

pub fn render<'a>(ui: &mut Container<'a>, s: &'a State) {
    let t = ui.theme().clone();
    ui.row(Row::new().size(1), move |r| {
        r.sized(12, move |c| {
            c.styled_text(" hqtui.com", TextStyle::new().fg(t.title).bold());
        });
        r.tabs(
            TabsOptions::new(
                SCREENS
                    .iter()
                    .enumerate()
                    .map(|(i, name)| format!("{} {name}", (i + 1) % 10))
                    .collect::<Vec<_>>(),
                s.screen,
            ),
            "tabs0",
        );
        r.styled_text(
            &format!(
                "{}  {}  {:.0}fps  {} ",
                if s.paused { "paused" } else { "live" },
                if s.real { "real" } else { "simulated" },
                s.fps,
                s.clock
            ),
            TextStyle::new()
                .fg(if s.paused { t.warning } else { t.success })
                .align(hqtui::unicode::Align::Right),
        );
    });
    ui.spacer(1);
    ui.column(
        Column::new().size(ui.height().saturating_sub(4)),
        move |body| match s.screen {
            0 => {
                crate::dashboard::render(body, s);
                return;
            }
            1 => {
                crate::telemetry::traffic(body, s);
                return;
            }
            2 => {
                crate::telemetry::sessions(body, s);
                return;
            }
            3 => {
                crate::telemetry::network(body, s);
                return;
            }
            4 => {
                crate::telemetry::services(body, s);
                return;
            }
            5 => {
                crate::components::render(body, s);
                return;
            }
            6 => {
                crate::showcase::graphics(body, s);
                return;
            }
            7 => {
                crate::showcase::themes(body, s);
                return;
            }
            8 => {
                crate::showcase::input(body, s);
                return;
            }
            9 => {
                crate::showcase::stress(body, s);
                return;
            }
            _ => {}
        },
    );
    ui.spacer(1);
    ui.status_bar(StatusBarOptions {
        items: vec![
            StatusItem::new("Help").key("F1"),
            StatusItem::new(format!("Theme ({})", ui.theme().name)).key("F2"),
            StatusItem {
                key: Some("F3".into()),
                label: if s.filtering {
                    format!("Filter: {}_", s.filter)
                } else {
                    "Filter".into()
                },
                active: s.filtering,
                ..Default::default()
            },
            StatusItem::new(format!("Sort: {}", ["cpu", "mem", "pid", "name"][s.sort])).key("F6"),
            StatusItem::new("Palette").key("^K"),
            StatusItem::new("Screen").key("Tab"),
            StatusItem::new("Quit").key("q"),
        ],
        right: vec![StatusItem::new(format!(
            "{:.2}ms  {} cells  {}B",
            s.render_ms, s.changed_cells, s.bytes
        ))],
        ..Default::default()
    });
    if s.help {
        ui.modal(ModalOptions::new().title("hqtui — Help").message("1–9/0 / Tab: screen\nF2 theme · F3 filter · F6 sort\nCtrl+K palette · Space pause\nArrows / PgUp / PgDn / Home / End: scroll\nMouse tabs, controls, selection and wheel\ne edits text · Esc finishes\nq / Ctrl+C quit · Any key closes help"));
    }
    if s.modal {
        ui.modal(
            ModalOptions::new().title("Read-only Demo").message(
                "No process will be killed and no service changed.\nPress any key to close.",
            ),
        );
    }
    if s.palette {
        ui.command_palette(CommandPaletteOptions {
            query: s.query.clone(),
            items: s.commands().into_iter().map(PaletteItem::new).collect(),
            selected: Some(s.palette_index),
            ..Default::default()
        });
    }
}
