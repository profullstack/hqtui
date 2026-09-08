//! The same COBOL bridge, calling the Rust port instead of the TypeScript one.
//!
//!   cobc -x -free ../examples/widgets.cbl -o widgets
//!   ./widgets | cargo run --example cobol-bridge --manifest-path ports/rust/Cargo.toml
//!
//! It reads byte-for-byte the same 80-column records as
//! ports/cobol/adapter/render.ts, which is the point: a record layout is not
//! an API and belongs to no language. COBOL describes the scene, and whichever
//! side of the bridge you prefer draws it.
//!
//!   columns  1-9    verb     the instruction
//!           10-29   key      a label, a level, an alignment
//!           30-73   text     content; "|" separates repeated fields
//!           74-80   num      a number as text, so no locale can eat it

use std::io::Read;

use hqtui::graphics::plot::{DonutOptions, DonutSegment, GaugeOptions, PlotOptions, Series};
use hqtui::prelude::*;
use hqtui::testing::render_to_text;
use hqtui::unicode::Align;
use hqtui::widgets::*;

#[derive(Clone, Debug)]
struct Record {
    verb: String,
    key: String,
    text: String,
    num: String,
}

struct Scene {
    id: String,
    records: Vec<Record>,
}

/// Columns are counted in characters, and the layout is pure ASCII by
/// construction: COBOL wrote it.
fn parse_record(line: &str) -> Record {
    let mut padded: String = line.to_string();
    while padded.chars().count() < 80 {
        padded.push(' ');
    }
    let chars: Vec<char> = padded.chars().collect();
    let field = |from: usize, to: usize| -> String {
        chars[from..to].iter().collect::<String>().trim().to_string()
    };
    Record { verb: field(0, 9), key: field(9, 29), text: field(29, 73), num: field(73, 80) }
}

fn parse_scenes(input: &str) -> Vec<Scene> {
    let mut scenes: Vec<Scene> = Vec::new();
    for line in input.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let record = parse_record(line);
        if record.verb == "WIDGET" {
            scenes.push(Scene { id: record.key, records: Vec::new() });
        } else if let Some(scene) = scenes.last_mut() {
            scene.records.push(record);
        }
    }
    scenes
}

fn alignment(key: &str) -> Align {
    match key {
        "CENTER" => Align::Center,
        "RIGHT" => Align::Right,
        _ => Align::Left,
    }
}

fn variant(key: &str) -> ButtonVariant {
    match key {
        "SUCCESS" => ButtonVariant::Success,
        "WARNING" => ButtonVariant::Warning,
        "DANGER" => ButtonVariant::Danger,
        "GHOST" => ButtonVariant::Ghost,
        _ => ButtonVariant::Primary,
    }
}

