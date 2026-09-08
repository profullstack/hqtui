//! Every widget HQTUI ships, one function each, in Rust.
//!
//! `cargo run --example widgets` renders all of them headlessly and prints the
//! result, so the file is a program rather than a snippet dump. The
//! `@widget` / `@end` markers are what hqtui.com/widgets slices to show the
//! code for one widget, which is why a snippet on the site is always a region
//! of something that compiles.
//!
//! Keep each function self-contained: it takes a container and nothing else.

use hqtui::graphics::chart::{AxisOptions, ChartPlotOptions, ChartSeries};
use hqtui::graphics::plot::{BarStyle, DonutOptions, DonutSegment, GaugeOptions, PlotOptions, Series};
use hqtui::prelude::*;
use hqtui::testing::render_to_text;
use hqtui::unicode::Align;

fn cpu_history() -> Vec<f64> {
    vec![
        12., 18., 26., 22., 31., 44., 38., 52., 61., 48., 39., 44., 57., 66., 72., 64., 51., 43.,
        37., 41.,
    ]
}

fn net_history() -> Vec<f64> {
    vec![4., 9., 6., 14., 22., 18., 31., 27., 19., 12., 8., 15., 24., 33., 29., 21.]
}

// ------------------------------------------------------------------- text

// @widget text
pub fn text(ui: &mut Container) {
    ui.text("Plain text. It fills the width it is given.");
    ui.styled_text("Bold, in the theme's primary color.", TextStyle::new().bold());
    ui.styled_text("Right aligned.", TextStyle::new().align(Align::Right));
    ui.styled_text(
        "Long copy wraps when you ask it to, instead of being cut at the edge.",
        TextStyle::new().wrapped(),
    );
}
// @end

// @widget label
pub fn label(ui: &mut Container) {
    // `label` is `text` in the theme's muted color: secondary copy, captions,
    // the line under a number that says what the number is.
    ui.label("cpu · 8 cores · 3.4 GHz");
    ui.styled_text("42.1%", TextStyle::new().bold());
    ui.label("15 minute average");
}
// @end

// @widget heading
pub fn heading(ui: &mut Container) {
    // `heading` is `text` in the theme's title color, bold.
    ui.heading("Storage");
    ui.label("Four volumes, one degraded");
    ui.spacer(1);
    ui.heading("Network");
}
// @end

// @widget badge
pub fn badge(ui: &mut Container) {
    ui.row(Row::new().size(1).gap(1), |r| {
        r.badge(BadgeOptions::new("active"));
        r.badge(BadgeOptions::new("idle").variant(BadgeVariant::Subtle));
        r.badge(BadgeOptions::new("failed").variant(BadgeVariant::Outline));
        r.spacer("fill");
    });
}
// @end

// @widget divider
pub fn divider(ui: &mut Container) {
    ui.text("Above the line");
    ui.divider(DividerOptions::default());
    ui.text("Below it");
    ui.divider(DividerOptions {
        label: Some("status".into()),
        align: Some(Align::Center),
        ..Default::default()
    });
    ui.text("A labelled divider titles a section without spending a panel on it");
}
// @end

// @widget keyValues
pub fn key_values(ui: &mut Container) {
    // The backbone of every "System" panel: labels left, values right.
    ui.key_values(KeyValueOptions {
        rows: vec![
            KeyValueRow::new("Host", "web-01.iad"),
            KeyValueRow::new("Uptime", "18d 04:12"),
            KeyValueRow::new("Load", "0.42  0.51  0.60"),
            KeyValueRow::new("Established", "1,284"),
        ],
        ..Default::default()
    });
}
// @end

// @widget statusBar
pub fn status_bar(ui: &mut Container) {
    // Usually the last thing drawn, pinned to the bottom row.
    ui.status_bar(StatusBarOptions {
        items: vec![
            StatusItem::new("Help").key("F1"),
            StatusItem::new("Theme").key("F2"),
            StatusItem::new("Filter").key("F3").active(),
            StatusItem::new("Palette").key("^K"),
            StatusItem::new("Quit").key("q"),
        ],
        right: vec![StatusItem::new("0.41ms  184 cells")],
        ..Default::default()
    });
}
// @end

