//! Owns the TTY: raw mode, alternate screen, mouse reporting, and — above all —
//! putting everything back. A crashed app must never leave an unusable shell.
//!
//! # How this talks to the operating system
//!
//! Zig's standard library carries the POSIX layer this needs, so unlike the Rust
//! port — which shells out to `stty -g` rather than hand-declare a `termios`
//! that differs per platform — everything here is a direct call:
//!
//! * **Raw mode** is `std.posix.tcgetattr` / `tcsetattr`. The flags are named
//!   booleans on a packed struct that std defines per architecture, so there is
//!   no bit layout to get wrong. The original `termios` is kept verbatim and
//!   handed straight back, which makes restoring exact rather than reconstructed.
//!
//! * **Input is polled, not threaded.** `std.posix.poll` waits on stdin with a
//!   timeout, so the render loop asks for input and gets an answer within a
//!   bounded time without a reader thread, a channel, or any synchronization at
//!   all. The other three ports each needed one of those; this port needs none,
//!   and the escape-key timeout falls out of the same call.
//!
//! * **Window size** is one `TIOCGWINSZ` ioctl, and **signals** go through
//!   `std.posix.sigaction`. The handler only stores to an atomic, which is
//!   async-signal-safe.
//!
//! Windows is not supported by this module yet. Everything above it — the
//! framebuffer, the widgets, the encoder, the headless renderer — is pure
//! computation and runs anywhere.

const std = @import("std");
const builtin = @import("builtin");

const ansi = @import("ansi.zig");
const capabilities_mod = @import("capabilities.zig");
const input_mod = @import("input.zig");

const Capabilities = capabilities_mod.Capabilities;
const InputEvent = input_mod.InputEvent;
const InputParser = input_mod.InputParser;

const posix = std.posix;
const is_posix = builtin.os.tag != .windows;

pub const TerminalSize = struct {
    columns: usize,
    rows: usize,
};

pub const Options = struct {
    /// Use the alternate screen so the user's scrollback survives.
    alternate_screen: bool = true,
    mouse: ?bool = null,
    hide_cursor: bool = true,
    bracketed_paste: ?bool = null,
    focus_events: ?bool = null,
    title: ?[]const u8 = null,
    capabilities: capabilities_mod.Overrides = .{},
    /// The process environment, for capability detection. Zig 0.16 hands this
    /// to `main` rather than exposing a global, so it has to be passed in;
    /// leaving it empty means detection sees nothing and falls back to the
    /// conservative defaults.
    env: capabilities_mod.Env = capabilities_mod.Env.empty,
    /// Restore the terminal on SIGTERM/SIGHUP. Default true.
    install_exit_handlers: bool = true,
    /// How long to wait before a lone ESC counts as the Escape key.
    escape_timeout_ms: u64 = 30,
};

// --------------------------------------------------------------- OS plumbing

var resized = std.atomic.Value(bool).init(false);
/// The signal that asked us to quit, or 0. Set from a handler, so it may only
/// ever be a plain atomic store.
var terminated = std.atomic.Value(u32).init(0);
var handlers_installed = std.atomic.Value(bool).init(false);

/// The `termios` captured when raw mode was entered, so it can be handed back
/// byte for byte. Global because the exit path has no `self` to reach for.
var saved_mode: ?posix.termios = null;
var raw_active = std.atomic.Value(bool).init(false);

fn onWinch(_: posix.SIG) callconv(.c) void {
    resized.store(true, .monotonic);
}

fn onTerminate(sig: posix.SIG) callconv(.c) void {
    terminated.store(@intFromEnum(sig), .monotonic);
}

/// Ask the kernel for the window size. Null when stdout is not a terminal.
fn windowSize() ?TerminalSize {
    if (!is_posix) return null;
    var ws: posix.winsize = undefined;
    const request = posix.T.IOCGWINSZ;
    // `std.posix.system` is `std.os.linux` on bare Linux and `std.c` elsewhere,
    // and the two spell `ioctl` differently — one takes the argument as a
    // `usize`, the other is variadic.
    const failed = if (comptime builtin.os.tag == .linux and !builtin.link_libc)
        posix.errno(std.os.linux.ioctl(1, request, @intFromPtr(&ws))) != .SUCCESS
    else
        std.c.ioctl(1, @intCast(request), &ws) != 0;
    if (failed or ws.col == 0 or ws.row == 0) return null;
    return .{ .columns = ws.col, .rows = ws.row };
}

