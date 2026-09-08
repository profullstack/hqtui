//! Every widget HQTUI ships, one function each, in Zig.
//!
//! `zig build run-widgets` renders all of them headlessly and prints the
//! result, so the file is a program rather than a snippet dump. The
//! `@widget` / `@end` markers are what hqtui.com/widgets slices to show the
//! code for one widget, which is why a snippet on the site is always a region
//! of something that compiles.
//!
//! Keep each function self-contained: it takes a container and nothing else.

const std = @import("std");
const hqtui = @import("hqtui");

const Container = hqtui.Container;

const cpu_history = [_]f64{ 12, 18, 26, 22, 31, 44, 38, 52, 61, 48, 39, 44, 57, 66, 72, 64, 51, 43, 37, 41 };
const net_history = [_]f64{ 4, 9, 6, 14, 22, 18, 31, 27, 19, 12, 8, 15, 24, 33, 29, 21 };

// ------------------------------------------------------------------- text

// @widget text
fn text(ui: *Container) anyerror!void {
    try ui.text("Plain text. It fills the width it is given.", .{});
    try ui.text("Bold, in the theme's primary color.", .{ .bold = true });
    try ui.text("Right aligned.", .{ .alignment = .right });
    try ui.text(
        "Long copy wraps when you ask it to, instead of being cut at the edge.",
        .{ .wrap = true },
    );
}
// @end

// @widget label
fn label(ui: *Container) anyerror!void {
    // `label` is `text` in the theme's muted color: secondary copy, captions,
    // the line under a number that says what the number is.
    try ui.label("cpu · 8 cores · 3.4 GHz");
    try ui.text("42.1%", .{ .bold = true });
    try ui.label("15 minute average");
}
// @end

// @widget heading
fn heading(ui: *Container) anyerror!void {
    // `heading` is `text` in the theme's title color, bold.
    try ui.heading("Storage");
    try ui.label("Four volumes, one degraded");
    try ui.spacer(.{ .cells = 1 });
    try ui.heading("Network");
}
// @end

// @widget badge
fn badge(ui: *Container) anyerror!void {
    try ui.row(.{ .layout = .{ .size = .{ .cells = 1 }, .gap = 1 } }, hqtui.Body.plain(badgeRow));
}

fn badgeRow(r: *Container) anyerror!void {
    _ = try r.badge(.{ .text = "active" });
    _ = try r.badge(.{ .text = "idle", .variant = .subtle });
    _ = try r.badge(.{ .text = "failed", .variant = .outline });
    try r.spacer(.fill);
}
// @end

// @widget divider
fn divider(ui: *Container) anyerror!void {
    try ui.text("Above the line", .{});
    try ui.divider(.{});
    try ui.text("Below it", .{});
    try ui.divider(.{ .label = "status", .alignment = .center });
    try ui.text("A labelled divider titles a section without a panel", .{});
}
// @end

// @widget keyValues
fn keyValues(ui: *Container) anyerror!void {
    // The backbone of every "System" panel: labels left, values right.
    try ui.keyValues(.{ .rows = &.{
        .{ .label = "Host", .value = "web-01.iad" },
        .{ .label = "Uptime", .value = "18d 04:12" },
        .{ .label = "Load", .value = "0.42  0.51  0.60" },
        .{ .label = "Established", .value = "1,284" },
    } });
}
// @end

// @widget statusBar
fn statusBar(ui: *Container) anyerror!void {
    // Usually the last thing drawn, pinned to the bottom row.
    try ui.statusBar(.{
        .items = &.{
            .{ .key = "F1", .label = "Help" },
            .{ .key = "F2", .label = "Theme" },
            .{ .key = "F3", .label = "Filter", .active = true },
            .{ .key = "^K", .label = "Palette" },
            .{ .key = "q", .label = "Quit" },
        },
        .right = &.{.{ .label = "0.41ms  184 cells" }},
    });
}
// @end

// ------------------------------------------------------------------- data

// @widget table
fn table(ui: *Container) anyerror!void {
    try ui.table(.{
        .rows = &.{
            .{ .cells = &.{ "src", "4.2 KB", "dir", "2m ago" } },
            .{ .cells = &.{ "test", "1.1 KB", "dir", "5m ago" } },
            .{ .cells = &.{ "package.json", "1.2 KB", "file", "10m ago" } },
            .{ .cells = &.{ "README.md", "3.4 KB", "file", "1h ago" } },
        },
        .columns = &.{
            .{ .title = "Name" },
            .{ .title = "Size", .alignment = .right },
            .{ .title = "Type" },
            .{ .title = "Modified", .alignment = .right },
        },
        .selected = 1,
        .zebra = true,
    }, "files");
}
// @end

