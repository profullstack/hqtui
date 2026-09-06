//! A live dashboard: `zig build run-dashboard`.
//!
//! Shows the shape a real app takes in Zig — your state stays in one struct,
//! events are matched where you can see them, and the view is a function of
//! what you already have. No closures, so the view is a method and the app
//! hands it back its own pointer.

const std = @import("std");
const hqtui = @import("hqtui");

const Body = hqtui.Body;
const Container = hqtui.Container;
const Grid = hqtui.Grid;
const GridBody = hqtui.GridBody;

const tabs = [_][]const u8{ "cpu", "net", "procs" };

const Process = struct { pid: u32, name: []const u8, cpu: f64 };

const State = struct {
    /// Ring of samples, oldest first. A fixed array rather than a growing list:
    /// the graph only ever shows the last `capacity` of them.
    cpu: [400]f64 = undefined,
    net: [400]f64 = undefined,
    samples: usize = 0,

    rows: []const Process = &.{
        .{ .pid = 1, .name = "systemd", .cpu = 0.1 },
        .{ .pid = 412, .name = "hqtui-demo", .cpu = 12.5 },
        .{ .pid = 900, .name = "zig", .cpu = 3.2 },
        .{ .pid = 1201, .name = "zls", .cpu = 41.8 },
        .{ .pid = 1888, .name = "ssh", .cpu = 0.4 },
    },
    selected: usize = 0,
    tab: usize = 0,
    frame: u64 = 0,
    size: []const u8 = "",

    /// Something that looks like a machine under load, with no data source.
    fn tick(self: *State) void {
        const t = @as(f64, @floatFromInt(self.frame)) / 30.0;
        self.push(&self.cpu, @sin(t * 1.7) * 0.3 + @cos(t * 0.4) * 0.2 + 0.5);
        self.push(&self.net, (@sin(t * 0.9) * 0.5 + 0.5) * 90.0);
        self.samples += 1;
        self.frame += 1;
    }

    fn push(self: *State, ring: *[400]f64, value: f64) void {
        if (self.samples < ring.len) {
            ring[self.samples] = value;
            return;
        }
        std.mem.copyForwards(f64, ring[0 .. ring.len - 1], ring[1..]);
        ring[ring.len - 1] = value;
    }

    fn window(self: State, ring: *const [400]f64) []const f64 {
        return ring[0..@min(self.samples, ring.len)];
    }

    fn latest(self: State, ring: *const [400]f64) f64 {
        const seen = self.window(ring);
        return if (seen.len == 0) 0 else seen[seen.len - 1];
    }

    // ------------------------------------------------------------- view

    fn view(self: *State, ui: *Container) anyerror!void {
        try ui.row(.{ .layout = .{ .size = .{ .cells = 1 } } }, Body.plain(header));
        try ui.tabs(.{ .tabs = &tabs, .active = self.tab }, "tabs");
        try ui.grid(.{
            .columns = &.{ .{ .fr = 1 }, .{ .fr = 1 } },
            .rows = &.{.{ .fr = 1 }},
            .layout = .{ .gap = 1 },
        }, GridBody.with(self, cells));
        try ui.statusBar(.{
            .items = &.{
                .{ .key = "q", .label = "quit" },
                .{ .key = "↑↓", .label = "select" },
                .{ .key = "←→", .label = "tab" },
            },
            .right = &.{.{ .label = self.size }},
        });
    }

    fn header(r: *Container) anyerror!void {
        try r.heading("hqtui — zig");
        try r.spacer(.fill);
        try r.badge(.{ .text = "LIVE" });
    }

    fn cells(self: *State, g: *Grid) anyerror!void {
        try g.panel(.{ .title = "Load" }, .{}, Body.with(self, load));
        try g.panel(.{ .title = "Processes" }, .{}, Body.with(self, processes));
    }

    fn load(self: *State, p: *Container) anyerror!void {
        try p.meter(.{ .value = self.latest(&self.cpu), .label = "cpu" });
        try p.sparkline(.{
            .values = self.window(&self.net),
            .label = "net",
            .text = try p.fmt("{d:.0}M", .{self.latest(&self.net)}),
        });

        // Scaled to the same axis as `net`, and allocated in the frame arena so
        // it is still alive when the graph draws.
        const cpu_seen = self.window(&self.cpu);
        const scaled = try p.ctx.allocator.alloc(f64, cpu_seen.len);
        for (cpu_seen, 0..) |v, i| scaled[i] = v * 100.0;

        const series = try p.ctx.allocator.alloc(hqtui.graphics.Series, 2);
        series[0] = .{ .values = scaled, .label = "cpu" };
        series[1] = .{ .values = self.window(&self.net), .label = "net" };
        try p.graph(.{
            .series = series,
            .axis = true,
            .legend = true,
            .plot = .{ .fill = true },
        });
    }

    fn processes(self: *State, p: *Container) anyerror!void {
        const rows = try p.ctx.allocator.alloc(hqtui.widgets.TableRow, self.rows.len);
        for (self.rows, 0..) |proc, i| {
            const cell = try p.ctx.allocator.alloc([]const u8, 3);
            cell[0] = try p.fmt("{d}", .{proc.pid});
            cell[1] = proc.name;
            cell[2] = try p.fmt("{d:.1}", .{proc.cpu});
            rows[i] = .{ .cells = cell };
        }
        try p.table(.{
            .rows = rows,
            .columns = &.{
                .{ .title = "PID", .alignment = .right },
                .{ .title = "NAME" },
                .{ .title = "CPU%", .alignment = .right },
            },
            .selected = self.selected,
            .follow_selection = true,
            .zebra = true,
            .scrollbar = true,
        }, "procs");
    }
};

pub fn main(init: std.process.Init) !void {
    var app = try hqtui.App.init(init.gpa, .{
        .terminal = .{ .env = .fromEnviron(&init.minimal.environ) },
    });
    defer app.deinit();

    var state: State = .{};
    var label: [32]u8 = undefined;

    while (app.running()) {
        for (try app.poll()) |event| switch (event) {
            .key => |key| {
                const name = key.name;
                if (std.mem.eql(u8, name, "down")) {
                    state.selected = @min(state.selected + 1, state.rows.len - 1);
                } else if (std.mem.eql(u8, name, "up")) {
                    state.selected -|= 1;
                } else if (std.mem.eql(u8, name, "left")) {
                    state.tab -|= 1;
                } else if (std.mem.eql(u8, name, "right")) {
                    state.tab = @min(state.tab + 1, tabs.len - 1);
                }
            },
            else => {},
        };

        // A click on a table row selects it; the wheel scrolls the same widget.
        if (app.clickedRow("procs")) |row| {
            state.selected = @min(row, state.rows.len - 1);
        }
        for (0..tabs.len) |i| {
            var id: [16]u8 = undefined;
            if (app.pressed(std.fmt.bufPrint(&id, "tabs:{d}", .{i}) catch continue)) {
                state.tab = i;
            }
        }

        state.tick();
        state.size = std.fmt.bufPrint(&label, "{d}x{d}", .{ app.width(), app.height() }) catch "";

        _ = try app.draw(Body.with(&state, State.view));
    }

    app.restore();
}
