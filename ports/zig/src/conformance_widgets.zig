//! Every widget, drawn with the same arguments the fixture generator used, and
//! compared cell for cell against what the TypeScript reference produced.
//!
//! The scenes are matched by name rather than driven by data: the arguments are
//! typed structs here and object literals there, and spelling them out in both
//! is what makes a drifted default visible instead of silently shared.

const std = @import("std");

const buffer_mod = @import("buffer.zig");
const conformance = @import("conformance.zig");
const graphics = @import("graphics.zig");
const surface_mod = @import("surface.zig");
const theme_mod = @import("theme.zig");
const w = @import("widgets.zig");

const FrameBuffer = buffer_mod.FrameBuffer;
const Surface = surface_mod.Surface;

const series = [_]f64{ 3, 7, 2, 9, 4, 8, 6, 1, 5, 9, 3, 7, 8, 2, 6, 4, 9, 1, 5, 7 };


/// The paragraph every scroll fixture pins.
const prose = "one two three four five six seven eight nine ten eleven twelve";

/// The points every single-series chart fixture pins.
const chart_points = [_]graphics.Point{
    .{ .x = 0, .y = 1 }, .{ .x = 2, .y = 6 }, .{ .x = 5, .y = 3 },
    .{ .x = 8, .y = 9 }, .{ .x = 10, .y = 4 },
};

/// The axis bounds every chart fixture pins, without the ceremony.
fn axisOf(min: f64, max: f64, ticks: usize) graphics.AxisOptions {
    return .{ .min = min, .max = max, .ticks = ticks };
}

/// One series over the standard 0..10 domain.
fn chartScene(allocator: std.mem.Allocator, s: Surface, mark: graphics.MarkType) !void {
    try w.drawChart(allocator, s, .{
        .series = &.{.{ .points = &chart_points, .mark = mark }},
        .plot = .{ .x = axisOf(0, 10, 0), .y = axisOf(0, 10, 0) },
    });
}

