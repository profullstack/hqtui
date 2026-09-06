//! Decodes raw terminal bytes into normalized events. Applications should never
//! see an escape sequence — only `"ctrl+c"`, `"up"`, or a printable character.
//!
//! `InputParser.parse` takes bytes because a sequence can be split across reads
//! and the parser has to hold the remainder. Splitting a *multi-byte character*
//! across reads is the terminal's problem, not the parser's: `Terminal` buffers
//! partial UTF-8 before it gets here.

const std = @import("std");

const unicode = @import("unicode.zig");

pub const MouseAction = enum {
    press,
    release,
    move,
    drag,
    scroll,

    pub fn toString(self: MouseAction) []const u8 {
        return @tagName(self);
    }
};

pub const MouseButton = enum {
    left,
    middle,
    right,
    none,

    pub fn toString(self: MouseButton) []const u8 {
        return @tagName(self);
    }
};

pub const KeyEvent = struct {
    /// Normalized: `"a"`, `"up"`, `"enter"`, `"f5"`, `"escape"`, `"space"`.
    name: []const u8,
    /// Full form including modifiers, e.g. `"ctrl+c"` — what you match on.
    key: []const u8,
    ctrl: bool = false,
    alt: bool = false,
    shift: bool = false,
    /// The printable character, when there is one.
    char: ?[]const u8 = null,
    raw: []const u8 = "",
};

pub const MouseEvent = struct {
    action: MouseAction,
    button: MouseButton,
    /// Zero-based cell coordinates.
    x: usize,
    y: usize,
    /// -1 up, 1 down; 0 when this is not a scroll.
    scroll: i32 = 0,
    ctrl: bool = false,
    alt: bool = false,
    shift: bool = false,
};

pub const InputEvent = union(enum) {
    key: KeyEvent,
    mouse: MouseEvent,
    paste: []const u8,
    focus: bool,
};

/// The escape sequences that map to a named key, without their leading ESC.
const Special = struct { seq: []const u8, name: []const u8 };

const specials = [_]Special{
    // Longest first, so `[1~` never loses to a shorter prefix. The reference
    // sorts at runtime; a static table can just be written in order.
    .{ .seq = "[11~", .name = "f1" },  .{ .seq = "[12~", .name = "f2" },
    .{ .seq = "[13~", .name = "f3" },  .{ .seq = "[14~", .name = "f4" },
    .{ .seq = "[15~", .name = "f5" },  .{ .seq = "[17~", .name = "f6" },
    .{ .seq = "[18~", .name = "f7" },  .{ .seq = "[19~", .name = "f8" },
    .{ .seq = "[20~", .name = "f9" },  .{ .seq = "[21~", .name = "f10" },
    .{ .seq = "[23~", .name = "f11" }, .{ .seq = "[24~", .name = "f12" },
    .{ .seq = "[1~", .name = "home" }, .{ .seq = "[2~", .name = "insert" },
    .{ .seq = "[3~", .name = "delete" }, .{ .seq = "[4~", .name = "end" },
    .{ .seq = "[5~", .name = "pageup" }, .{ .seq = "[6~", .name = "pagedown" },
    .{ .seq = "[7~", .name = "home" }, .{ .seq = "[8~", .name = "end" },
    .{ .seq = "[A", .name = "up" },    .{ .seq = "[B", .name = "down" },
    .{ .seq = "[C", .name = "right" }, .{ .seq = "[D", .name = "left" },
    .{ .seq = "[H", .name = "home" },  .{ .seq = "[F", .name = "end" },
    .{ .seq = "[Z", .name = "shift+tab" },
    .{ .seq = "OA", .name = "up" },    .{ .seq = "OB", .name = "down" },
    .{ .seq = "OC", .name = "right" }, .{ .seq = "OD", .name = "left" },
    .{ .seq = "OH", .name = "home" },  .{ .seq = "OF", .name = "end" },
    .{ .seq = "OP", .name = "f1" },    .{ .seq = "OQ", .name = "f2" },
    .{ .seq = "OR", .name = "f3" },    .{ .seq = "OS", .name = "f4" },
};

