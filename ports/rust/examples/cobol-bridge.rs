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

use hqtui::graphics::plot::{GaugeOptions, PlotOptions, Series};
use hqtui::prelude::*;
use hqtui::testing::render_to_text;
use hqtui::unicode::Align;

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

fn draw(scene: &Scene, ui: &mut Container) {
    let mut columns: Vec<TableColumn> = Vec::new();
    let mut rows: Vec<TableRow> = Vec::new();
    let mut keys: Vec<KeyValueRow> = Vec::new();
    let mut entries: Vec<LogEntry> = Vec::new();
    let mut points: Vec<f64> = Vec::new();
    let mut selected = 0usize;

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
            other => panic!("unknown verb {other:?} in scene {}", scene.id),
        }
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
