const std = @import("std");
const h = @import("hqtui");
const m = @import("model.zig");
const view = @import("view.zig");
const collect = @import("collect.zig");

test {
    _ = @import("tests.zig");
}

pub const Options = struct { sim: bool = false, real: bool = false, snapshot: bool = false, help: bool = false, version: bool = false, seed: u32 = 1337, fps: u32 = 30, interval: f64 = 1, width: usize = 160, height: usize = 50, ticks: usize = 0, theme: usize = 0, screen: usize = 0, format: []const u8 = "text" };
pub fn options(args: []const []const u8) !Options {
    var o = Options{};
    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const key = args[i];
        if (m.eq(key, "--sim")) {
            o.sim = true;
        } else if (m.eq(key, "--real")) {
            o.real = true;
        } else if (m.eq(key, "--snapshot")) {
            o.snapshot = true;
        } else if (m.eq(key, "--help") or m.eq(key, "-h")) {
            o.help = true;
        } else if (m.eq(key, "--version")) {
            o.version = true;
        } else {
            if (i + 1 >= args.len) return error.MissingOptionValue;
            i += 1;
            const value = args[i];
            if (m.eq(key, "--seed")) {
                o.seed = try std.fmt.parseInt(u32, value, 10);
            } else if (m.eq(key, "--fps")) {
                o.fps = try std.fmt.parseInt(u32, value, 10);
            } else if (m.eq(key, "--interval")) {
                o.interval = try std.fmt.parseFloat(f64, value);
            } else if (m.eq(key, "--width")) {
                o.width = try std.fmt.parseInt(usize, value, 10);
            } else if (m.eq(key, "--height")) {
                o.height = try std.fmt.parseInt(usize, value, 10);
            } else if (m.eq(key, "--ticks")) {
                o.ticks = try std.fmt.parseInt(usize, value, 10);
            } else if (m.eq(key, "--theme")) {
                o.theme = m.index(&m.themes, value) orelse return error.InvalidTheme;
            } else if (m.eq(key, "--screen")) {
                o.screen = m.index(&m.screens, value) orelse return error.InvalidScreen;
            } else if (m.eq(key, "--format")) {
                o.format = value;
            } else return error.UnknownOption;
        }
    }
    if (o.help or o.version) return o;
    if ((o.sim and o.real) or o.fps < 1 or o.fps > 120 or !std.math.isFinite(o.interval) or o.interval < 0.05 or o.interval > 60 or o.width < 1 or o.width > 500 or o.height < 1 or o.height > 200 or o.ticks > 10000 or m.index(&.{ "text", "ansi", "html" }, o.format) == null) return error.InvalidOptions;
    return o;
}
fn interact(app: *h.App, s: *m.State) void {
    if (s.overlay()) return;
    var buf: [64]u8 = undefined;
    for ([_]usize{ 0, 5 }) |base| {
        for (0..if (base == 0) @as(usize, 10) else 5) |i| {
            if (app.pressed(std.fmt.bufPrint(&buf, "tabs{d}:{d}", .{ base, i }) catch continue)) s.screen = base + i;
        }
    }
    for (0..m.themes.len) |i| {
        if (app.pressed(std.fmt.bufPrint(&buf, "theme:{d}", .{i}) catch continue)) s.theme = i;
    }
    if (app.pressed("check")) s.checked = !s.checked;
    if (app.pressed("toggle")) s.toggle = !s.toggle;
    if (app.pressed("select")) s.select_open = !s.select_open;
    if (app.pressed("palette")) s.palette = true;
    if (app.pressed("button:Primary")) s.modal = true;
    for (&s.panes, 0..) |*p, i| {
        const id = std.fmt.bufPrint(&buf, "pane:{d}", .{i}) catch continue;
        const delta = app.scrolled(id);
        if (delta != 0) {
            p.move(delta);
            s.focused[s.screen] = i % 8;
        }
        if (app.clickedRow(id)) |row| {
            p.selected = @min(p.offset + row, p.total -| 1);
            s.focused[s.screen] = i % 8;
        }
    }
}
const Worker = struct {
    state: m.State,
    io: std.Io,
    done: std.atomic.Value(bool) = .init(false),
    failed: bool = false,
    fn run(self: *Worker) void {
        collect.refresh(&self.state, self.io) catch {
            self.failed = true;
        };
        self.done.store(true, .release);
    }
};
fn now(io: std.Io) f64 {
    return @as(f64, @floatFromInt(std.Io.Timestamp.now(io, .awake).nanoseconds)) / 1e9;
}
pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.skip();
    var list: std.ArrayList([]const u8) = .empty;
    defer list.deinit(init.gpa);
    while (args.next()) |arg| try list.append(init.gpa, arg);
    const o = options(list.items) catch |err| {
        try std.Io.File.stderr().writeStreamingAll(init.io, try std.fmt.allocPrint(init.arena.allocator(), "{s}: invalid demo options. Use --help.\n", .{@errorName(err)}));
        std.process.exit(2);
    };
    const stdout = std.Io.File.stdout();
    if (o.help) {
        try stdout.writeStreamingAll(init.io, "hqtui-demo-zig — native read-only reference demo\n--sim | --real  --seed N  --fps 1–120  --interval 0.05–60\n--screen dashboard|traffic|sessions|network|services|components|graphics|themes|input|stress\n--theme dark|dracula|nord|tokyo-night|gruvbox|matrix|monochrome|high-contrast|light\n--snapshot --width 1–500 --height 1–200 --format text|ansi|html --ticks 0–10000\n--help --version\n");
        return;
    }
    if (o.version) {
        try stdout.writeStreamingAll(init.io, "0.2.0\n");
        return;
    }
    if (!o.snapshot and (!(try std.Io.File.stdin().isTty(init.io)) or !(try stdout.isTty(init.io)))) {
        try std.Io.File.stderr().writeStreamingAll(init.io, "An interactive terminal is required. Use --snapshot for headless output.\n");
        std.process.exit(2);
    }
    const real = o.real or (!o.sim and !o.snapshot);
    var state = try m.State.init(init.gpa, real, o.seed);
    defer state.deinit();
    state.screen = o.screen;
    state.theme = o.theme;
    if (real) {
        try collect.refresh(&state, init.io);
    } else {
        for (0..o.ticks) |_| try state.simulate();
    }
    if (o.snapshot) {
        var screen = try h.renderToScreen(init.gpa, o.width, o.height, m.themes[state.theme], h.Body.with(&state, view.render));
        defer screen.deinit();
        const output = if (m.eq(o.format, "ansi")) try screen.ansi() else if (m.eq(o.format, "html")) try h.testing.renderToHtml(screen.allocator(), screen, .{}) else try screen.text();
        try stdout.writeStreamingAll(init.io, output);
        try stdout.writeStreamingAll(init.io, "\n");
        return;
    }
    var worker = Worker{ .state = try m.State.init(init.gpa, true, o.seed), .io = init.io };
    defer worker.state.deinit();
    var thread: ?std.Thread = null;
    defer if (thread) |t| t.join();
    var app = try h.App.init(init.gpa, .{ .terminal = .{ .env = .fromEnviron(&init.minimal.environ) }, .theme = m.themes[state.theme], .fps = o.fps, .quit_keys = &.{}, .focus_navigation = false });
    defer app.deinit();
    var next: f64 = 0;
    var last_frame = now(init.io);
    while (app.running()) {
        for (try app.poll()) |event| switch (event) {
            .key => |key| {
                if (try state.key(key.key, key.char orelse "")) app.quit();
            },
            .mouse => |mouse| {
                var b: [80]u8 = undefined;
                state.last_mouse.clear();
                state.last_mouse.append(std.fmt.bufPrint(&b, "{s} {d},{d} wheel={d}", .{ @tagName(mouse.action), mouse.x, mouse.y, mouse.scroll }) catch "");
            },
            .paste => |paste| {
                if (state.editing) {
                    state.input.append(paste);
                } else if (state.filtering) {
                    state.filter.append(paste);
                } else if (state.palette) {
                    state.query.append(paste);
                }
            },
            else => {},
        };
        if (!app.running()) break;
        interact(&app, &state);
        if (thread != null and worker.done.load(.acquire)) {
            thread.?.join();
            thread = null;
            if (!worker.failed and !state.paused) {
                std.mem.swap(std.json.Parsed(m.Value), &state.parsed, &worker.state.parsed);
                state.missing = worker.state.missing;
            }
        }
        if (!state.paused and thread == null and now(init.io) >= next) {
            if (real) {
                worker.done.store(false, .release);
                worker.failed = false;
                thread = try std.Thread.spawn(.{}, Worker.run, .{&worker});
                next = now(init.io) + o.interval;
            } else {
                try state.simulate();
                next = now(init.io) + 0.1;
            }
        }
        if (!m.eq(app.theme.name, m.themes[state.theme])) app.setTheme(m.themes[state.theme]);
        if (app.collapseBorders() != state.collapse) app.setCollapseBorders(state.collapse);
        const current = now(init.io);
        state.fps = 1 / @max(0.001, current - last_frame);
        last_frame = current;
        const seconds: u64 = @intCast(@divTrunc(std.Io.Timestamp.now(init.io, .real).nanoseconds, 1_000_000_000));
        _ = try std.fmt.bufPrint(&state.clock, "{d:0>2}:{d:0>2}:{d:0>2}", .{ seconds / 3600 % 24, seconds / 60 % 60, seconds % 60 });
        const stats = try app.draw(h.Body.with(&state, view.render));
        state.render_ms = @as(f64, @floatFromInt(stats.render_ns)) / 1e6;
        state.changed_cells = stats.changed_cells;
        state.output_bytes = stats.bytes;
    }
    app.restore();
}