fn specialByName(seq: []const u8) ?[]const u8 {
    for (specials) |s| {
        if (std.mem.eql(u8, s.seq, seq)) return s.name;
    }
    return null;
}

const Modifiers = struct { shift: bool = false, alt: bool = false, ctrl: bool = false };

/// xterm modifier parameter: 1 + bitfield(shift=1, alt=2, ctrl=4).
fn decodeModifiers(param: u32) Modifiers {
    const bits = param -| 1;
    return .{ .shift = bits & 1 != 0, .alt = bits & 2 != 0, .ctrl = bits & 4 != 0 };
}

const paste_start = "\x1b[200~";
const paste_end = "\x1b[201~";

/// Length of the longest suffix of `text` that is a proper prefix of `marker`.
fn partialSuffix(text: []const u8, marker: []const u8) usize {
    var n = @min(text.len, marker.len - 1);
    while (n > 0) : (n -= 1) {
        if (std.mem.endsWith(u8, text, marker[0..n])) return n;
    }
    return 0;
}

/// Feed it chunks, get events.
///
/// Stateful, so a sequence split across two reads — routine over SSH — still
/// decodes correctly. Event text is owned by the parser and stays valid until
/// the next `parse`, which is what keeps decoding allocation-free per keystroke.
pub const InputParser = struct {
    allocator: std.mem.Allocator,
    pending: std.ArrayList(u8) = .empty,
    paste_buffer: ?std.ArrayList(u8) = null,
    /// Bytes held back mid-paste because they could be the start of the end
    /// marker. Kept separate from `pending` so they do not look like an
    /// unterminated escape and trip the Escape-key timeout.
    paste_tail: std.ArrayList(u8) = .empty,
    /// Backing store for the current call's event text.
    scratch: std.ArrayList(u8) = .empty,
    events: std.ArrayList(InputEvent) = .empty,
    /// The bytes being parsed this call, so slices into it stay valid.
    data: std.ArrayList(u8) = .empty,

    pub fn init(allocator: std.mem.Allocator) InputParser {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *InputParser) void {
        self.pending.deinit(self.allocator);
        if (self.paste_buffer) |*b| b.deinit(self.allocator);
        self.paste_tail.deinit(self.allocator);
        self.scratch.deinit(self.allocator);
        self.events.deinit(self.allocator);
        self.data.deinit(self.allocator);
        self.* = undefined;
    }

    /// True when bytes are buffered awaiting the rest of a sequence.
    pub fn hasPending(self: InputParser) bool {
        return self.pending.items.len > 0;
    }

    /// Copy `text` into the scratch buffer and return the stored slice.
    fn keep(self: *InputParser, text: []const u8) ![]const u8 {
        const start = self.scratch.items.len;
        try self.scratch.appendSlice(self.allocator, text);
        return self.scratch.items[start..];
    }

    fn keyEvent(
        self: *InputParser,
        name: []const u8,
        mods: Modifiers,
        char: ?[]const u8,
        raw: []const u8,
    ) !InputEvent {
        var key_buf: [32]u8 = undefined;
        var len: usize = 0;
        const append = struct {
            fn f(buf: []u8, at: *usize, part: []const u8) void {
                if (at.* + part.len > buf.len) return;
                @memcpy(buf[at.*..][0..part.len], part);
                at.* += part.len;
            }
        }.f;

        if (mods.ctrl) append(&key_buf, &len, "ctrl+");
        if (mods.alt) append(&key_buf, &len, "alt+");
        // The reference tests `name.length`, which counts UTF-16 units. It only
        // matters for named keys, which are all ASCII, but matching it exactly
        // costs nothing.
        if (mods.shift and unicode.utf16Length(name) > 1) append(&key_buf, &len, "shift+");
        append(&key_buf, &len, name);

        return .{ .key = .{
            .name = try self.keep(name),
            .key = try self.keep(key_buf[0..len]),
            .ctrl = mods.ctrl,
            .alt = mods.alt,
            .shift = mods.shift,
            .char = if (char) |c| try self.keep(c) else null,
            .raw = try self.keep(raw),
        } };
    }

    /// Resolve buffered bytes that turned out to be complete after all.
    ///
    /// A lone ESC is ambiguous — it only becomes the Escape key once no more
    /// bytes follow — so the terminal calls this on a short timeout.
    pub fn flush(self: *InputParser) ![]const InputEvent {
        // `paste_tail` is deliberately left alone. Folding it into the paste
        // content here destroyed a partial end marker whenever the Escape
        // timeout fired between the two reads carrying it: the rest of the
        // marker then arrived alone, never matched, and the paste could never
        // end — the exact wedge this holdback exists to prevent.
        if (self.pending.items.len == 0) {
            self.events.clearRetainingCapacity();
            return self.events.items;
        }

        var held: std.ArrayList(u8) = .empty;
        defer held.deinit(self.allocator);
        try held.appendSlice(self.allocator, self.pending.items);
        self.pending.clearRetainingCapacity();

        if (std.mem.eql(u8, held.items, "\x1b")) {
            self.scratch.clearRetainingCapacity();
            self.events.clearRetainingCapacity();
            try self.events.append(self.allocator, try self.keyEvent("escape", .{}, null, "\x1b"));
            return self.events.items;
        }

        // An incomplete sequence that never completed: emit ESC and re-parse.
        const rest = try self.allocator.dupe(u8, held.items[1..]);
        defer self.allocator.free(rest);
        _ = try self.parse(rest);

        // `parse` reset the scratch, so the ESC has to be prepended afterwards.
        const escape = try self.keyEvent("escape", .{}, null, "\x1b");
        try self.events.insert(self.allocator, 0, escape);
        return self.events.items;
    }

    pub fn parse(self: *InputParser, chunk: []const u8) ![]const InputEvent {
        self.events.clearRetainingCapacity();
        self.scratch.clearRetainingCapacity();

        // The reference prepends the paste tail to `pending + chunk`; with only
        // one of the two ever set at a time, this order is the same bytes.
        self.data.clearRetainingCapacity();
        try self.data.appendSlice(self.allocator, self.paste_tail.items);
        try self.data.appendSlice(self.allocator, self.pending.items);
        try self.data.appendSlice(self.allocator, chunk);
        self.paste_tail.clearRetainingCapacity();
        self.pending.clearRetainingCapacity();

        var at: usize = 0;
        while (at < self.data.items.len) {
            const rest = self.data.items[at..];

            if (self.paste_buffer != null) {
                if (std.mem.indexOf(u8, rest, paste_end)) |end| {
                    try self.paste_buffer.?.appendSlice(self.allocator, rest[0..end]);
                    const text = try self.keep(self.paste_buffer.?.items);
                    try self.events.append(self.allocator, .{ .paste = text });
                    self.paste_buffer.?.deinit(self.allocator);
                    self.paste_buffer = null;
                    at += end + paste_end.len;
                    continue;
                }
                // The end marker can straddle two reads, which is routine over
                // SSH. Swallowing a partial one here used to lose it for good:
                // the paste never ended, and every later keystroke — Ctrl+C
                // included — went into the buffer instead of being dispatched.
                const keep_n = partialSuffix(rest, paste_end);
                const split = rest.len - keep_n;
                try self.paste_buffer.?.appendSlice(self.allocator, rest[0..split]);
                try self.paste_tail.appendSlice(self.allocator, rest[split..]);
                break;
            }

            if (rest[0] != 0x1b) {
                at += try self.parsePlain(rest);
                continue;
            }

            // Lone ESC at the end of a chunk: could be the start of a sequence.
            if (rest.len == 1) {
                try self.pending.appendSlice(self.allocator, rest);
                break;
            }

            const consumed = try self.parseEscape(rest);
            if (consumed < 0) {
                try self.pending.appendSlice(self.allocator, rest);
                break;
            }
            at += @intCast(consumed);
        }
        return self.events.items;
    }

    /// Returns the number of bytes consumed.
    fn parsePlain(self: *InputParser, data: []const u8) !usize {
        const len = std.unicode.utf8ByteSequenceLength(data[0]) catch 1;
        const size = @min(len, data.len);
        const ch = data[0..size];
        const cp = std.unicode.utf8Decode(ch) catch data[0];

        if (cp == 13 or cp == 10) {
            try self.events.append(self.allocator, try self.keyEvent("enter", .{}, null, ch));
        } else if (cp == 9) {
            try self.events.append(self.allocator, try self.keyEvent("tab", .{}, null, ch));
        } else if (cp == 127 or cp == 8) {
            try self.events.append(self.allocator, try self.keyEvent("backspace", .{}, null, ch));
        } else if (cp == 32) {
            try self.events.append(self.allocator, try self.keyEvent("space", .{}, " ", ch));
        } else if (cp < 32) {
            // Ctrl+letter arrives as the control code itself.
            const letter = [_]u8{@intCast(cp + 96)};
            try self.events.append(
                self.allocator,
                try self.keyEvent(&letter, .{ .ctrl = true }, null, ch),
            );
        } else {
            try self.events.append(self.allocator, try self.keyEvent(ch, .{}, ch, ch));
        }
        return size;
    }

    /// Returns -1 when the sequence is incomplete and more bytes are needed.
    fn parseEscape(self: *InputParser, data: []const u8) !isize {
        if (std.mem.startsWith(u8, data, paste_start)) {
            self.paste_buffer = .empty;
            return @intCast(paste_start.len);
        }
        if (std.mem.startsWith(u8, data, "\x1b[I")) {
            try self.events.append(self.allocator, .{ .focus = true });
            return 3;
        }
        if (std.mem.startsWith(u8, data, "\x1b[O")) {
            try self.events.append(self.allocator, .{ .focus = false });
            return 3;
        }

        // SGR mouse: ESC [ < b ; x ; y (M press | m release)
        if (parseSgrMouse(data)) |m| {
            try self.events.append(self.allocator, .{
                .mouse = decodeMouse(m.code, m.col, m.row, m.pressed),
            });
            return @intCast(m.len);
        }
        if (isPartialMouse(data)) return -1;

        // CSI with modifier parameters: ESC [ 1 ; 5 A  → ctrl+up
        if (parseModifiedCsi(data)) |m| {
            var seq = [_]u8{ '[', m.final };
            var base = specialByName(&seq);
            if (base == null) {
                seq[0] = 'O';
                base = specialByName(&seq);
            }
            if (base) |name| {
                try self.events.append(self.allocator, try self.keyEvent(
                    name,
                    decodeModifiers(m.param),
                    null,
                    data[0..m.len],
                ));
                return @intCast(m.len);
            }
        }
        if (parseModifiedTilde(data)) |m| {
            var seq_buf: [16]u8 = undefined;
            const seq = std.fmt.bufPrint(&seq_buf, "[{d}~", .{m.key}) catch "";
            if (specialByName(seq)) |name| {
                try self.events.append(self.allocator, try self.keyEvent(
                    name,
                    decodeModifiers(m.modifier),
                    null,
                    data[0..m.len],
                ));
                return @intCast(m.len);
            }
        }

        // Plain special keys, longest match first.
        for (specials) |s| {
            var full_buf: [8]u8 = undefined;
            const full = std.fmt.bufPrint(&full_buf, "\x1b{s}", .{s.seq}) catch continue;
            if (!std.mem.startsWith(u8, data, full)) continue;
            if (std.mem.eql(u8, s.name, "shift+tab")) {
                try self.events.append(
                    self.allocator,
                    try self.keyEvent("tab", .{ .shift = true }, null, full),
                );
            } else {
                try self.events.append(self.allocator, try self.keyEvent(s.name, .{}, null, full));
            }
            return @intCast(full.len);
        }

        // Possibly-incomplete CSI/SS3 sequence.
        if (isPartialCsi(data)) return -1;

        // Alt+key.
        if (data.len >= 2 and data[1] != '[' and data[1] != 'O') {
            const before = self.events.items.len;
            const consumed = try self.parsePlain(data[1..]);
            if (self.events.items.len > before) {
                const first = self.events.items[before];
                if (first == .key) {
                    const k = first.key;
                    var raw_buf: [8]u8 = undefined;
                    const raw = std.fmt.bufPrint(&raw_buf, "\x1b{s}", .{k.raw}) catch "\x1b";
                    const replacement = try self.keyEvent(
                        k.name,
                        .{ .ctrl = k.ctrl, .alt = true, .shift = k.shift },
                        k.char,
                        raw,
                    );
                    self.events.items[before] = replacement;
                    return @intCast(consumed + 1);
                }
            }
        }

        try self.events.append(self.allocator, try self.keyEvent("escape", .{}, null, "\x1b"));
        return 1;
    }
};

