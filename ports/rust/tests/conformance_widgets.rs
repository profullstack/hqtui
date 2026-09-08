//! Every widget, drawn with the same arguments the fixture generator used, and
//! compared cell for cell against what the TypeScript reference produced.
//!
//! The scenes are matched by name rather than driven by data: the arguments are
//! typed structs here and object literals there, and spelling them out in both
//! is what makes a drifted default visible instead of silently shared.

mod common;

use common::{assert_buffer, fixture, scene};

use hqtui::graphics::plot::{
    bar, donut, gauge, plot, sparkline, BarOptions, BarStyle, DonutOptions, DonutSegment,
    GaugeOptions, PlotOptions, Series,
};
use hqtui::graphics::chart::{AxisOptions, ChartPlotOptions, ChartSeries, MarkType};
use hqtui::graphics::{draw_canvas, Bounds, CanvasOptions, Shape};
use hqtui::graphics::FillMode;
use hqtui::color::Color;
use hqtui::layout::Rect;
use hqtui::surface::Surface;
use hqtui::unicode::Align;
use hqtui::widgets::*;

/// The paragraph every scroll fixture pins.
const PROSE: &str = "one two three four five six seven eight nine ten eleven twelve";

const SERIES: [f64; 20] =
    [3., 7., 2., 9., 4., 8., 6., 1., 5., 9., 3., 7., 8., 2., 6., 4., 9., 1., 5., 7.];

fn series() -> Vec<f64> {
    SERIES.to_vec()
}

/// The axis bounds every chart fixture pins, without the ceremony.
fn axis(min: f64, max: f64, ticks: Option<usize>) -> AxisOptions {
    AxisOptions { min: Some(min), max: Some(max), ticks, format: None }
}

/// One series over the standard 0..10 domain.
fn chart(points: &[(f64, f64)], mark: MarkType) -> ChartOptions {
    ChartOptions {
        series: vec![ChartSeries::new(points.to_vec()).mark(mark)],
        plot: ChartPlotOptions {
            x: Some(axis(0.0, 10.0, None)),
            y: Some(axis(0.0, 10.0, None)),
            ..Default::default()
        },
        ..Default::default()
    }
}

