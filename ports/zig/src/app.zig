//! The application: owns the terminal, both framebuffers, the frame arena and
//! the event loop.
//!
//! The reference implementation runs the loop for you and calls back into a
//! render function. This port turns that inside out, because a callback that
//! mutates the app's state is exactly the shape Zig has no closures for:
//!
//! ```zig
//! var app = try App.init(allocator, .{});
//! defer app.deinit();
//!
//! var state: State = .{ .count = 0 };
//! while (app.running()) {
//!     for (try app.poll()) |event| switch (event) {
//!         .key => |k| {
//!             if (std.mem.eql(u8, k.name, "up")) state.count += 1;
//!         },
//!         else => {},
//!     };
//!     _ = try app.draw(Body.with(&state, State.view));
//! }
//! ```
//!
//! Your state stays yours: no reference counting, no callbacks into the app, no
//! lifetime puzzles. The loop is a few lines, and it is visible.
//!
//! # Frame memory
//!
//! Two arenas, and knowing which is which is the whole memory model:
//!
//! * The **frame arena** is reset at the top of `draw`. Everything the builder
//!   allocates lives there, along with the hit regions and focus ids the frame
//!   produced. Those stay readable until the *next* `draw` — which is what lets
//!   `poll` dispatch a click against the layout that is on screen.
//! * The **event arena** is reset at the top of `poll` and holds the ids
//!   `interactions` reports, so `app.pressed("save")` is still valid after the
//!   frame that drew the button has been torn down.

const std = @import("std");

const ansi = @import("ansi.zig");
const buffer_mod = @import("buffer.zig");
const capabilities_mod = @import("capabilities.zig");
const color_mod = @import("color.zig");
const diff = @import("diff.zig");
const input_mod = @import("input.zig");
const surface_mod = @import("surface.zig");
const terminal_mod = @import("terminal.zig");
const theme_mod = @import("theme.zig");
const ui = @import("ui.zig");

const Capabilities = capabilities_mod.Capabilities;
const Color = color_mod.Color;
const FrameBuffer = buffer_mod.FrameBuffer;
const HitRegion = ui.HitRegion;
const InputEvent = input_mod.InputEvent;
const Interaction = ui.Interaction;
const MouseEvent = input_mod.MouseEvent;
const Surface = surface_mod.Surface;
const Terminal = terminal_mod.Terminal;
const Theme = theme_mod.Theme;

pub const Options = struct {
    terminal: terminal_mod.Options = .{},
    /// Built-in theme name. Defaults to the dark theme.
    theme: []const u8 = "dark",
    /// Cap on frames per second when nothing is happening.
    fps: u32 = 30,
    /// Frame cap when an SSH session is detected.
    remote_fps: u32 = 15,
    /// Keys that quit. Pass an empty list to handle quitting yourself.
    quit_keys: []const []const u8 = &.{ "ctrl+c", "q" },
    /// Tab/Shift+Tab move focus.
    focus_navigation: bool = true,
    /// Paint the theme background across the whole screen.
    paint_background: bool = true,
    /// Drain color, for accessibility or `NO_COLOR`.
    monochrome: ?bool = null,
};

pub const FrameStats = struct {
    frame: u64 = 0,
    /// Nanoseconds spent building, diffing and writing.
    render_ns: u64 = 0,
    changed_cells: usize = 0,
    dirty_rows: usize = 0,
    bytes: usize = 0,
};