fn decodeMouse(code: u32, col: u32, row: u32, pressed: bool) MouseEvent {
    const shift = code & 4 != 0;
    const alt = code & 8 != 0;
    const ctrl = code & 16 != 0;
    const motion = code & 32 != 0;
    const is_scroll = code & 64 != 0;
    const bits = code & 3;

    const button_of: MouseButton = switch (bits) {
        0 => .left,
        1 => .middle,
        2 => .right,
        else => .none,
    };

    var action: MouseAction = undefined;
    var button: MouseButton = .none;
    var scroll: i32 = 0;

    if (is_scroll) {
        action = .scroll;
        scroll = if (bits == 0) -1 else 1;
    } else if (motion) {
        action = if (bits == 3) .move else .drag;
        button = button_of;
    } else {
        action = if (pressed) .press else .release;
        button = button_of;
    }

    return .{
        .action = action,
        .button = button,
        .x = col -| 1,
        .y = row -| 1,
        .scroll = scroll,
        .ctrl = ctrl,
        .alt = alt,
        .shift = shift,
    };
}

const SgrMouse = struct { code: u32, col: u32, row: u32, pressed: bool, len: usize };

/// `^\x1b\[<(\d+);(\d+);(\d+)([Mm])`
fn parseSgrMouse(data: []const u8) ?SgrMouse {
    if (!std.mem.startsWith(u8, data, "\x1b[<")) return null;
    const rest = data[3..];
    var i: usize = 0;

    const number = struct {
        fn f(text: []const u8, at: *usize) ?u32 {
            const start = at.*;
            while (at.* < text.len and text[at.*] >= '0' and text[at.*] <= '9') at.* += 1;
            if (at.* == start) return null;
            return std.fmt.parseUnsigned(u32, text[start..at.*], 10) catch null;
        }
    }.f;

    const code = number(rest, &i) orelse return null;
    if (i >= rest.len or rest[i] != ';') return null;
    i += 1;
    const col = number(rest, &i) orelse return null;
    if (i >= rest.len or rest[i] != ';') return null;
    i += 1;
    const row = number(rest, &i) orelse return null;
    if (i >= rest.len or (rest[i] != 'M' and rest[i] != 'm')) return null;
    const pressed = rest[i] == 'M';
    i += 1;
    return .{ .code = code, .col = col, .row = row, .pressed = pressed, .len = 3 + i };
}