fn enterRawMode() bool {
    if (!is_posix) return false;
    const original = posix.tcgetattr(0) catch return false;
    saved_mode = original;

    var raw = original;
    raw.iflag.BRKINT = false;
    raw.iflag.ICRNL = false;
    raw.iflag.INPCK = false;
    raw.iflag.ISTRIP = false;
    raw.iflag.IXON = false;
    raw.oflag.OPOST = false;
    raw.lflag.ECHO = false;
    raw.lflag.ICANON = false;
    raw.lflag.IEXTEN = false;
    // `ISIG` off matters: Ctrl+C has to arrive as a keystroke, because quitting
    // is the application's decision and the quit keys are configurable.
    raw.lflag.ISIG = false;
    raw.cflag.CSIZE = .CS8;
    raw.cc[@intFromEnum(posix.V.MIN)] = 1;
    raw.cc[@intFromEnum(posix.V.TIME)] = 0;

    posix.tcsetattr(0, .FLUSH, raw) catch return false;
    raw_active.store(true, .monotonic);
    return true;
}

fn leaveRawMode() void {
    if (!is_posix) return;
    if (!raw_active.swap(false, .monotonic)) return;
    if (saved_mode) |mode| {
        posix.tcsetattr(0, .FLUSH, mode) catch {};
        saved_mode = null;
    }
}

/// Restoring is not negotiable — a crash must not leave an unusable shell — but
/// deciding the process should die is the host's call, not a rendering
/// library's. So the handlers here only record the signal; the app loop notices
/// and exits on its own terms.
fn installExitHandlers() void {
    if (!is_posix) return;
    if (handlers_installed.swap(true, .monotonic)) return;

    var winch: posix.Sigaction = .{
        .handler = .{ .handler = onWinch },
        .mask = std.mem.zeroes(posix.sigset_t),
        .flags = 0,
    };
    posix.sigaction(.WINCH, &winch, null);

    var quit: posix.Sigaction = .{
        .handler = .{ .handler = onTerminate },
        .mask = std.mem.zeroes(posix.sigset_t),
        .flags = 0,
    };
    posix.sigaction(.TERM, &quit, null);
    posix.sigaction(.HUP, &quit, null);
    // SIGINT is delivered only if raw mode failed; with ISIG cleared, Ctrl+C
    // arrives as a keystroke instead.
    posix.sigaction(.INT, &quit, null);
}

/// Zig 0.16 moved buffered file writing behind an `Io` handle, which a terminal
/// restore path cannot always reach for — `emergencyRestore` has no allocator
/// and no context. The raw syscall is what both need, and this module is
/// already at that level for `poll`, `ioctl` and `termios`.
fn writeOut(data: []const u8) void {
    var at: usize = 0;
    while (at < data.len) {
        const rc = posix.system.write(1, data[at..].ptr, data.len - at);
        const written: isize = @bitCast(@as(usize, @bitCast(rc)));
        if (written <= 0) return;
        at += @intCast(written);
    }
}

/// True when stdout is a terminal. `isatty` is gone from `std.posix` in 0.16,
/// and asking for the terminal attributes is what it did anyway.
fn isTty() bool {
    if (!is_posix) return false;
    _ = posix.tcgetattr(1) catch return false;
    return true;
}

/// Restores the terminal for a process that lost its `Terminal`. Safe to call
/// twice, and safe to call from a crash path.
pub fn emergencyRestore() void {
    writeOut(ansi.reset ++ ansi.focus_off ++ ansi.bracketed_paste_off ++
        ansi.mouse_off ++ ansi.cursor_show ++ ansi.alternate_screen_off);
    leaveRawMode();
}

// ------------------------------------------------------------------ terminal