fn draw(scene: &Scene, ui: &mut Container) {
    let mut columns: Vec<TableColumn> = Vec::new();
    let mut rows: Vec<TableRow> = Vec::new();
    let mut keys: Vec<KeyValueRow> = Vec::new();
    let mut entries: Vec<LogEntry> = Vec::new();
    let mut points: Vec<f64> = Vec::new();
    let mut bars: Vec<f64> = Vec::new();
    let mut list_items: Vec<ListItem> = Vec::new();
    let mut tree_nodes: Vec<TreeNode> = Vec::new();
    let mut tabs: Vec<String> = Vec::new();
    let mut status: Vec<StatusItem> = Vec::new();
    let mut segments: Vec<DonutSegment> = Vec::new();
    let mut histogram_bars: Vec<f64> = Vec::new();
    let mut meter_items: Vec<MeterItem> = Vec::new();
    let mut select_options: Vec<String> = Vec::new();
    let mut palette_items: Vec<PaletteItem> = Vec::new();
    let mut modal_buttons: Vec<ModalButton> = Vec::new();
    let mut modal_lines: Vec<String> = Vec::new();
    let mut meter_columns = 1usize;
    let mut dropdown: Option<(String, bool, usize)> = None;
    let mut modal: Option<(String, usize)> = None;
    let mut palette: Option<(String, usize)> = None;
    let mut tooltip: Option<(String, isize, isize)> = None;
    let mut selected = 0usize;
    let mut active_tab = 0usize;

    for record in &scene.records {
        match record.verb.as_str() {
            "TEXT" => {
                ui.styled_text(&record.text, TextStyle::new().align(alignment(&record.key)));
            }
            "LABEL" => {
                ui.label(&record.text);
            }
            "HEADING" => {
                ui.heading(&record.text);
            }
            "DIVIDER" => {
                let options = if record.text.is_empty() {
                    DividerOptions::default()
                } else {
                    DividerOptions { label: Some(record.text.clone()), ..Default::default() }
                };
                ui.divider(options);
            }
            "KEYVALUE" => keys.push(KeyValueRow::new(&record.key, &record.text)),
            "COLUMN" => columns.push(TableColumn::new(&record.text).align(alignment(&record.key))),
            "ROW" => rows.push(TableRow::new(
                record.text.split('|').map(|c| c.to_string()).collect::<Vec<_>>(),
            )),
            "SELECT" => selected = record.num.parse().unwrap_or(0),
            "LOG" => {
                let mut parts = record.text.split('|');
                let time = parts.next().unwrap_or("");
                let message = parts.next().unwrap_or("");
                let meta = parts.next().unwrap_or("");
                let entry = LogEntry::new(message).at(time).level(&record.key);
                entries.push(if meta.is_empty() {
                    entry
                } else {
                    LogEntry { meta: Some(meta.into()), ..entry }
                });
            }
            "METER" => {
                ui.meter(MeterOptions::new(record.num.parse().unwrap_or(0.0)).label(&record.key));
            }
            "GRAPHPT" => points.push(record.num.parse().unwrap_or(0.0)),
            "GAUGE" => {
                ui.gauge(GaugeOptions {
                    value: record.num.parse().unwrap_or(0.0),
                    label: Some(record.text.clone()),
                    ..Default::default()
                });
            }
            "BADGE" => {
                ui.badge(BadgeOptions::new(&record.text));
            }
            "PROGRESS" => {
                let max: Option<f64> = record.text.parse().ok();
                ui.progress(ProgressOptions {
                    value: record.num.parse().unwrap_or(0.0),
                    max,
                    label: Some(record.key.clone()),
                    show_count: max.is_some(),
                    ..Default::default()
                });
            }
            // One sample per record, like GRAPHPT. A batch job emits these in
            // the order it computed them.
            "SPARKPT" => bars.push(record.num.parse().unwrap_or(0.0)),
            "HEATBAR" => {
                ui.heat_bar(HeatBarOptions {
                    value: record.num.parse().unwrap_or(0.0),
                    ..Default::default()
                });
            }
            "SEGMENT" => segments.push(DonutSegment {
                value: record.num.parse().unwrap_or(0.0),
                label: if record.text.is_empty() { None } else { Some(record.text.clone()) },
                color: None,
            }),
            "ITEM" => list_items.push(ListItem::from(record.text.as_str())),
            "NODE" => tree_nodes.push(TreeNode::new(&record.text)),
            "CHILD" => {
                // Belongs to the node most recently declared, which is how a
                // record stream describes a shallow hierarchy without nesting.
                let parent = tree_nodes
                    .last_mut()
                    .unwrap_or_else(|| panic!("CHILD before any NODE in scene {}", scene.id));
                let child = TreeNode::new(&record.text);
                *parent = std::mem::replace(parent, TreeNode::new("")).child(child);
            }
            "BUTTON" => {
                ui.button(ButtonOptions::new(&record.text), "cobol-button");
            }
            "CHECKBOX" => {
                ui.checkbox(
                    CheckboxOptions::new(&record.text, record.key == "ON"),
                    "cobol-checkbox",
                );
            }
            "INPUT" => {
                ui.text_input(
                    TextInputOptions {
                        label: Some(record.key.clone()),
                        ..TextInputOptions::new(&record.text)
                    },
                    "cobol-input",
                );
            }
            "TAB" => {
                if record.key == "ACTIVE" {
                    active_tab = tabs.len();
                }
                tabs.push(record.text.clone());
            }
            "STATUS" => status.push(if record.key.is_empty() {
                StatusItem::new(&record.text)
            } else {
                StatusItem::new(&record.text).key(&record.key)
            }),
            "HISTBAR" => histogram_bars.push(record.num.parse().unwrap_or(0.0)),
            "METERS" => meter_columns = record.num.parse().unwrap_or(1),
            "MITEM" => meter_items.push(MeterItem {
                label: record.key.clone(),
                value: record.num.parse().unwrap_or(0.0),
                ..Default::default()
            }),
            "DROPDOWN" => {
                dropdown =
                    Some((record.text.clone(), record.key == "OPEN", record.num.parse().unwrap_or(20)))
            }
            "OPTION" => select_options.push(record.text.clone()),
            "MODAL" => modal = Some((record.key.clone(), record.num.parse().unwrap_or(46))),
            // One line per record, so a message is not capped at the 44 columns
            // a single record can carry.
            "MTEXT" => modal_lines.push(record.text.clone()),
            "MBUTTON" => modal_buttons.push(ModalButton {
                label: record.text.clone(),
                variant: variant(&record.key),
                focused: record.num == "1",
            }),
            "PALETTE" => palette = Some((record.key.clone(), record.num.parse().unwrap_or(0))),
            "PITEM" => palette_items.push(PaletteItem {
                label: record.text.clone(),
                hint: if record.key.is_empty() { None } else { Some(record.key.clone()) },
            }),
            "TOOLTIP" => {
                // The anchor is a cell, so it travels as "column|row".
                let mut parts = record.key.split('|');
                let x = parts.next().unwrap_or("0").parse().unwrap_or(0);
                let y = parts.next().unwrap_or("0").parse().unwrap_or(0);
                tooltip = Some((record.text.clone(), x, y));
            }
            other => panic!("unknown verb {other:?} in scene {}", scene.id),
        }
    }

    if !bars.is_empty() {
        ui.sparkline(SparklineWidgetOptions { values: bars, ..Default::default() });
    }
    if !histogram_bars.is_empty() {
        let accent = ui.theme().accent;
        ui.histogram(ColumnsOptions {
            values: histogram_bars,
            color: Some(accent),
            ..Default::default()
        });
    }
    if !meter_items.is_empty() {
        ui.meters(MetersOptions {
            items: meter_items,
            columns: Some(meter_columns),
            label_width: Some(4),
            value_width: Some(5),
            ..Default::default()
        });
    }
    if let Some((value, open, width)) = dropdown {
        ui.select(
            SelectOptions {
                value,
                open,
                options: select_options,
                selected_index: Some(selected),
                width: Some(width),
                ..Default::default()
            },
            "cobol-select",
        );
    }
    if !segments.is_empty() {
        ui.donut(DonutOptions { segments, ..Default::default() });
    }
    if !list_items.is_empty() {
        ui.list(
            ListOptions {
                items: list_items,
                selected: Some(selected),
                bullet: Some("▸".into()),
                ..Default::default()
            },
            "cobol-list",
        );
    }
    if !tree_nodes.is_empty() {
        ui.tree(
            TreeOptions { nodes: tree_nodes, selected: Some(selected), ..Default::default() },
            "cobol-tree",
        );
    }
    if !tabs.is_empty() {
        ui.tabs(TabsOptions::new(tabs, active_tab), "cobol-tabs");
    }
    if !status.is_empty() {
        ui.status_bar(StatusBarOptions { items: status, ..Default::default() });
    }
    if !keys.is_empty() {
        ui.key_values(KeyValueOptions { rows: keys, ..Default::default() });
    }
    if !columns.is_empty() {
        ui.table(
            TableOptions {
                rows,
                columns,
                selected: Some(selected),
                zebra: true,
                ..Default::default()
            },
            "cobol-table",
        );
    }
    if !entries.is_empty() {
        ui.log(LogOptions { entries, scrollbar: true, ..Default::default() }, "cobol-log");
    }
    if !points.is_empty() {
        ui.graph(GraphOptions {
            plot: PlotOptions { min: Some(0.0), max: Some(100.0), ..Default::default() },
            ..GraphOptions::series(vec![Series::new(points).filled()])
        });
    }
    // Overlays last, because they draw over whatever the scene already put down.
    if let Some((title, width)) = modal {
        ui.modal(ModalOptions {
            title: Some(title),
            message: Some(modal_lines.join("\n")),
            width: Some(width),
            buttons: modal_buttons,
            ..Default::default()
        });
    }
    if let Some((query, index)) = palette {
        ui.command_palette(CommandPaletteOptions {
            query,
            items: palette_items,
            selected: Some(index),
            ..Default::default()
        });
    }
    if let Some((text, x, y)) = tooltip {
        ui.tooltip(TooltipOptions { text, x, y, ..Default::default() });
    }
}

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).expect("read stdin");
    let scenes = parse_scenes(&input);

    if scenes.is_empty() {
        eprintln!("no records on stdin: pipe the COBOL program into this");
        std::process::exit(1);
    }

    let mut blank = 0;
    for scene in &scenes {
        let out = render_to_text(62, 12, "dark", |ui| draw(scene, ui));
        if out.trim().is_empty() {
            eprintln!("FAIL {}: rendered an empty screen", scene.id);
            blank += 1;
            continue;
        }
        println!("--- {}\n{}", scene.id, out.trim_end());
    }

    eprintln!("{}/{} widget examples rendered", scenes.len() - blank, scenes.len());
    if blank > 0 {
        std::process::exit(1);
    }
}