// @widget list
fn list(ui: *Container) anyerror!void {
    try ui.list(.{
        .items = &.{
            .{ .label = "apps/demo" },
            .{ .label = "packages/hqtui" },
            .{ .label = "apps/web" },
            .{ .label = "docs" },
        },
        .selected = 0,
        .bullet = "▸",
        .scrollbar = true,
    }, "paths");
}
// @end

// @widget tree
fn tree(ui: *Container) anyerror!void {
    try ui.tree(.{
        .nodes = &.{
            .{ .label = "systemd", .expanded = true, .children = &.{
                .{ .label = "bash" },
                .{ .label = "bun", .expanded = true, .children = &.{.{ .label = "bun:worker" }} },
                .{ .label = "postgres" },
            } },
        },
        .selected = 2,
    }, "procs");
}
// @end

// @widget log
fn log(ui: *Container) anyerror!void {
    try ui.log(.{
        .entries = &.{
            .{ .time = "12:45:02", .level = "INFO", .message = "listening on :8080" },
            .{ .time = "12:45:09", .level = "WARN", .message = "slow query 412ms", .meta = "table=users" },
            .{ .time = "12:45:11", .level = "ERROR", .message = "upstream timeout" },
            .{ .time = "12:45:14", .level = "INFO", .message = "retry succeeded" },
        },
        .scrollbar = true,
    }, "logs");
}
// @end

// ----------------------------------------------------------------- meters

// @widget scrollbar
fn scrollbar(ui: *Container) anyerror!void {
    // The bar is over state you own, so it works beside anything that scrolls:
    // wrapped prose, a canvas, a `draw` of your own.
    try ui.row(.{ .layout = .{ .gap = 1 } }, hqtui.Body.plain(scrollbarRow));
}

fn scrollbarRow(r: *Container) anyerror!void {
    try r.text(
        "A scrollbar you drive yourself. It has no idea what is beside it, only how much there is, how much fits, and where you are.",
        .{ .wrap = true },
    );
    try r.scrollbar(.{ .total = 40, .viewport = 5, .offset = 12 }, "");
}
// @end

// @widget chart
fn chart(ui: *Container) anyerror!void {
    // Points carry their own x, so a sparse series and a dense one line up.
    try ui.chart(.{
        .series = &.{
            .{ .points = &.{
                .{ .x = 0, .y = 1 }, .{ .x = 2, .y = 6 }, .{ .x = 5, .y = 3 },
                .{ .x = 8, .y = 9 }, .{ .x = 10, .y = 4 },
            }, .label = "load" },
            .{ .points = &.{ .{ .x = 0, .y = 8 }, .{ .x = 10, .y = 2 } }, .label = "limit" },
        },
        .axis = true,
        .legend = true,
        .plot = .{
            .x = .{ .min = 0, .max = 10, .ticks = 3 },
            .y = .{ .min = 0, .max = 10 },
        },
    });
}
// @end

// @widget meter
fn meter(ui: *Container) anyerror!void {
    try ui.meter(.{ .value = 0.62, .label = "CPU" });
    try ui.meter(.{ .value = 0.31, .label = "MEM", .style = .segmented });
    try ui.meter(.{ .value = 0.87, .label = "SWP" });
}
// @end

// @widget meters
fn meters(ui: *Container) anyerror!void {
    // One call for a whole bank. `columns` lays them out side by side.
    try ui.meters(.{
        .items = &.{
            .{ .label = "P0", .value = 0.12 }, .{ .label = "P1", .value = 0.44 },
            .{ .label = "P2", .value = 0.71 }, .{ .label = "P3", .value = 0.09 },
            .{ .label = "P4", .value = 0.38 }, .{ .label = "P5", .value = 0.55 },
            .{ .label = "P6", .value = 0.22 }, .{ .label = "P7", .value = 0.66 },
        },
        .columns = 2,
        .style = .segmented,
    });
}
// @end