// ------------------------------------------------------------------- data

// @widget table
pub fn table(ui: &mut Container) {
    ui.table(
        TableOptions {
            rows: vec![
                TableRow::new(["src", "4.2 KB", "dir", "2m ago"]),
                TableRow::new(["test", "1.1 KB", "dir", "5m ago"]),
                TableRow::new(["package.json", "1.2 KB", "file", "10m ago"]),
                TableRow::new(["README.md", "3.4 KB", "file", "1h ago"]),
            ],
            columns: vec![
                TableColumn::new("Name"),
                TableColumn::new("Size").width(9).align(Align::Right),
                TableColumn::new("Type").width(6),
                TableColumn::new("Modified").width(10).align(Align::Right),
            ],
            selected: Some(1),
            zebra: true,
            ..Default::default()
        },
        "files",
    );
}
// @end

// @widget list
pub fn list(ui: &mut Container) {
    ui.list(
        ListOptions {
            items: ["apps/demo", "packages/hqtui", "apps/web", "docs"]
                .map(ListItem::from)
                .to_vec(),
            selected: Some(0),
            bullet: Some("▸".into()),
            scrollbar: true,
            ..Default::default()
        },
        "paths",
    );
}
// @end

// @widget tree
pub fn tree(ui: &mut Container) {
    ui.tree(
        TreeOptions {
            nodes: vec![TreeNode::new("systemd")
                .child(TreeNode::new("bash"))
                .child(TreeNode::new("bun").child(TreeNode::new("bun:worker")))
                .child(TreeNode::new("postgres"))],
            selected: Some(2),
            ..Default::default()
        },
        "procs",
    );
}
// @end

// @widget log
pub fn log(ui: &mut Container) {
    ui.log(
        LogOptions {
            entries: vec![
                LogEntry::new("listening on :8080").at("12:45:02").level("INFO"),
                LogEntry {
                    meta: Some("table=users".into()),
                    ..LogEntry::new("slow query 412ms").at("12:45:09").level("WARN")
                },
                LogEntry::new("upstream timeout").at("12:45:11").level("ERROR"),
                LogEntry::new("retry succeeded").at("12:45:14").level("INFO"),
            ],
            scrollbar: true,
            ..Default::default()
        },
        "logs",
    );
}
// @end

// ----------------------------------------------------------------- meters

// @widget meter
pub fn meter(ui: &mut Container) {
    ui.meter(MeterOptions::new(0.62).label("CPU"));
    ui.meter(MeterOptions::new(0.31).label("MEM").style(BarStyle::Segmented));
    ui.meter(MeterOptions::new(0.87).label("SWP"));
}
// @end

// @widget meters
pub fn meters(ui: &mut Container) {
    // One call for a whole bank. `columns` lays them out side by side.
    ui.meters(MetersOptions {
        items: vec![
            MeterItem::new("P0", 0.12),
            MeterItem::new("P1", 0.44),
            MeterItem::new("P2", 0.71),
            MeterItem::new("P3", 0.09),
            MeterItem::new("P4", 0.38),
            MeterItem::new("P5", 0.55),
            MeterItem::new("P6", 0.22),
            MeterItem::new("P7", 0.66),
        ],
        columns: Some(2),
        style: Some(BarStyle::Segmented),
        ..Default::default()
    });
}
// @end

// @widget progress
pub fn progress(ui: &mut Container) {
    ui.progress(ProgressOptions {
        value: 37.0,
        max: Some(120.0),
        label: Some("Indexing".into()),
        show_count: true,
        ..Default::default()
    });
    ui.progress(ProgressOptions {
        value: 0.82,
        label: Some("Upload".into()),
        ..Default::default()
    });
}
// @end