/// `^\x1b\[<[\d;]*$` — a mouse report cut off mid-sequence.
fn isPartialMouse(data: []const u8) bool {
    if (!std.mem.startsWith(u8, data, "\x1b[<")) return false;
    for (data[3..]) |c| {
        if (!((c >= '0' and c <= '9') or c == ';')) return false;
    }
    return true;
}

const ModifiedCsi = struct { param: u32, final: u8, len: usize };

/// `^\x1b\[1;(\d+)([A-HPQRS])`
fn parseModifiedCsi(data: []const u8) ?ModifiedCsi {
    if (!std.mem.startsWith(u8, data, "\x1b[1;")) return null;
    const rest = data[4..];
    var i: usize = 0;
    while (i < rest.len and rest[i] >= '0' and rest[i] <= '9') i += 1;
    if (i == 0 or i >= rest.len) return null;
    const param = std.fmt.parseUnsigned(u32, rest[0..i], 10) catch return null;
    const final = rest[i];
    if (!((final >= 'A' and final <= 'H') or final == 'P' or final == 'Q' or
        final == 'R' or final == 'S')) return null;
    return .{ .param = param, .final = final, .len = 4 + i + 1 };
}

const ModifiedTilde = struct { key: u32, modifier: u32, len: usize };

/// `^\x1b\[(\d+);(\d+)~`
fn parseModifiedTilde(data: []const u8) ?ModifiedTilde {
    if (!std.mem.startsWith(u8, data, "\x1b[")) return null;
    const rest = data[2..];
    var i: usize = 0;
    while (i < rest.len and rest[i] >= '0' and rest[i] <= '9') i += 1;
    if (i == 0) return null;
    const key = std.fmt.parseUnsigned(u32, rest[0..i], 10) catch return null;
    if (i >= rest.len or rest[i] != ';') return null;
    i += 1;
    const start = i;
    while (i < rest.len and rest[i] >= '0' and rest[i] <= '9') i += 1;
    if (i == start) return null;
    const modifier = std.fmt.parseUnsigned(u32, rest[start..i], 10) catch return null;
    if (i >= rest.len or rest[i] != '~') return null;
    return .{ .key = key, .modifier = modifier, .len = 2 + i + 1 };
}