// @widget progress
fn progress(ui: *Container) anyerror!void {
    try ui.progress(.{ .value = 37, .max = 120, .label = "Indexing", .show_count = true });
    try ui.progress(.{ .value = 0.82, .label = "Upload" });
}
// @end

// @widget graph
fn graph(ui: *Container) anyerror!void {
    // Braille line chart. `fill` shades the area under the curve.
    try ui.graph(.{
        .series = &.{.{ .values = &cpu_history, .label = "cpu", .fill = true }},
        .plot = .{ .min = 0, .max = 100 },
    });
}
// @end

// @widget sparkline
fn sparkline(ui: *Container) anyerror!void {
    try ui.sparkline(.{ .values = &cpu_history, .label = "CPU ", .text = "44%" });
    try ui.sparkline(.{ .values = &net_history, .label = "Net ", .text = "2.4 MB/s" });
}
// @end

// @widget histogram
fn histogram(ui: *Container) anyerror!void {
    // Block columns. Cheaper than Braille and easier to read when short.
    try ui.histogram(.{ .values = &cpu_history });
}
// @end

// @widget heatBar
fn heatBar(ui: *Container) anyerror!void {
    // Segmented bar colored along the theme's heat ramp, like btop's temperatures.
    try ui.heatBar(.{ .value = 0.28 });
    try ui.heatBar(.{ .value = 0.64 });
    try ui.heatBar(.{ .value = 0.91 });
}
// @end

// @widget gauge
fn gauge(ui: *Container) anyerror!void {
    // A semicircular dial. Wants at least nine columns by five rows.
    try ui.gauge(.{ .value = 0.62, .label = "62%" });
}
// @end

// @widget donut
fn donut(ui: *Container) anyerror!void {
    try ui.donut(.{ .segments = &.{
        .{ .value = 4.65, .label = "Used" },
        .{ .value = 10.96, .label = "Free" },
    } });
}
// @end

// ----------------------------------------------------------------- inputs

// @widget button
fn button(ui: *Container) anyerror!void {
    // The id is how you ask whether it was pressed: `app.pressed("run")`.
    try ui.row(.{ .layout = .{ .size = .{ .cells = 1 }, .gap = 1 } }, hqtui.Body.plain(buttonRow));
}

fn buttonRow(r: *Container) anyerror!void {
    try r.button(.{ .label = "Primary" }, "primary");
    try r.button(.{ .label = "Success", .variant = .success }, "ok");
    try r.button(.{ .label = "Danger", .variant = .danger }, "stop");
    try r.spacer(.fill);
}
// @end

// @widget checkbox
fn checkbox(ui: *Container) anyerror!void {
    try ui.row(.{ .layout = .{ .size = .{ .cells = 1 }, .gap = 2 } }, hqtui.Body.plain(checkboxRow));
}

fn checkboxRow(r: *Container) anyerror!void {
    try r.checkbox(.{ .label = "Toggle", .checked = true, .variant = .toggle }, "toggle");
    try r.checkbox(.{ .label = "Checkbox", .checked = false }, "checkbox");
    try r.spacer(.fill);
}
// @end

// @widget select
fn select(ui: *Container) anyerror!void {
    try ui.select(.{
        .value = "Dracula",
        .open = true,
        .options = &.{ "Dark", "Dracula", "Nord", "Tokyo Night" },
        .selected_index = 1,
    }, "theme");
}
// @end

// @widget textInput
fn textInput(ui: *Container) anyerror!void {
    try ui.textInput(.{ .value = "postgres", .label = "Search" }, "search");
    try ui.spacer(.{ .cells = 1 });
    try ui.textInput(.{ .value = "", .label = "Filter", .placeholder = "type to filter…" }, "filter");
}
// @end

// @widget tabs
fn tabs(ui: *Container) anyerror!void {
    try ui.tabs(.{
        .tabs = &.{ "1 dashboard", "2 traffic", "3 sessions", "4 network" },
        .active = 1,
    }, "screens");
}
// @end

// ---------------------------------------------------------------- overlays

// @widget modal
fn modal(ui: *Container) anyerror!void {
    // Overlays draw over everything already on the screen, centered.
    ui.modal(.{
        .title = "Confirm Action",
        .message = "Terminate process 4821 (postgres)?",
        .buttons = &.{
            .{ .label = "Yes", .focused = true },
            .{ .label = "No", .variant = .ghost },
        },
    });
}
// @end