// @widget graph
pub fn graph(ui: &mut Container) {
    // Braille line chart. `filled` shades the area under the curve.
    ui.graph(GraphOptions {
        plot: PlotOptions { min: Some(0.0), max: Some(100.0), ..Default::default() },
        ..GraphOptions::series(vec![Series::new(cpu_history()).label("cpu").filled()])
    });
}
// @end

// @widget sparkline
pub fn sparkline(ui: &mut Container) {
    ui.sparkline(SparklineWidgetOptions {
        values: cpu_history(),
        label: Some("CPU ".into()),
        text: Some("44%".into()),
        ..Default::default()
    });
    ui.sparkline(SparklineWidgetOptions {
        values: net_history(),
        label: Some("Net ".into()),
        text: Some("2.4 MB/s".into()),
        ..Default::default()
    });
}
// @end

// @widget histogram
pub fn histogram(ui: &mut Container) {
    // Block columns. Cheaper than Braille and easier to read when short.
    ui.histogram(ColumnsOptions { values: cpu_history(), ..Default::default() });
}
// @end

// @widget heatBar
pub fn heat_bar(ui: &mut Container) {
    // Segmented bar colored along the theme's heat ramp, like btop's temperatures.
    ui.heat_bar(HeatBarOptions { value: 0.28, ..Default::default() });
    ui.heat_bar(HeatBarOptions { value: 0.64, ..Default::default() });
    ui.heat_bar(HeatBarOptions { value: 0.91, ..Default::default() });
}
// @end

// @widget gauge
pub fn gauge(ui: &mut Container) {
    // A semicircular dial. Wants at least nine columns by five rows.
    ui.gauge(GaugeOptions { value: 62.0, label: Some("62%".into()), ..Default::default() });
}
// @end

// @widget donut
pub fn donut(ui: &mut Container) {
    ui.donut(DonutOptions {
        segments: vec![
            DonutSegment { value: 4.65, label: Some("Used".into()), color: None },
            DonutSegment { value: 10.96, label: Some("Free".into()), color: None },
        ],
        ..Default::default()
    });
}
// @end

// ----------------------------------------------------------------- inputs

// @widget button
pub fn button(ui: &mut Container) {
    // The id is how you ask whether it was pressed: `app.pressed("run")`.
    ui.row(Row::new().size(1).gap(1), |r| {
        r.button(ButtonOptions::new("Primary"), "primary");
        r.button(ButtonOptions::new("Success").variant(ButtonVariant::Success), "ok");
        r.button(ButtonOptions::new("Danger").variant(ButtonVariant::Danger), "stop");
        r.spacer("fill");
    });
}
// @end

// @widget checkbox
pub fn checkbox(ui: &mut Container) {
    ui.row(Row::new().size(1).gap(2), |r| {
        r.checkbox(
            CheckboxOptions::new("Toggle", true).variant(CheckboxVariant::Toggle),
            "toggle",
        );
        r.checkbox(CheckboxOptions::new("Checkbox", false), "checkbox");
        r.spacer("fill");
    });
}
// @end

// @widget select
pub fn select(ui: &mut Container) {
    ui.select(
        SelectOptions {
            open: true,
            options: vec!["Dark".into(), "Dracula".into(), "Nord".into(), "Tokyo Night".into()],
            selected_index: Some(1),
            ..SelectOptions::new("Dracula")
        },
        "theme",
    );
}
// @end

// @widget textInput
pub fn text_input(ui: &mut Container) {
    ui.text_input(
        TextInputOptions { label: Some("Search".into()), ..TextInputOptions::new("postgres") },
        "search",
    );
    ui.spacer(1);
    ui.text_input(
        TextInputOptions {
            label: Some("Filter".into()),
            placeholder: Some("type to filter…".into()),
            ..TextInputOptions::new("")
        },
        "filter",
    );
}
// @end

// @widget tabs
pub fn tabs(ui: &mut Container) {
    ui.tabs(
        TabsOptions::new(["1 dashboard", "2 traffic", "3 sessions", "4 network"], 1),
        "screens",
    );
}
// @end

// ---------------------------------------------------------------- overlays