pub const Terminal = struct {
    allocator: std.mem.Allocator,
    capabilities: Capabilities,
    options: Options,
    parser: InputParser,
    entered: bool = false,
    raw_was_set: bool = false,
    /// Bytes that ended mid-character, held until the rest of them arrive.
    partial: std.ArrayList(u8) = .empty,
    /// Decoded text handed to the parser, kept so its slices stay alive.
    decoded: std.ArrayList(u8) = .empty,
    /// Milliseconds spent waiting since the last byte arrived, for the ESC
    /// timeout. Accumulated from the poll budget rather than read off a clock:
    /// `poll` returning zero means the whole timeout elapsed, which is the only
    /// fact the 30 ms Escape rule needs, and it costs no syscall.
    waited_ms: u64 = 0,

    pub fn init(allocator: std.mem.Allocator, options: Options) Terminal {
        return .{
            .allocator = allocator,
            .capabilities = capabilities_mod.detect(
                options.capabilities,
                options.env,
                isTty(),
            ),
            .options = options,
            .parser = InputParser.init(allocator),
        };
    }

    pub fn deinit(self: *Terminal) void {
        self.restore();
        self.parser.deinit();
        self.partial.deinit(self.allocator);
        self.decoded.deinit(self.allocator);
        self.* = undefined;
    }

    /// The current window size, falling back the way the reference does: the
    /// kernel, then `COLUMNS`/`LINES`, then 80x24. Anything that is not a
    /// positive number means "ask somewhere else" — some ptys report zero,
    /// which would otherwise leave a 0x0 framebuffer that renders nothing.
    pub fn size(self: Terminal) TerminalSize {
        if (windowSize()) |s| return s;
        return .{
            .columns = envSize(self.options.env, "COLUMNS") orelse 80,
            .rows = envSize(self.options.env, "LINES") orelse 24,
        };
    }

    /// True when a SIGWINCH has arrived since this was last called.
    pub fn takeResize(self: Terminal) bool {
        _ = self;
        return resized.swap(false, .monotonic);
    }

    /// The signal that asked the process to quit, if one has arrived.
    pub fn terminationSignal(self: Terminal) ?u32 {
        _ = self;
        const sig = terminated.load(.monotonic);
        return if (sig == 0) null else sig;
    }

    pub fn write(self: Terminal, data: []const u8) void {
        _ = self;
        writeOut(data);
    }

    /// Enter full-screen mode. Idempotent.
    pub fn enter(self: *Terminal) !void {
        if (self.entered) return;
        self.entered = true;

        const mouse = self.options.mouse orelse self.capabilities.mouse;
        const paste = self.options.bracketed_paste orelse self.capabilities.bracketed_paste;
        const focus = self.options.focus_events orelse self.capabilities.focus_events;

        var setup: std.ArrayList(u8) = .empty;
        defer setup.deinit(self.allocator);

        if (self.options.alternate_screen) {
            try setup.appendSlice(self.allocator, ansi.alternate_screen_on);
        }
        if (self.options.hide_cursor) try setup.appendSlice(self.allocator, ansi.cursor_hide);
        if (mouse and self.capabilities.mouse) {
            try setup.appendSlice(self.allocator, ansi.mouse_on);
        }
        if (paste) try setup.appendSlice(self.allocator, ansi.bracketed_paste_on);
        if (focus) try setup.appendSlice(self.allocator, ansi.focus_on);
        if (self.options.title) |title| {
            const seq = try ansi.setTitle(self.allocator, title);
            defer self.allocator.free(seq);
            try setup.appendSlice(self.allocator, seq);
        }
        try setup.appendSlice(self.allocator, ansi.clear_screen);
        try setup.appendSlice(self.allocator, ansi.cursor_home);
        self.write(setup.items);

        if (self.capabilities.tty) self.raw_was_set = enterRawMode();
        if (self.options.install_exit_handlers) installExitHandlers();
    }

    /// Put the terminal back exactly as it was found. Safe to call twice.
    pub fn restore(self: *Terminal) void {
        if (!self.entered) return;
        self.entered = false;

        const mouse = self.options.mouse orelse self.capabilities.mouse;
        const paste = self.options.bracketed_paste orelse self.capabilities.bracketed_paste;
        const focus = self.options.focus_events orelse self.capabilities.focus_events;

        var teardown: std.ArrayList(u8) = .empty;
        defer teardown.deinit(self.allocator);

        // Every append here is best-effort: restoring the terminal must not be
        // skipped because a growth failed, so a short teardown still goes out.
        teardown.appendSlice(self.allocator, ansi.reset) catch {};
        if (focus) teardown.appendSlice(self.allocator, ansi.focus_off) catch {};
        if (paste) teardown.appendSlice(self.allocator, ansi.bracketed_paste_off) catch {};
        if (mouse) teardown.appendSlice(self.allocator, ansi.mouse_off) catch {};
        if (self.options.hide_cursor) {
            teardown.appendSlice(self.allocator, ansi.cursor_show) catch {};
        }
        teardown.appendSlice(
            self.allocator,
            if (self.options.alternate_screen) ansi.alternate_screen_off else "\n",
        ) catch {};
        self.write(teardown.items);

        if (self.raw_was_set) {
            leaveRawMode();
            self.raw_was_set = false;
        }
    }

    /// Every input event available within `timeout_ms`, decoded. Returns as soon
    /// as something arrives, so a keystroke is never delayed by the timeout.
    ///
    /// A lone ESC is only the Escape key once nothing follows it, so it is held
    /// back until `escape_timeout_ms` has passed with no further bytes.
    /// Returned slices stay valid until the next call.
    pub fn pollInput(self: *Terminal, timeout_ms: u64) ![]const InputEvent {
        if (!is_posix) return &.{};

        const budget = @min(timeout_ms, std.math.maxInt(i32));
        var fds = [_]posix.pollfd{.{ .fd = 0, .events = posix.POLL.IN, .revents = 0 }};
        const ready = posix.poll(&fds, @intCast(budget)) catch 0;

        if (ready == 0 or fds[0].revents & posix.POLL.IN == 0) {
            self.waited_ms += budget;
            if (self.parser.hasPending() and self.waited_ms >= self.options.escape_timeout_ms) {
                self.waited_ms = 0;
                return self.parser.flush();
            }
            return &.{};
        }

        var buf: [4096]u8 = undefined;
        const n = posix.read(0, &buf) catch 0;
        if (n == 0) return &.{};
        self.waited_ms = 0;

        try self.partial.appendSlice(self.allocator, buf[0..n]);

        // A read can end in the middle of a multi-byte character. Decode what
        // is whole and keep the tail for the next read, or the parser would see
        // a replacement character where a letter belongs.
        const valid = validUtf8Prefix(self.partial.items);
        self.decoded.clearRetainingCapacity();
        try self.decoded.appendSlice(self.allocator, self.partial.items[0..valid.len]);
        // An actually invalid sequence, rather than a truncated one, would
        // otherwise wedge the buffer for ever.
        const drop = valid.len + @as(usize, if (valid.invalid) 1 else 0);
        std.mem.copyForwards(u8, self.partial.items, self.partial.items[drop..]);
        self.partial.shrinkRetainingCapacity(self.partial.items.len - drop);

        return self.parser.parse(self.decoded.items);
    }
};

