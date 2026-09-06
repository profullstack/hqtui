//! End to end: the builder driving whole screens, compared against what the
//! TypeScript reference's builder produced for the same layout.
//!
//! This is the test that would catch a layout solver that is subtly off, or a
//! panel whose interior padding drifted — neither of which shows up when a
//! widget is drawn onto a surface someone else sized.
//!
//! Zig has no closures, so each scene's nested containers are named functions
//! reached through `Body`. Verbose next to the reference's arrow functions, but
//! it is the same tree.

const std = @import("std");

const conformance = @import("conformance.zig");
const layout = @import("layout.zig");
const testing_mod = @import("testing.zig");
const ui = @import("ui.zig");

const Body = ui.Body;
const Container = ui.Container;
const Grid = ui.Grid;
const GridBody = ui.GridBody;
const Size = layout.Size;

const series = [_]f64{
    12, 40, 33, 71, 25, 60, 48, 19, 55, 80, 35, 62, 44, 28, 70, 51,
};

// ------------------------------------------------------------------- scenes

fn helloBody(p: *Container) anyerror!void {
    try p.text("Hello, terminal.", .{});
}

fn leftBody(p: *Container) anyerror!void {
    try p.text("left", .{});
}

fn rightBody(p: *Container) anyerror!void {
    try p.text("right", .{});
}

fn rowsAndColumns(r: *Container) anyerror!void {
    try r.panel(.{ .title = "L" }, Body.plain(leftBody));
    try r.panel(
        .{ .title = "R", .layout = .{ .size = .{ .fr = 1 } } },
        Body.plain(rightBody),
    );
}

fn cpuBody(p: *Container) anyerror!void {
    try p.meter(.{ .value = 0.62, .label = "all" });
}

fn memBody(p: *Container) anyerror!void {
    try p.meter(.{ .value = 0.31, .label = "used" });
}

fn netBody(p: *Container) anyerror!void {
    try p.graph(.{ .values = &series });
}

fn gridCells(g: *Grid) anyerror!void {
    try g.panel(.{ .title = "CPU" }, .{}, Body.plain(cpuBody));
    try g.panel(.{ .title = "MEM" }, .{}, Body.plain(memBody));
    try g.panel(.{ .title = "NET" }, .{ .cols = 2 }, Body.plain(netBody));
}

fn spansBody(p: *Container) anyerror!void {
    try p.text("spans", .{});
}

fn afterBody(p: *Container) anyerror!void {
    try p.text("after", .{});
}

fn overflowCells(g: *Grid) anyerror!void {
    try g.panel(.{ .title = "wide" }, .{ .cols = 2 }, Body.plain(spansBody));
    try g.panel(.{ .title = "next" }, .{}, Body.plain(afterBody));
}

fn dashboardHeader(r: *Container) anyerror!void {
    try r.heading("hqtui");
    try r.spacer(.fill);
    try r.badge(.{ .text = "LIVE" });
}

fn loadBody(p: *Container) anyerror!void {
    try p.meters(.{ .items = &.{
        .{ .label = "c0", .value = 0.2 },
        .{ .label = "c1", .value = 0.7 },
    } });
    try p.graph(.{ .values = &series, .axis = true });
}

fn procsBody(p: *Container) anyerror!void {
    try p.table(.{
        .rows = &.{
            .{ .cells = &.{ "1", "init" } },
            .{ .cells = &.{ "42", "node" } },
        },
        .columns = &.{
            .{ .title = "PID", .alignment = .right },
            .{ .title = "CMD" },
        },
        .selected = 0,
    }, "");
}

fn dashboardCells(g: *Grid) anyerror!void {
    try g.panel(.{ .title = "Load" }, .{}, Body.plain(loadBody));
    try g.panel(.{ .title = "Procs" }, .{}, Body.plain(procsBody));
}

fn themedBody(p: *Container) anyerror!void {
    try p.meter(.{ .value = 0.5, .label = "x" });
}