fn draw_scene(name: &str, s: &Surface) {
    match name {
        "text-plain" => draw_text(s, "hello terminal", &TextStyle::new()),
        "text-wrapped" => draw_text(s, "the quick brown fox jumps", &TextStyle::new().wrapped()),
        "text-aligned" => {
            draw_text(&s.sub(0, 0, 20, 1), "left", &TextStyle::new().align(Align::Left));
            draw_text(&s.sub(0, 1, 20, 1), "center", &TextStyle::new().align(Align::Center));
            draw_text(&s.sub(0, 2, 20, 1), "right", &TextStyle::new().align(Align::Right));
        }
        "text-scrolled" => draw_text(s, PROSE, &TextStyle { wrap: true, scroll: 2, ..Default::default() }),
        "text-scrolled-past" => draw_text(s, PROSE, &TextStyle { wrap: true, scroll: 99, ..Default::default() }),
        "text-scrolled-x" => draw_text(s, "abcdefghijklmnopqrstuvwxyz", &TextStyle { scroll_x: 6, ..Default::default() }),
        "text-scrolled-wide" => draw_text(s, "日本語です", &TextStyle { scroll_x: 3, ..Default::default() }),
        "clear" => {
            draw_text(s, "xxxxxxxxxxxxxxxx\nxxxxxxxxxxxxxxxx\nxxxxxxxxxxxxxxxx", &TextStyle::default());
            draw_clear(&s.sub(4, 1, 8, 1), &ClearOptions::default());
        }
        "fill" => draw_fill(s, &FillOptions { symbol: "\u{b7}".into(), ..Default::default() }),
        "fill-wide" => draw_fill(s, &FillOptions { symbol: "\u{65e5}".into(), ..Default::default() }),
        "calendar" => draw_calendar(s, &CalendarOptions::new(2026, 9)),
        "calendar-sunday" => draw_calendar(
            s,
            &CalendarOptions { week_start: 0, ..CalendarOptions::new(2026, 9) },
        ),
        "calendar-leap" => draw_calendar(s, &CalendarOptions::new(2024, 2)),
        "calendar-bare" => draw_calendar(
            s,
            &CalendarOptions { header: false, weekdays: false, ..CalendarOptions::new(2026, 9) },
        ),
        "calendar-marked" => draw_calendar(
            s,
            &CalendarOptions {
                selected: Some(8),
                marks: vec![
                    CalendarMark { day: 15, ..Default::default() },
                    CalendarMark { day: 22, bold: true, ..Default::default() },
                ],
                ..CalendarOptions::new(2026, 9)
            },
        ),
        "canvas-line" => draw_canvas(
            s,
            &CanvasOptions {
                shapes: vec![Shape::Line { x1: 0.0, y1: 0.0, x2: 10.0, y2: 10.0, color: None }],
                x: Some(Bounds::new(0.0, 10.0)),
                y: Some(Bounds::new(0.0, 10.0)),
                ..Default::default()
            },
        ),
        "canvas-shapes" => draw_canvas(
            s,
            &CanvasOptions {
                shapes: vec![
                    Shape::Rect {
                        x: 1.0, y: 1.0, width: 4.0, height: 4.0, fill: false, color: None,
                    },
                    Shape::Circle { x: 7.0, y: 5.0, radius: 2.0, color: None },
                    Shape::Polyline {
                        points: vec![(0.0, 8.0), (3.0, 9.0), (6.0, 7.0), (9.0, 9.0)],
                        color: None,
                    },
                    Shape::Points { points: vec![(1.0, 9.0), (9.0, 1.0)], color: None },
                ],
                x: Some(Bounds::new(0.0, 10.0)),
                y: Some(Bounds::new(0.0, 10.0)),
                ..Default::default()
            },
        ),
        "canvas-filled" => draw_canvas(
            s,
            &CanvasOptions {
                shapes: vec![Shape::Rect {
                    x: 2.0, y: 2.0, width: 6.0, height: 6.0, fill: true, color: None,
                }],
                x: Some(Bounds::new(0.0, 10.0)),
                y: Some(Bounds::new(0.0, 10.0)),
                ..Default::default()
            },
        ),
        "canvas-bounds" => draw_canvas(
            s,
            &CanvasOptions {
                shapes: vec![Shape::Line { x1: 0.0, y1: 0.0, x2: 10.0, y2: 10.0, color: None }],
                x: Some(Bounds::new(0.0, 40.0)),
                y: Some(Bounds::new(0.0, 40.0)),
                ..Default::default()
            },
        ),
        "canvas-grid" => draw_canvas(
            s,
            &CanvasOptions {
                shapes: vec![Shape::Points { points: vec![(5.0, 5.0)], color: None }],
                x: Some(Bounds::new(0.0, 10.0)),
                y: Some(Bounds::new(0.0, 10.0)),
                grid: true,
                ..Default::default()
            },
        ),
        "shadow" => {
            draw_fill(s, &FillOptions { symbol: "x".into(), ..Default::default() });
            draw_shadow(s, Rect { x: 2, y: 1, width: 6, height: 2 }, &ShadowOptions::default());
        }
        "shadow-offset" => {
            draw_fill(s, &FillOptions { symbol: "x".into(), ..Default::default() });
            draw_shadow(
                s,
                Rect { x: 2, y: 1, width: 6, height: 2 },
                &ShadowOptions { offset_x: 2, offset_y: 1, ..Default::default() },
            );
        }
        "shadow-back" => {
            draw_fill(s, &FillOptions { symbol: "x".into(), ..Default::default() });
            draw_shadow(
                s,
                Rect { x: 5, y: 2, width: 6, height: 2 },
                &ShadowOptions { offset_x: -1, offset_y: -1, ..Default::default() },
            );
        }
        "shadow-solid" => {
            draw_fill(s, &FillOptions { symbol: "x".into(), ..Default::default() });
            draw_shadow(
                s,
                Rect { x: 2, y: 1, width: 6, height: 2 },
                &ShadowOptions { color: Some(Color::rgb(0x10, 0x14, 0x18)), ..Default::default() },
            );
        }
        "badge" => {
            draw_badge(s, &BadgeOptions::new("LIVE"));
        }
        "badge-outline" => {
            draw_badge(s, &BadgeOptions::new("IDLE").variant(BadgeVariant::Outline));
        }
        "badge-subtle" => {
            draw_badge(s, &BadgeOptions::new("WARN").variant(BadgeVariant::Subtle));
        }
        "keyvalues" => draw_key_values(
            s,
            &KeyValueOptions {
                rows: vec![
                    KeyValueRow::new("Host", "seed1"),
                    KeyValueRow::new("Uptime", "12d 4h"),
                    KeyValueRow::new("Load", "0.42"),
                ],
                ..Default::default()
            },
        ),
        "divider" => draw_divider(
            s,
            &DividerOptions { label: Some("Section".into()), ..Default::default() },
        ),
        "meter" => draw_meter(s, &MeterOptions::new(0.72).label("CPU")),
        "meter-segmented" => {
            draw_meter(s, &MeterOptions::new(0.33).label("MEM").style(BarStyle::Segmented))
        }
        "meter-ascii" => {
            draw_meter(s, &MeterOptions::new(0.9).label("IO").style(BarStyle::Ascii))
        }
        "meter-nan" => draw_meter(s, &MeterOptions::new(f64::NAN).label("BAD")),
        "meters-grid" => draw_meters(
            s,
            &MetersOptions {
                items: vec![
                    MeterItem::new("c0", 0.2),
                    MeterItem::new("c1", 0.5),
                    MeterItem::new("c2", 0.8),
                    MeterItem::new("c3", 1.0),
                    MeterItem::new("c4", 0.0),
                    MeterItem::new("c5", 0.65),
                ],
                columns: Some(2),
                ..Default::default()
            },
        ),
        "progress" => draw_progress(
            s,
            &ProgressOptions {
                value: 37.0,
                max: Some(120.0),
                label: Some("Sync".into()),
                show_count: true,
                ..Default::default()
            },
        ),
        "heat-bar" => draw_heat_bar(s, &HeatBarOptions { value: 0.6, ..Default::default() }),
        "columns" => {
            draw_columns(s, &ColumnsOptions { values: series(), ..Default::default() })
        }
        "bar-smooth" => bar(s, &BarOptions { value: 0.63, ..Default::default() }),
        "bar-segmented" => bar(
            s,
            &BarOptions { value: 0.63, style: Some(BarStyle::Segmented), ..Default::default() },
        ),
        "bar-ascii" => bar(
            s,
            &BarOptions { value: 0.63, style: Some(BarStyle::Ascii), ..Default::default() },
        ),
        "sparkline" => sparkline(s, &series(), &Default::default()),
        "plot-braille" => plot(s, &[Series::new(series())], &PlotOptions::default()),
        "plot-block" => plot(
            s,
            &[Series::new(series())],
            &PlotOptions { mode: Some(FillMode::Block), ..Default::default() },
        ),
        "plot-ascii" => plot(
            s,
            &[Series::new(series())],
            &PlotOptions { mode: Some(FillMode::Ascii), ..Default::default() },
        ),
        "plot-fill" => plot(s, &[Series::new(series()).filled()], &PlotOptions::default()),
        "plot-grid" => plot(
            s,
            &[Series::new(series())],
            &PlotOptions { grid: true, ..Default::default() },
        ),
        "plot-multi" => plot(
            s,
            &[
                Series::new(series()),
                Series::new(series().iter().map(|v| 10.0 - v).collect::<Vec<_>>()),
            ],
            &PlotOptions::default(),
        ),
        "gauge" => gauge(
            s,
            &GaugeOptions { value: 0.7, label: Some("70%".into()), ..Default::default() },
        ),
        "donut" => donut(
            s,
            &DonutOptions {
                segments: vec![
                    DonutSegment { value: 3.0, ..Default::default() },
                    DonutSegment { value: 5.0, ..Default::default() },
                    DonutSegment { value: 2.0, ..Default::default() },
                ],
                background: None,
            },
        ),
        "chart-line" => draw_chart(s, &chart(&[(0.0, 1.0), (2.0, 6.0), (5.0, 3.0), (8.0, 9.0), (10.0, 4.0)], MarkType::Line)),
        "chart-scatter" => draw_chart(s, &chart(&[(0.0, 1.0), (2.0, 6.0), (5.0, 3.0), (8.0, 9.0), (10.0, 4.0)], MarkType::Scatter)),
        "chart-bar" => draw_chart(s, &chart(&[(0.0, 1.0), (2.0, 6.0), (5.0, 3.0), (8.0, 9.0), (10.0, 4.0)], MarkType::Bar)),
        "chart-fill" => draw_chart(
            s,
            &ChartOptions {
                series: vec![ChartSeries::new(vec![(0.0, 2.0), (5.0, 8.0), (10.0, 2.0)]).filled()],
                plot: ChartPlotOptions {
                    x: Some(axis(0.0, 10.0, None)),
                    y: Some(axis(0.0, 10.0, None)),
                    ..Default::default()
                },
                ..Default::default()
            },
        ),
        "chart-axes" => draw_chart(
            s,
            &ChartOptions {
                series: vec![ChartSeries::new(vec![(0.0, 0.0), (5.0, 50.0), (10.0, 100.0)])],
                axis: true,
                plot: ChartPlotOptions {
                    x: Some(axis(0.0, 10.0, Some(3))),
                    y: Some(axis(0.0, 100.0, None)),
                    ..Default::default()
                },
                ..Default::default()
            },
        ),
        "chart-block" => draw_chart(
            s,
            &ChartOptions {
                series: vec![ChartSeries::new(vec![
                    (0.0, 1.0), (2.0, 6.0), (5.0, 3.0), (8.0, 9.0), (10.0, 4.0),
                ])
                .mark(MarkType::Bar)],
                plot: ChartPlotOptions {
                    mode: Some(FillMode::Block),
                    x: Some(axis(0.0, 10.0, None)),
                    y: Some(axis(0.0, 10.0, None)),
                    ..Default::default()
                },
                ..Default::default()
            },
        ),
        "chart-multi" => draw_chart(
            s,
            &ChartOptions {
                series: vec![
                    ChartSeries::new(vec![
                        (0.0, 1.0), (1.0, 3.0), (2.0, 2.0), (3.0, 5.0),
                        (4.0, 4.0), (5.0, 7.0), (6.0, 6.0), (7.0, 9.0),
                    ])
                    .label("fine"),
                    ChartSeries::new(vec![(0.0, 8.0), (7.0, 2.0)]).label("coarse"),
                ],
                axis: true,
                legend: true,
                plot: ChartPlotOptions {
                    x: Some(axis(0.0, 7.0, None)),
                    y: Some(axis(0.0, 10.0, None)),
                    ..Default::default()
                },
                ..Default::default()
            },
        ),
        "chart-flat" => draw_chart(
            s,
            &ChartOptions {
                series: vec![ChartSeries::new(vec![(0.0, 4.0), (5.0, 4.0), (10.0, 4.0)])],
                plot: ChartPlotOptions { x: Some(axis(0.0, 10.0, None)), ..Default::default() },
                ..Default::default()
            },
        ),
        "graph-axis" => draw_graph(s, &GraphOptions::new(series()).with_axis()),
        "graph-legend" => draw_graph(
            s,
            &GraphOptions::series(vec![
                Series::new(series()).label("rx"),
                Series::new(series().iter().map(|v| v / 2.0).collect::<Vec<_>>()).label("tx"),
            ])
            .with_legend(),
        ),
        "graph-timeaxis" => draw_graph(
            s,
            &GraphOptions {
                time_axis: Some(vec!["60s".into(), "30s".into(), "0s".into()]),
                ..GraphOptions::new(series())
            },
        ),
        // Both axes together. Each was covered alone, which is how the y-axis
        // minimum came to be drawn onto the time-axis row without any fixture
        // noticing.
        "graph-axis-timeaxis" => {
            let mut options = GraphOptions::new(series()).with_axis();
            options.plot.min = Some(0.0);
            options.plot.max = Some(100.0);
            options.time_axis = Some(vec!["60s".into(), "30s".into(), "0s".into()]);
            draw_graph(s, &options)
        }
        "sparkline-widget" => draw_sparkline(
            s,
            &SparklineWidgetOptions {
                values: series(),
                label: Some("net".into()),
                text: Some("1.2M".into()),
                ..Default::default()
            },
        ),
        "table" => draw_table(
            s,
            &TableOptions {
                rows: vec![
                    TableRow::new(["1", "systemd", "0.1"]),
                    TableRow::new(["420", "node", "12.5"]),
                    TableRow::new(["900", "hqtui-demo", "3.2"]),
                ],
                columns: vec![
                    TableColumn::new("PID").align(Align::Right),
                    TableColumn::new("NAME"),
                    TableColumn::new("CPU%").align(Align::Right),
                ],
                selected: Some(1),
                zebra: true,
                ..Default::default()
            },
        ),
        "table-scrollbar" => draw_table(
            s,
            &TableOptions {
                rows: (0..20)
                    .map(|i| TableRow::new([i.to_string(), format!("row {i}")]))
                    .collect(),
                columns: vec![TableColumn::new("#").align(Align::Right), TableColumn::new("VALUE")],
                selected: Some(12),
                follow_selection: true,
                scrollbar: true,
                ..Default::default()
            },
        ),
        "list" => draw_list(
            s,
            &ListOptions {
                items: ["alpha", "beta", "gamma", "delta"].map(ListItem::from).to_vec(),
                selected: Some(2),
                bullet: Some("•".into()),
                ..Default::default()
            },
        ),
        "tree" => draw_tree(
            s,
            &TreeOptions {
                nodes: vec![
                    TreeNode::new("root")
                        .child(TreeNode::new("child-a").child(TreeNode::new("leaf")))
                        .child(TreeNode::new("child-b")),
                    TreeNode::new("second"),
                ],
                selected: Some(1),
                ..Default::default()
            },
        ),
        "log" => draw_log(
            s,
            &LogOptions {
                entries: vec![
                    LogEntry::new("started").at("10:00:00").level("INFO"),
                    LogEntry {
                        meta: Some("412ms".into()),
                        ..LogEntry::new("slow query").at("10:00:01").level("WARN")
                    },
                    LogEntry::new("connection reset").at("10:00:02").level("ERROR"),
                ],
                ..Default::default()
            },
        ),
        "scrollbar" => draw_scrollbar(s, 1, 0, 8, 40, 12),
        "scrollbar-right" => draw_scrollbar_widget(
            s,
            &ScrollbarOptions { total: 40, viewport: 8, offset: 12, ..Default::default() },
        ),
        "scrollbar-left" => draw_scrollbar_widget(
            s,
            &ScrollbarOptions {
                total: 40,
                viewport: 8,
                offset: 12,
                orientation: ScrollbarOrientation::Left,
            },
        ),
        "scrollbar-bottom" => draw_scrollbar_widget(
            s,
            &ScrollbarOptions {
                total: 80,
                viewport: 20,
                offset: 30,
                orientation: ScrollbarOrientation::Bottom,
            },
        ),
        "scrollbar-top" => draw_scrollbar_widget(
            s,
            &ScrollbarOptions {
                total: 80,
                viewport: 20,
                offset: 30,
                orientation: ScrollbarOrientation::Top,
            },
        ),
        "scrollbar-fits" => draw_scrollbar_widget(
            s,
            &ScrollbarOptions { total: 5, viewport: 8, offset: 0, ..Default::default() },
        ),
        "scrollbar-viewport" => draw_scrollbar_widget(
            s,
            &ScrollbarOptions { total: 120, viewport: 8, offset: 36, ..Default::default() },
        ),
        "scrollbar-viewport-wide" => draw_scrollbar_widget(
            s,
            &ScrollbarOptions {
                total: 120,
                viewport: 8,
                offset: 36,
                orientation: ScrollbarOrientation::Bottom,
            },
        ),
        "button" => {
            draw_button(s, &ButtonOptions::new("OK"));
        }
        "button-focused" => {
            draw_button(s, &ButtonOptions::new("Run").focused(true));
        }
        "button-variants" => {
            draw_button(
                &s.sub(0, 0, 10, 1),
                &ButtonOptions::new("ok").variant(ButtonVariant::Success),
            );
            draw_button(
                &s.sub(10, 0, 10, 1),
                &ButtonOptions::new("hm").variant(ButtonVariant::Warning),
            );
            draw_button(
                &s.sub(20, 0, 10, 1),
                &ButtonOptions::new("no").variant(ButtonVariant::Danger),
            );
            draw_button(
                &s.sub(30, 0, 10, 1),
                &ButtonOptions::new("gh").variant(ButtonVariant::Ghost),
            );
        }
        "checkbox" => {
            draw_checkbox(&s.sub(0, 0, 24, 1), &CheckboxOptions::new("on", true));
            draw_checkbox(
                &s.sub(0, 1, 24, 1),
                &CheckboxOptions::new("toggle", false).variant(CheckboxVariant::Toggle),
            );
            draw_checkbox(
                &s.sub(0, 2, 24, 1),
                &CheckboxOptions::new("radio", true).variant(CheckboxVariant::Radio),
            );
        }
        "select-closed" => draw_select(s, &SelectOptions::new("dark")),
        "select-open" => draw_select(
            s,
            &SelectOptions {
                open: true,
                options: vec!["dark".into(), "nord".into(), "light".into()],
                selected_index: Some(1),
                ..SelectOptions::new("dark")
            },
        ),
        "text-input" => draw_text_input(
            s,
            &TextInputOptions {
                label: Some("host".into()),
                focused: true,
                ..TextInputOptions::new("seed")
            },
        ),
        "text-input-password" => draw_text_input(
            s,
            &TextInputOptions { password: true, ..TextInputOptions::new("hunter2") },
        ),
        "text-input-placeholder" => draw_text_input(
            s,
            &TextInputOptions {
                placeholder: Some("search…".into()),
                ..TextInputOptions::new("")
            },
        ),
        "tabs" => draw_tabs(s, &TabsOptions::new(["cpu", "mem", "net"], 1)),
        "tabs-underline" => draw_tabs(
            s,
            &TabsOptions { variant: TabVariant::Underline, ..TabsOptions::new(["a", "b"], 0) },
        ),
        "status-bar" => draw_status_bar(
            s,
            &StatusBarOptions {
                items: vec![
                    StatusItem::new("Help").key("F1"),
                    StatusItem::new("Quit").key("F10"),
                ],
                right: vec![StatusItem::new("30fps")],
                ..Default::default()
            },
        ),
        "modal" => {
            draw_modal(
                s,
                &ModalOptions {
                    buttons: vec![ModalButton::new("Yes").focused(), ModalButton::new("No")],
                    ..ModalOptions::new().title("Confirm").message("Restart the service?")
                },
            );
        }
        "command-palette" => draw_command_palette(
            s,
            &CommandPaletteOptions {
                query: "th".into(),
                items: vec![
                    PaletteItem::new("theme: dark").hint("T"),
                    PaletteItem::new("theme: nord"),
                ],
                selected: Some(0),
                ..Default::default()
            },
        ),
        "tooltip" => {
            draw_tooltip(s, &TooltipOptions { text: "hint".into(), x: 4, y: 2, ..Default::default() })
        }
        other => panic!("no Rust scene for widget fixture {other:?}"),
    }
}

#[test]
fn widgets_match_reference() {
    let cases = fixture("widgets");
    assert!(!cases.arr().is_empty(), "no widget fixtures loaded");

    let mut failures: Vec<String> = Vec::new();
    let mut cells = 0usize;
    for case in cases.arr() {
        let name = case.get("name").str();
        let (buffer, surface) =
            scene(case.get("width").usize(), case.get("height").usize(), "dark");
        draw_scene(name, &surface);
        cells += case.get("width").usize() * case.get("height").usize();

        // Collect every mismatch rather than stopping at the first: when a
        // shared helper drifts it breaks a dozen scenes, and the list of which
        // ones is the fastest route to the cause.
        if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_buffer(&buffer.borrow(), case.get("result"), name)
        })) {
            let message = e
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "unknown panic".into());
            failures.push(format!("  {name}: {}", message.lines().next().unwrap_or("")));
        }
    }

    eprintln!("{} widget scenes, {cells} cells compared", cases.arr().len());
    assert!(
        failures.is_empty(),
        "{} of {} widget scenes differ from the reference:\n{}",
        failures.len(),
        cases.arr().len(),
        failures.join("\n")
    );
}