const Prefix = struct { len: usize, invalid: bool };

/// How much of `bytes` is complete UTF-8, and whether what follows is a truly
/// malformed byte rather than a sequence still in flight.
fn validUtf8Prefix(bytes: []const u8) Prefix {
    var at: usize = 0;
    while (at < bytes.len) {
        const len = std.unicode.utf8ByteSequenceLength(bytes[at]) catch {
            return .{ .len = at, .invalid = true };
        };
        if (at + len > bytes.len) return .{ .len = at, .invalid = false };
        _ = std.unicode.utf8Decode(bytes[at..][0..len]) catch {
            return .{ .len = at, .invalid = true };
        };
        at += len;
    }
    return .{ .len = at, .invalid = false };
}

fn envSize(env: capabilities_mod.Env, name: []const u8) ?usize {
    const raw = env.get(name);
    if (raw.len == 0) return null;
    const value = std.fmt.parseUnsigned(usize, std.mem.trim(u8, raw, " \t\r\n"), 10) catch
        return null;
    return if (value > 0) value else null;
}

test "validUtf8Prefix holds back a split character" {
    // "é" is two bytes; a read that ends between them must decode nothing yet.
    const split = "a\xc3";
    const prefix = validUtf8Prefix(split);
    try std.testing.expectEqual(@as(usize, 1), prefix.len);
    try std.testing.expect(!prefix.invalid);

    const whole = validUtf8Prefix("aé");
    try std.testing.expectEqual(@as(usize, 3), whole.len);

    // A continuation byte with no lead byte can never complete.
    const broken = validUtf8Prefix("\x80");
    try std.testing.expectEqual(@as(usize, 0), broken.len);
    try std.testing.expect(broken.invalid);
}