fn behindBody(p: *Container) anyerror!void {
    try p.text("content", .{});
}

fn unicodeBody(p: *Container) anyerror!void {
    try p.text("こんにちは 世界", .{});
    try p.text("🚀 emoji ok", .{});
}

const Scene = struct {
    name: []const u8,

    fn view(self: *Scene, root: *Container) anyerror!void {
        const eq = std.mem.eql;
        const name = self.name;

        if (eq(u8, name, "hello")) {
            try root.panel(.{ .title = "Hello" }, Body.plain(helloBody));
        } else if (eq(u8, name, "rows-and-columns")) {
            try root.row(.{ .layout = .{ .gap = 1 } }, Body.plain(rowsAndColumns));
        } else if (eq(u8, name, "grid")) {
            try root.grid(.{
                .layout = .{ .gap = 1 },
                .columns = &.{ .{ .fr = 2 }, .{ .fr = 1 } },
                .rows = &.{ .{ .cells = 6 }, .{ .fr = 1 } },
            }, GridBody.plain(gridCells));
        } else if (eq(u8, name, "grid-span-overflow")) {
            try root.grid(
                .{ .column_count = 1, .row_count = 2 },
                GridBody.plain(overflowCells),
            );
        } else if (eq(u8, name, "dashboard")) {
            try root.row(
                .{ .layout = .{ .size = .{ .cells = 1 } } },
                Body.plain(dashboardHeader),
            );
            try root.grid(.{
                .layout = .{ .gap = 1 },
                .columns = &.{ .{ .fr = 1 }, .{ .fr = 1 } },
                .rows = &.{.{ .fr = 1 }},
            }, GridBody.plain(dashboardCells));
            try root.statusBar(.{ .items = &.{.{ .key = "q", .label = "quit" }} });
        } else if (eq(u8, name, "themed-nord")) {
            try root.panel(.{ .title = "Nord" }, Body.plain(themedBody));
        } else if (eq(u8, name, "themed-light")) {
            try root.panel(.{ .title = "Light" }, Body.plain(themedBody));
        } else if (eq(u8, name, "responsive-narrow")) {
            // The reference picks the largest breakpoint the container fits;
            // at 20 columns that is the 0 branch.
            try root.text(if (root.width() >= 60) "wide" else "narrow", .{});
        } else if (eq(u8, name, "overlays")) {
            try root.panel(.{ .title = "Behind" }, Body.plain(behindBody));
            root.modal(.{
                .title = "Modal",
                .message = "Are you sure?",
                .buttons = &.{.{ .label = "OK", .focused = true }},
            });
        } else if (eq(u8, name, "unicode-content")) {
            try root.panel(.{ .title = "日本語" }, Body.plain(unicodeBody));
        } else {
            std.debug.print("no Zig scene for screen fixture {s}\n", .{name});
            return error.TestUnexpectedResult;
        }
    }
};

test "screens match reference" {
    const allocator = std.testing.allocator;
    const parsed = try conformance.fixtureFor(allocator, "screen");
    defer parsed.deinit();

    const cases = conformance.arrOf(parsed.value);
    try std.testing.expect(cases.len > 0);

    var cells: usize = 0;
    for (cases) |case| {
        const name = conformance.strOf(conformance.getOf(case, "name"));
        const width = conformance.uszOf(conformance.getOf(case, "width"));
        const height = conformance.uszOf(conformance.getOf(case, "height"));
        const theme = conformance.strOf(conformance.getOf(case, "theme"));
        cells += width * height;

        var scene: Scene = .{ .name = name };
        var screen = try testing_mod.renderToScreen(
            allocator,
            width,
            height,
            theme,
            Body.with(&scene, Scene.view),
        );
        defer screen.deinit();

        try conformance.assertBuffer(
            allocator,
            &screen.buffer,
            conformance.getOf(case, "result"),
            name,
        );
    }
    std.debug.print("\n  {d} screen scenes, {d} cells compared\n", .{ cases.len, cells });
}