pub const App = struct {
    allocator: std.mem.Allocator,
    terminal: Terminal,
    capabilities: Capabilities,
    theme: Theme,
    options: Options,

    current: FrameBuffer,
    previous: FrameBuffer,
    encoder: diff.Encoder,

    frame_arena: std.heap.ArenaAllocator,
    event_arena: std.heap.ArenaAllocator,

    alive: bool = true,
    force_repaint: bool = true,
    started_at_ns: u64,
    frame_count: u64 = 0,
    last_stats: FrameStats = .{},

    focus_index: usize = 0,
    focus_ids: []const []const u8 = &.{},
    hits: []const HitRegion = &.{},
    interactions: std.ArrayList(Interaction) = .empty,

    pub fn init(allocator: std.mem.Allocator, options: Options) !App {
        var term = Terminal.init(allocator, options.terminal);
        errdefer term.deinit();

        const size = term.size();
        var current = try FrameBuffer.init(allocator, size.columns, size.rows);
        errdefer current.deinit();
        var previous = try FrameBuffer.init(allocator, size.columns, size.rows);
        errdefer previous.deinit();

        const caps = term.capabilities;
        const encoder = diff.Encoder.init(allocator, .{
            .colors = caps.colors,
            .monochrome = options.monochrome orelse (caps.colors == .none),
        });

        try term.enter();

        return .{
            .allocator = allocator,
            .terminal = term,
            .capabilities = caps,
            .theme = theme_mod.resolve(options.theme),
            .options = options,
            .current = current,
            .previous = previous,
            .encoder = encoder,
            .frame_arena = .init(allocator),
            .event_arena = .init(allocator),
            .started_at_ns = monotonicNs(),
        };
    }

    pub fn deinit(self: *App) void {
        self.terminal.deinit();
        self.encoder.deinit();
        self.current.deinit();
        self.previous.deinit();
        self.interactions.deinit(self.allocator);
        self.frame_arena.deinit();
        self.event_arena.deinit();
        self.* = undefined;
    }

    pub fn width(self: App) usize {
        return self.current.width;
    }

    pub fn height(self: App) usize {
        return self.current.height;
    }

    pub fn stats(self: App) FrameStats {
        return self.last_stats;
    }

    pub fn running(self: App) bool {
        return self.alive;
    }

    /// Stop the loop. The terminal is restored by `deinit`, or immediately if
    /// you call `restore`.
    pub fn quit(self: *App) void {
        self.alive = false;
    }

    pub fn restore(self: *App) void {
        self.terminal.restore();
    }

    /// Force a full repaint, e.g. after another process wrote to the terminal.
    pub fn redraw(self: *App) void {
        self.force_repaint = true;
    }

    pub fn setTheme(self: *App, name: []const u8) void {
        self.theme = theme_mod.resolve(name);
        self.force_repaint = true;
    }

    fn targetFps(self: App) u32 {
        return if (self.capabilities.ssh)
            @min(self.options.fps, self.options.remote_fps)
        else
            self.options.fps;
    }

    /// Everything that happened since the last call, after the app has taken
    /// its own turn: quit keys, focus navigation and mouse dispatch.
    ///
    /// Waits at most one frame interval, which is what paces an idle loop. It
    /// returns as soon as input arrives, so a keystroke is never held for the
    /// rest of the interval — an app under a stream of input therefore redraws
    /// as fast as the input comes, and the cap only governs the idle case.
    pub fn poll(self: *App) ![]const InputEvent {
        _ = self.event_arena.reset(.retain_capacity);
        self.interactions.clearRetainingCapacity();

        const interval_ms = @max(8, 1000 / @max(1, self.targetFps()));

        if (self.terminal.terminationSignal() != null) self.alive = false;
        if (self.terminal.takeResize()) {
            const size = self.terminal.size();
            try self.current.resize(size.columns, size.rows);
            try self.previous.resize(size.columns, size.rows);
            self.force_repaint = true;
        }

        const events = try self.terminal.pollInput(interval_ms);
        for (events) |event| switch (event) {
            .key => |key| {
                for (self.options.quit_keys) |binding| {
                    if (input_mod.matchKey(key, binding)) self.alive = false;
                }
                if (!self.options.focus_navigation) continue;
                if (std.mem.eql(u8, key.name, "tab")) {
                    self.focusNext(if (key.shift) -1 else 1);
                } else if (std.mem.eql(u8, key.name, "enter") or
                    std.mem.eql(u8, key.name, "space"))
                {
                    if (self.focus_index < self.focus_ids.len) {
                        const id = self.focus_ids[self.focus_index];
                        try self.record(.{ .activated = .{ .id = try self.keepId(id) } });
                    }
                }
            },
            .mouse => |mouse| try self.dispatchMouse(mouse),
            else => {},
        };
        return events;
    }

    /// Copy an id into the event arena, so it survives the frame that drew it.
    fn keepId(self: *App, id: []const u8) ![]const u8 {
        return self.event_arena.allocator().dupe(u8, id);
    }

    fn record(self: *App, interaction: Interaction) !void {
        try self.interactions.append(self.allocator, interaction);
    }

    /// Move keyboard focus. Wraps around.
    pub fn focusNext(self: *App, delta: i64) void {
        const count: i64 = @intCast(self.focus_ids.len);
        if (count == 0) return;
        const at: i64 = @intCast(self.focus_index);
        self.focus_index = @intCast(@mod(@mod(at + delta, count) + count, count));
    }

    /// The id of the focused control, if the last frame registered any.
    pub fn focused(self: App) ?[]const u8 {
        if (self.focus_index >= self.focus_ids.len) return null;
        return self.focus_ids[self.focus_index];
    }

    fn dispatchMouse(self: *App, event: MouseEvent) !void {
        // Later regions are drawn on top, so hit-test in reverse.
        var i = self.hits.len;
        while (i > 0) {
            i -= 1;
            const hit = self.hits[i];
            if (!hit.rect.contains(@intCast(event.x), @intCast(event.y))) continue;
            const x = event.x - @as(usize, @intCast(hit.rect.x));
            const y = event.y - @as(usize, @intCast(hit.rect.y));
            const id = try self.keepId(hit.id);
            switch (event.action) {
                .scroll => try self.record(.{
                    .scrolled = .{ .id = id, .delta = event.scroll },
                }),
                .press => try self.record(.{ .clicked = .{ .id = id, .x = x, .y = y } }),
                .move => try self.record(.{ .hovered = .{ .id = id, .x = x, .y = y } }),
                else => {},
            }
            return;
        }
    }

    /// Was this control clicked, or activated from the keyboard?
    pub fn pressed(self: App, id: []const u8) bool {
        for (self.interactions.items) |i| switch (i) {
            .clicked, .activated => if (std.mem.eql(u8, i.id(), id)) return true,
            else => {},
        };
        return false;
    }

    /// Wheel movement over this control: -1 up, 1 down, summed.
    pub fn scrolled(self: App, id: []const u8) i32 {
        var total: i32 = 0;
        for (self.interactions.items) |i| switch (i) {
            .scrolled => |s| if (std.mem.eql(u8, s.id, id)) {
                total += s.delta;
            },
            else => {},
        };
        return total;
    }

    /// Which row of a scrollable widget was clicked, counted from its first body
    /// row so a table's header does not shift every index by one.
    pub fn clickedRow(self: App, id: []const u8) ?usize {
        var header: usize = 0;
        for (self.hits) |h| {
            if (std.mem.eql(u8, h.id, id)) {
                header = h.header_rows;
                break;
            }
        }
        for (self.interactions.items) |i| switch (i) {
            .clicked => |c| if (std.mem.eql(u8, c.id, id) and c.y >= header) {
                return c.y - header;
            },
            else => {},
        };
        return null;
    }

    /// Build one frame and push the difference to the terminal.
    pub fn draw(self: *App, view: ui.Body) !FrameStats {
        const started = monotonicNs();

        // Resetting here, not at the end of the previous frame, is what keeps
        // the hit regions and focus ids readable during `poll`.
        _ = self.frame_arena.reset(.retain_capacity);
        const frame_allocator = self.frame_arena.allocator();

        const size = self.terminal.size();
        if (size.columns != self.width() or size.rows != self.height()) {
            try self.current.resize(size.columns, size.rows);
            try self.previous.resize(size.columns, size.rows);
            self.force_repaint = true;
        }

        self.current.clear(
            if (self.options.paint_background) self.theme.background else Color.default,
            self.theme.foreground,
        );

        var ctx = ui.Ctx.init(
            frame_allocator,
            &self.theme,
            &self.capabilities,
            self.width(),
            self.height(),
        );
        ctx.frame = self.frame_count;
        ctx.elapsed = (monotonicNs() - self.started_at_ns) / std.time.ns_per_ms;
        ctx.focus_index = self.focus_index;

        const root = Surface.root(&self.current, &self.theme);
        var container = ui.Container.init(root, &ctx, .column, .{});
        if (view.call) |f| try f(view.ctx, &container);
        try container.flush();
        for (ctx.overlays.items) |overlay| try overlay.draw(frame_allocator, root);

        self.hits = ctx.hits.items;
        self.focus_ids = ctx.focus_ids.items;
        if (self.focus_ids.len > 0 and self.focus_index >= self.focus_ids.len) {
            self.focus_index = 0;
        }

        const result = try self.encoder.encode(&self.previous, &self.current, self.force_repaint);
        self.force_repaint = false;

        var bytes: usize = result.output.len;
        if (result.output.len > 0) {
            if (self.capabilities.synchronized_output) {
                // Wrapped rather than concatenated: the frame is already the
                // largest allocation of the loop, and copying it again to add
                // eight bytes at each end would double that for nothing.
                self.terminal.write(ansi.begin_sync);
                self.terminal.write(result.output);
                self.terminal.write(ansi.end_sync);
                bytes += ansi.begin_sync.len + ansi.end_sync.len;
            } else {
                self.terminal.write(result.output);
            }
        }
        self.previous.copyFrom(&self.current);

        const measured: FrameStats = .{
            .frame = self.frame_count,
            .render_ns = monotonicNs() - started,
            .changed_cells = result.changed_cells,
            .dirty_rows = result.dirty_rows,
            .bytes = bytes,
        };
        self.frame_count += 1;
        self.last_stats = measured;
        return measured;
    }

    /// Run a whole app: poll, then draw, until something calls `quit`.
    ///
    /// The view is called afresh every frame from the same context pointer, so
    /// this suits an app whose state lives in one struct. Anything else wants
    /// the explicit `poll`/`draw` loop, which is three lines.
    pub fn run(self: *App, view: ui.Body) !void {
        while (self.running()) {
            _ = try self.poll();
            _ = try self.draw(view);
        }
        self.restore();
    }
};

/// Monotonic nanoseconds. Zig 0.16 moved the clock behind an `Io` handle, and
/// threading one through every frame for a timestamp is not worth it, so the
/// syscall is made directly — the two systems spell it identically apart from
/// the return type.
fn monotonicNs() u64 {
    var ts: std.posix.timespec = undefined;
    if (std.posix.system.clock_gettime(.MONOTONIC, &ts) != 0) return 0;
    const sec: u64 = @intCast(@max(0, ts.sec));
    const nsec: u64 = @intCast(@max(0, ts.nsec));
    return sec * std.time.ns_per_s + nsec;
}

test "monotonic clock advances" {
    const first = monotonicNs();
    try std.testing.expect(first > 0);
    try std.testing.expect(monotonicNs() >= first);
}