fn drawScene(allocator: std.mem.Allocator, name: []const u8, s: Surface) !void {
    const eq = std.mem.eql;

    if (eq(u8, name, "text-plain")) {
        try w.drawText(allocator, s, "hello terminal", .{});
    } else if (eq(u8, name, "text-wrapped")) {
        try w.drawText(allocator, s, "the quick brown fox jumps", .{ .wrap = true });
    } else if (eq(u8, name, "text-aligned")) {
        try w.drawText(allocator, s.sub(0, 0, 20, 1), "left", .{ .alignment = .left });
        try w.drawText(allocator, s.sub(0, 1, 20, 1), "center", .{ .alignment = .center });
        try w.drawText(allocator, s.sub(0, 2, 20, 1), "right", .{ .alignment = .right });
    } else if (eq(u8, name, "text-scrolled")) {
        try w.drawText(allocator, s, prose, .{ .wrap = true, .scroll = 2 });
    } else if (eq(u8, name, "text-scrolled-past")) {
        try w.drawText(allocator, s, prose, .{ .wrap = true, .scroll = 99 });
    } else if (eq(u8, name, "text-scrolled-x")) {
        try w.drawText(allocator, s, "abcdefghijklmnopqrstuvwxyz", .{ .scroll_x = 6 });
    } else if (eq(u8, name, "text-scrolled-wide")) {
        try w.drawText(allocator, s, "日本語です", .{ .scroll_x = 3 });
    } else if (eq(u8, name, "clear")) {
        try w.drawText(allocator, s, "xxxxxxxxxxxxxxxx\nxxxxxxxxxxxxxxxx\nxxxxxxxxxxxxxxxx", .{});
        w.drawClear(s.sub(4, 1, 8, 1), .{});
    } else if (eq(u8, name, "fill")) {
        w.drawFill(s, .{ .symbol = "\u{b7}" });
    } else if (eq(u8, name, "fill-wide")) {
        w.drawFill(s, .{ .symbol = "\u{65e5}" });
    } else if (eq(u8, name, "calendar")) {
        w.drawCalendar(s, .{ .year = 2026, .month = 9 });
    } else if (eq(u8, name, "calendar-sunday")) {
        w.drawCalendar(s, .{ .year = 2026, .month = 9, .week_start = 0 });
    } else if (eq(u8, name, "calendar-leap")) {
        w.drawCalendar(s, .{ .year = 2024, .month = 2 });
    } else if (eq(u8, name, "calendar-bare")) {
        w.drawCalendar(s, .{ .year = 2026, .month = 9, .header = false, .weekdays = false });
    } else if (eq(u8, name, "calendar-marked")) {
        w.drawCalendar(s, .{
            .year = 2026,
            .month = 9,
            .selected = 8,
            .marks = &.{ .{ .day = 15 }, .{ .day = 22, .bold = true } },
        });
    } else if (eq(u8, name, "badge")) {
        _ = w.drawBadge(s, .{ .text = "LIVE" });
    } else if (eq(u8, name, "badge-outline")) {
        _ = w.drawBadge(s, .{ .text = "IDLE", .variant = .outline });
    } else if (eq(u8, name, "badge-subtle")) {
        _ = w.drawBadge(s, .{ .text = "WARN", .variant = .subtle });
    } else if (eq(u8, name, "keyvalues")) {
        w.drawKeyValues(s, .{ .rows = &.{
            .{ .label = "Host", .value = "seed1" },
            .{ .label = "Uptime", .value = "12d 4h" },
            .{ .label = "Load", .value = "0.42" },
        } });
    } else if (eq(u8, name, "divider")) {
        w.drawDivider(s, .{ .label = "Section" });
    } else if (eq(u8, name, "meter")) {
        w.drawMeter(s, .{ .value = 0.72, .label = "CPU" });
    } else if (eq(u8, name, "meter-segmented")) {
        w.drawMeter(s, .{ .value = 0.33, .label = "MEM", .style = .segmented });
    } else if (eq(u8, name, "meter-ascii")) {
        w.drawMeter(s, .{ .value = 0.9, .label = "IO", .style = .ascii });
    } else if (eq(u8, name, "meter-nan")) {
        w.drawMeter(s, .{ .value = std.math.nan(f64), .label = "BAD" });
    } else if (eq(u8, name, "meters-grid")) {
        w.drawMeters(s, .{
            .items = &.{
                .{ .label = "c0", .value = 0.2 }, .{ .label = "c1", .value = 0.5 },
                .{ .label = "c2", .value = 0.8 }, .{ .label = "c3", .value = 1 },
                .{ .label = "c4", .value = 0 },   .{ .label = "c5", .value = 0.65 },
            },
            .columns = 2,
        });
    } else if (eq(u8, name, "progress")) {
        w.drawProgress(s, .{ .value = 37, .max = 120, .label = "Sync", .show_count = true });
    } else if (eq(u8, name, "heat-bar")) {
        w.drawHeatBar(s, .{ .value = 0.6 });
    } else if (eq(u8, name, "columns")) {
        w.drawColumns(s, .{ .values = &series });
    } else if (eq(u8, name, "bar-smooth")) {
        graphics.bar(s, .{ .value = 0.63 });
    } else if (eq(u8, name, "bar-segmented")) {
        graphics.bar(s, .{ .value = 0.63, .style = .segmented });
    } else if (eq(u8, name, "bar-ascii")) {
        graphics.bar(s, .{ .value = 0.63, .style = .ascii });
    } else if (eq(u8, name, "sparkline")) {
        graphics.sparkline(s, &series, .{});
    } else if (eq(u8, name, "plot-braille")) {
        try graphics.plot(allocator, s, &.{.{ .values = &series }}, .{});
    } else if (eq(u8, name, "plot-block")) {
        try graphics.plot(allocator, s, &.{.{ .values = &series }}, .{ .mode = .block });
    } else if (eq(u8, name, "plot-ascii")) {
        try graphics.plot(allocator, s, &.{.{ .values = &series }}, .{ .mode = .ascii });
    } else if (eq(u8, name, "plot-fill")) {
        try graphics.plot(allocator, s, &.{.{ .values = &series, .fill = true }}, .{});
    } else if (eq(u8, name, "plot-grid")) {
        try graphics.plot(allocator, s, &.{.{ .values = &series }}, .{ .grid = true });
    } else if (eq(u8, name, "plot-multi")) {
        var inverted: [series.len]f64 = undefined;
        for (series, 0..) |v, i| inverted[i] = 10 - v;
        try graphics.plot(allocator, s, &.{
            .{ .values = &series },
            .{ .values = &inverted },
        }, .{});
    } else if (eq(u8, name, "gauge")) {
        try w.drawGauge(allocator, s, .{ .value = 0.7, .label = "70%" });
    } else if (eq(u8, name, "donut")) {
        try w.drawDonut(allocator, s, .{ .segments = &.{
            .{ .value = 3 }, .{ .value = 5 }, .{ .value = 2 },
        } });
    } else if (eq(u8, name, "chart-line")) {
        try chartScene(allocator, s, .line);
    } else if (eq(u8, name, "chart-scatter")) {
        try chartScene(allocator, s, .scatter);
    } else if (eq(u8, name, "chart-bar")) {
        try chartScene(allocator, s, .bar);
    } else if (eq(u8, name, "chart-fill")) {
        try w.drawChart(allocator, s, .{
            .series = &.{.{ .points = &.{ .{ .x = 0, .y = 2 }, .{ .x = 5, .y = 8 }, .{ .x = 10, .y = 2 } }, .fill = true }},
            .plot = .{ .x = axisOf(0, 10, 0), .y = axisOf(0, 10, 0) },
        });
    } else if (eq(u8, name, "chart-axes")) {
        try w.drawChart(allocator, s, .{
            .series = &.{.{ .points = &.{ .{ .x = 0, .y = 0 }, .{ .x = 5, .y = 50 }, .{ .x = 10, .y = 100 } } }},
            .axis = true,
            .plot = .{ .x = axisOf(0, 10, 3), .y = axisOf(0, 100, 0) },
        });
    } else if (eq(u8, name, "chart-block")) {
        try w.drawChart(allocator, s, .{
            .series = &.{.{ .points = &chart_points, .mark = .bar }},
            .plot = .{ .mode = .block, .x = axisOf(0, 10, 0), .y = axisOf(0, 10, 0) },
        });
    } else if (eq(u8, name, "chart-multi")) {
        try w.drawChart(allocator, s, .{
            .series = &.{
                .{ .points = &.{
                    .{ .x = 0, .y = 1 }, .{ .x = 1, .y = 3 }, .{ .x = 2, .y = 2 }, .{ .x = 3, .y = 5 },
                    .{ .x = 4, .y = 4 }, .{ .x = 5, .y = 7 }, .{ .x = 6, .y = 6 }, .{ .x = 7, .y = 9 },
                }, .label = "fine" },
                .{ .points = &.{ .{ .x = 0, .y = 8 }, .{ .x = 7, .y = 2 } }, .label = "coarse" },
            },
            .axis = true,
            .legend = true,
            .plot = .{ .x = axisOf(0, 7, 0), .y = axisOf(0, 10, 0) },
        });
    } else if (eq(u8, name, "chart-flat")) {
        try w.drawChart(allocator, s, .{
            .series = &.{.{ .points = &.{ .{ .x = 0, .y = 4 }, .{ .x = 5, .y = 4 }, .{ .x = 10, .y = 4 } } }},
            .plot = .{ .x = axisOf(0, 10, 0) },
        });
    } else if (eq(u8, name, "graph-axis")) {
        try w.drawGraph(allocator, s, .{ .values = &series, .axis = true });
    } else if (eq(u8, name, "graph-legend")) {
        var halved: [series.len]f64 = undefined;
        for (series, 0..) |v, i| halved[i] = v / 2;
        try w.drawGraph(allocator, s, .{
            .series = &.{
                .{ .values = &series, .label = "rx" },
                .{ .values = &halved, .label = "tx" },
            },
            .legend = true,
        });
    } else if (eq(u8, name, "graph-timeaxis")) {
        try w.drawGraph(allocator, s, .{
            .values = &series,
            .time_axis = &.{ "60s", "30s", "0s" },
        });
    } else if (eq(u8, name, "graph-axis-timeaxis")) {
        // Both axes together. Each was covered alone, which is how the y-axis
        // minimum came to be drawn onto the time-axis row unnoticed.
        try w.drawGraph(allocator, s, .{
            .values = &series,
            .axis = true,
            .plot = .{ .min = 0, .max = 100 },
            .time_axis = &.{ "60s", "30s", "0s" },
        });
    } else if (eq(u8, name, "sparkline-widget")) {
        w.drawSparkline(s, .{ .values = &series, .label = "net", .text = "1.2M" });
    } else if (eq(u8, name, "table")) {
        try w.drawTable(allocator, s, .{
            .rows = &.{
                .{ .cells = &.{ "1", "systemd", "0.1" } },
                .{ .cells = &.{ "420", "node", "12.5" } },
                .{ .cells = &.{ "900", "hqtui-demo", "3.2" } },
            },
            .columns = &.{
                .{ .title = "PID", .alignment = .right },
                .{ .title = "NAME" },
                .{ .title = "CPU%", .alignment = .right },
            },
            .selected = 1,
            .zebra = true,
        });
    } else if (eq(u8, name, "table-scrollbar")) {
        var rows: [20]w.TableRow = undefined;
        var cells: [20][2][]const u8 = undefined;
        var storage: [20][2][16]u8 = undefined;
        for (0..20) |i| {
            const n = std.fmt.bufPrint(&storage[i][0], "{d}", .{i}) catch "";
            const v = std.fmt.bufPrint(&storage[i][1], "row {d}", .{i}) catch "";
            cells[i] = .{ n, v };
            rows[i] = .{ .cells = &cells[i] };
        }
        try w.drawTable(allocator, s, .{
            .rows = &rows,
            .columns = &.{ .{ .title = "#", .alignment = .right }, .{ .title = "VALUE" } },
            .selected = 12,
            .follow_selection = true,
            .scrollbar = true,
        });
    } else if (eq(u8, name, "list")) {
        w.drawList(s, .{
            .items = &.{
                .{ .label = "alpha" }, .{ .label = "beta" },
                .{ .label = "gamma" }, .{ .label = "delta" },
            },
            .selected = 2,
            .bullet = "•",
        });
    } else if (eq(u8, name, "tree")) {
        const leaf = [_]w.TreeNode{.{ .label = "leaf" }};
        const kids = [_]w.TreeNode{
            .{ .label = "child-a", .children = &leaf },
            .{ .label = "child-b" },
        };
        try w.drawTree(allocator, s, .{
            .nodes = &.{
                .{ .label = "root", .children = &kids },
                .{ .label = "second" },
            },
            .selected = 1,
        });
    } else if (eq(u8, name, "log")) {
        w.drawLog(s, .{ .entries = &.{
            .{ .message = "started", .time = "10:00:00", .level = "INFO" },
            .{ .message = "slow query", .time = "10:00:01", .level = "WARN", .meta = "412ms" },
            .{ .message = "connection reset", .time = "10:00:02", .level = "ERROR" },
        } });
    } else if (eq(u8, name, "scrollbar")) {
        w.drawScrollbar(s, 1, 0, 8, 40, 12);
    } else if (eq(u8, name, "scrollbar-right")) {
        w.drawScrollbarWidget(s, .{ .total = 40, .viewport = 8, .offset = 12 });
    } else if (eq(u8, name, "scrollbar-left")) {
        w.drawScrollbarWidget(s, .{ .total = 40, .viewport = 8, .offset = 12, .orientation = .left });
    } else if (eq(u8, name, "scrollbar-bottom")) {
        w.drawScrollbarWidget(s, .{ .total = 80, .viewport = 20, .offset = 30, .orientation = .bottom });
    } else if (eq(u8, name, "scrollbar-top")) {
        w.drawScrollbarWidget(s, .{ .total = 80, .viewport = 20, .offset = 30, .orientation = .top });
    } else if (eq(u8, name, "scrollbar-fits")) {
        w.drawScrollbarWidget(s, .{ .total = 5, .viewport = 8, .offset = 0 });
    } else if (eq(u8, name, "scrollbar-viewport")) {
        w.drawScrollbarWidget(s, .{ .total = 120, .viewport = 8, .offset = 36 });
    } else if (eq(u8, name, "scrollbar-viewport-wide")) {
        w.drawScrollbarWidget(s, .{ .total = 120, .viewport = 8, .offset = 36, .orientation = .bottom });
    } else if (eq(u8, name, "button")) {
        _ = w.drawButton(s, .{ .label = "OK" });
    } else if (eq(u8, name, "button-focused")) {
        _ = w.drawButton(s, .{ .label = "Run", .focused = true });
    } else if (eq(u8, name, "button-variants")) {
        _ = w.drawButton(s.sub(0, 0, 10, 1), .{ .label = "ok", .variant = .success });
        _ = w.drawButton(s.sub(10, 0, 10, 1), .{ .label = "hm", .variant = .warning });
        _ = w.drawButton(s.sub(20, 0, 10, 1), .{ .label = "no", .variant = .danger });
        _ = w.drawButton(s.sub(30, 0, 10, 1), .{ .label = "gh", .variant = .ghost });
    } else if (eq(u8, name, "checkbox")) {
        _ = w.drawCheckbox(s.sub(0, 0, 24, 1), .{ .label = "on", .checked = true });
        _ = w.drawCheckbox(s.sub(0, 1, 24, 1), .{ .label = "toggle", .variant = .toggle });
        _ = w.drawCheckbox(s.sub(0, 2, 24, 1), .{
            .label = "radio",
            .checked = true,
            .variant = .radio,
        });
    } else if (eq(u8, name, "select-closed")) {
        w.drawSelect(s, .{ .value = "dark" });
    } else if (eq(u8, name, "select-open")) {
        w.drawSelect(s, .{
            .value = "dark",
            .open = true,
            .options = &.{ "dark", "nord", "light" },
            .selected_index = 1,
        });
    } else if (eq(u8, name, "text-input")) {
        w.drawTextInput(s, .{ .value = "seed", .label = "host", .focused = true });
    } else if (eq(u8, name, "text-input-password")) {
        w.drawTextInput(s, .{ .value = "hunter2", .password = true });
    } else if (eq(u8, name, "text-input-placeholder")) {
        w.drawTextInput(s, .{ .value = "", .placeholder = "search…" });
    } else if (eq(u8, name, "tabs")) {
        w.drawTabs(s, .{ .tabs = &.{ "cpu", "mem", "net" }, .active = 1 });
    } else if (eq(u8, name, "tabs-underline")) {
        w.drawTabs(s, .{ .tabs = &.{ "a", "b" }, .active = 0, .variant = .underline });
    } else if (eq(u8, name, "status-bar")) {
        w.drawStatusBar(s, .{
            .items = &.{
                .{ .label = "Help", .key = "F1" },
                .{ .label = "Quit", .key = "F10" },
            },
            .right = &.{.{ .label = "30fps" }},
        });
    } else if (eq(u8, name, "modal")) {
        _ = try w.drawModal(allocator, s, .{
            .title = "Confirm",
            .message = "Restart the service?",
            .buttons = &.{
                .{ .label = "Yes", .focused = true },
                .{ .label = "No" },
            },
        });
    } else if (eq(u8, name, "command-palette")) {
        w.drawCommandPalette(s, .{
            .query = "th",
            .items = &.{
                .{ .label = "theme: dark", .hint = "T" },
                .{ .label = "theme: nord" },
            },
            .selected = 0,
        });
    } else if (eq(u8, name, "tooltip")) {
        w.drawTooltip(s, .{ .text = "hint", .x = 4, .y = 2 });
    } else {
        std.debug.print("no Zig scene for widget fixture {s}\n", .{name});
        return error.TestUnexpectedResult;
    }
}

test "widgets match reference" {
    const allocator = std.testing.allocator;
    const parsed = try conformance.fixtureFor(allocator, "widgets");
    defer parsed.deinit();

    const theme = theme_mod.dark;
    var cells: usize = 0;
    const cases = conformance.arrOf(parsed.value);
    try std.testing.expect(cases.len > 0);

    for (cases) |case| {
        const name = conformance.strOf(conformance.getOf(case, "name"));
        const width = conformance.uszOf(conformance.getOf(case, "width"));
        const height = conformance.uszOf(conformance.getOf(case, "height"));
        cells += width * height;

        var fb = try FrameBuffer.init(allocator, width, height);
        defer fb.deinit();
        fb.clear(theme.background, theme.foreground);

        try drawScene(allocator, name, Surface.root(&fb, &theme));
        try conformance.assertBuffer(allocator, &fb, conformance.getOf(case, "result"), name);
    }
    std.debug.print("\n  {d} widget scenes, {d} cells compared\n", .{ cases.len, cells });
}