// @widget modal
pub fn modal(ui: &mut Container) {
    // Overlays draw over everything already on the screen, centered.
    ui.modal(ModalOptions {
        buttons: vec![
            ModalButton::new("Yes").focused(),
            ModalButton::new("No"),
        ],
        ..ModalOptions::new()
            .title("Confirm Action")
            .message("Terminate process 4821 (postgres)?\n\nThis cannot be undone.")
    });
}
// @end

// @widget commandPalette
pub fn command_palette(ui: &mut Container) {
    ui.command_palette(CommandPaletteOptions {
        query: "the".into(),
        items: vec![
            PaletteItem::new("Toggle theme").hint("F2"),
            PaletteItem::new("Filter processes").hint("F3"),
            PaletteItem::new("Sort by memory").hint("F6"),
        ],
        selected: Some(0),
        ..Default::default()
    });
}
// @end

// @widget tooltip
pub fn tooltip(ui: &mut Container) {
    ui.text("Tooltips are overlays positioned at a cell, for hover and hints.");
    ui.tooltip(TooltipOptions { text: "swap is 87% full".into(), x: 6, y: 3, ..Default::default() });
}
// @end

// @widget scrollbar
pub fn scrollbar(ui: &mut Container) {
    // The bar is over state you own, so it works beside anything that scrolls:
    // wrapped prose, a canvas, a `draw` of your own.
    ui.row(Row::new().gap(1), |r| {
        r.styled_text(
            "A scrollbar you drive yourself. It has no idea what is beside it, only how much there is, how much fits, and where you are.",
            TextStyle::new().wrapped(),
        );
        r.scrollbar(
            ScrollbarOptions { total: 40, viewport: 5, offset: 12, ..Default::default() },
            "",
        );
    });
}
// @end

// @widget chart
pub fn chart(ui: &mut Container) {
    // Points carry their own x, so a sparse series and a dense one line up.
    ui.chart(ChartOptions {
        series: vec![
            ChartSeries::new(vec![(0.0, 1.0), (2.0, 6.0), (5.0, 3.0), (8.0, 9.0), (10.0, 4.0)])
                .label("load"),
            ChartSeries::new(vec![(0.0, 8.0), (10.0, 2.0)]).label("limit"),
        ],
        axis: true,
        legend: true,
        plot: ChartPlotOptions {
            x: Some(AxisOptions { min: Some(0.0), max: Some(10.0), ticks: Some(3), format: None }),
            y: Some(AxisOptions { min: Some(0.0), max: Some(10.0), ticks: None, format: None }),
            ..Default::default()
        },
        ..Default::default()
    });
}
// @end

/// Renders each widget on its own small screen and prints the lot.
fn main() {
    let examples: Vec<(&str, fn(&mut Container))> = vec![
        ("text", text),
        ("label", label),
        ("heading", heading),
        ("badge", badge),
        ("divider", divider),
        ("keyValues", key_values),
        ("statusBar", status_bar),
        ("table", table),
        ("list", list),
        ("tree", tree),
        ("log", log),
        ("scrollbar", scrollbar),
        ("chart", chart),
        ("meter", meter),
        ("meters", meters),
        ("progress", progress),
        ("graph", graph),
        ("sparkline", sparkline),
        ("histogram", histogram),
        ("heatBar", heat_bar),
        ("gauge", gauge),
        ("donut", donut),
        ("button", button),
        ("checkbox", checkbox),
        ("select", select),
        ("textInput", text_input),
        ("tabs", tabs),
        ("modal", modal),
        ("commandPalette", command_palette),
        ("tooltip", tooltip),
    ];

    let mut blank = 0;
    for (name, draw) in &examples {
        let out = render_to_text(62, 12, "dark", |ui| draw(ui));
        if out.trim().is_empty() {
            eprintln!("FAIL {name}: rendered an empty screen");
            blank += 1;
            continue;
        }
        println!("--- {name}\n{}", out.trim_end());
    }

    eprintln!("{}/{} widget examples rendered", examples.len() - blank, examples.len());
    if blank > 0 {
        std::process::exit(1);
    }
}