// @widget commandPalette
fn commandPalette(ui: *Container) anyerror!void {
    ui.commandPalette(.{
        .query = "the",
        .items = &.{
            .{ .label = "Toggle theme", .hint = "F2" },
            .{ .label = "Filter processes", .hint = "F3" },
            .{ .label = "Sort by memory", .hint = "F6" },
        },
        .selected = 0,
    });
}
// @end

// @widget tooltip
fn tooltip(ui: *Container) anyerror!void {
    try ui.text("Tooltips are overlays positioned at a cell.", .{});
    ui.tooltip(.{ .text = "swap is 87% full", .x = 6, .y = 3 });
}
// @end

const Example = struct { name: []const u8, body: hqtui.Body };

const examples = [_]Example{
    .{ .name = "text", .body = hqtui.Body.plain(text) },
    .{ .name = "label", .body = hqtui.Body.plain(label) },
    .{ .name = "heading", .body = hqtui.Body.plain(heading) },
    .{ .name = "badge", .body = hqtui.Body.plain(badge) },
    .{ .name = "divider", .body = hqtui.Body.plain(divider) },
    .{ .name = "keyValues", .body = hqtui.Body.plain(keyValues) },
    .{ .name = "statusBar", .body = hqtui.Body.plain(statusBar) },
    .{ .name = "table", .body = hqtui.Body.plain(table) },
    .{ .name = "list", .body = hqtui.Body.plain(list) },
    .{ .name = "tree", .body = hqtui.Body.plain(tree) },
    .{ .name = "log", .body = hqtui.Body.plain(log) },
    .{ .name = "scrollbar", .body = hqtui.Body.plain(scrollbar) },
    .{ .name = "chart", .body = hqtui.Body.plain(chart) },
    .{ .name = "meter", .body = hqtui.Body.plain(meter) },
    .{ .name = "meters", .body = hqtui.Body.plain(meters) },
    .{ .name = "progress", .body = hqtui.Body.plain(progress) },
    .{ .name = "graph", .body = hqtui.Body.plain(graph) },
    .{ .name = "sparkline", .body = hqtui.Body.plain(sparkline) },
    .{ .name = "histogram", .body = hqtui.Body.plain(histogram) },
    .{ .name = "heatBar", .body = hqtui.Body.plain(heatBar) },
    .{ .name = "gauge", .body = hqtui.Body.plain(gauge) },
    .{ .name = "donut", .body = hqtui.Body.plain(donut) },
    .{ .name = "button", .body = hqtui.Body.plain(button) },
    .{ .name = "checkbox", .body = hqtui.Body.plain(checkbox) },
    .{ .name = "select", .body = hqtui.Body.plain(select) },
    .{ .name = "textInput", .body = hqtui.Body.plain(textInput) },
    .{ .name = "tabs", .body = hqtui.Body.plain(tabs) },
    .{ .name = "modal", .body = hqtui.Body.plain(modal) },
    .{ .name = "commandPalette", .body = hqtui.Body.plain(commandPalette) },
    .{ .name = "tooltip", .body = hqtui.Body.plain(tooltip) },
};

/// Renders each widget on its own small screen and prints the lot.
pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const stdout = std.Io.File.stdout();
    const stderr = std.Io.File.stderr();

    var blank: usize = 0;
    for (examples) |example| {
        const rendered = try hqtui.testing.renderToText(allocator, 62, 12, "dark", example.body);
        defer allocator.free(rendered);
        if (std.mem.trim(u8, rendered, " \n").len == 0) {
            const line = try std.fmt.allocPrint(
                allocator,
                "FAIL {s}: rendered an empty screen\n",
                .{example.name},
            );
            defer allocator.free(line);
            try stderr.writeStreamingAll(init.io, line);
            blank += 1;
            continue;
        }
        const block = try std.fmt.allocPrint(
            allocator,
            "--- {s}\n{s}\n",
            .{ example.name, rendered },
        );
        defer allocator.free(block);
        try stdout.writeStreamingAll(init.io, block);
    }

    const summary = try std.fmt.allocPrint(
        allocator,
        "{d}/{d} widget examples rendered\n",
        .{ examples.len - blank, examples.len },
    );
    defer allocator.free(summary);
    try stderr.writeStreamingAll(init.io, summary);
    if (blank > 0) return error.BlankExample;
}