/// `^\x1b(\[|O)[\d;<]*$` — a CSI or SS3 sequence with no final byte yet.
fn isPartialCsi(data: []const u8) bool {
    const rest = if (std.mem.startsWith(u8, data, "\x1b["))
        data[2..]
    else if (std.mem.startsWith(u8, data, "\x1bO"))
        data[2..]
    else
        return false;
    for (rest) |c| {
        if (!((c >= '0' and c <= '9') or c == ';' or c == '<')) return false;
    }
    return true;
}

/// Does this event match a binding like `"ctrl+c"`, `"q"`, or `"f10"`?
pub fn matchKey(event: KeyEvent, binding: []const u8) bool {
    var buf: [32]u8 = undefined;
    const trimmed = std.mem.trim(u8, binding, " \t\r\n");
    if (trimmed.len > buf.len) return false;
    const b = std.ascii.lowerString(buf[0..trimmed.len], trimmed);

    var key_buf: [32]u8 = undefined;
    if (event.key.len <= key_buf.len) {
        const key = std.ascii.lowerString(key_buf[0..event.key.len], event.key);
        if (std.mem.eql(u8, key, b)) return true;
    }
    // A bare name matches whatever the shift state. Rejecting shift here was
    // justified by Tab focus firing both ways at once, which was simply wrong —
    // App reads the name directly and never calls this — and it silently stopped
    // every shifted named key (shift+up, shift+home, shift+f1, …) from matching
    // its own name. Bind "shift+tab" to distinguish; `key` carries it.
    var name_buf: [32]u8 = undefined;
    if (event.name.len > name_buf.len) return false;
    const name = std.ascii.lowerString(name_buf[0..event.name.len], event.name);
    return std.mem.eql(u8, name, b) and !event.ctrl and !event.alt;
}
