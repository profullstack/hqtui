//! Raw VT/ANSI control sequences. Nothing above this layer writes an escape by
//! hand.

const std = @import("std");

const unicode = @import("unicode.zig");

pub const esc = "\x1b";
pub const csi = "\x1b[";

pub const reset = "\x1b[0m";

pub const alternate_screen_on = "\x1b[?1049h";
pub const alternate_screen_off = "\x1b[?1049l";

pub const cursor_hide = "\x1b[?25l";
pub const cursor_show = "\x1b[?25h";
pub const cursor_home = "\x1b[H";
pub const cursor_save = "\x1b7";
pub const cursor_restore = "\x1b8";

pub const clear_screen = "\x1b[2J";
pub const clear_scrollback = "\x1b[3J";
pub const clear_line = "\x1b[2K";
pub const clear_to_end = "\x1b[0J";

/// 1000 = clicks, 1002 = drag, 1003 = any motion, 1006 = SGR extended coords.
pub const mouse_on = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h";
pub const mouse_off = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

pub const bracketed_paste_on = "\x1b[?2004h";
pub const bracketed_paste_off = "\x1b[?2004l";

pub const focus_on = "\x1b[?1004h";
pub const focus_off = "\x1b[?1004l";

/// Atomic frame: the terminal shows nothing until `end_sync`. Kills tearing.
pub const begin_sync = "\x1b[?2026h";
pub const end_sync = "\x1b[?2026l";

pub const soft_reset = "\x1b[!p";

pub const fg_default = "\x1b[39m";
pub const bg_default = "\x1b[49m";

pub fn moveTo(out: *std.ArrayList(u8), allocator: std.mem.Allocator, x: usize, y: usize) !void {
    try out.print(allocator, "\x1b[{d};{d}H", .{ y + 1, x + 1 });
}

pub fn moveRight(out: *std.ArrayList(u8), allocator: std.mem.Allocator, n: usize) !void {
    if (n == 1) {
        try out.appendSlice(allocator, "\x1b[C");
    } else {
        try out.print(allocator, "\x1b[{d}C", .{n});
    }
}

pub fn moveToColumn(out: *std.ArrayList(u8), allocator: std.mem.Allocator, x: usize) !void {
    try out.print(allocator, "\x1b[{d}G", .{x + 1});
}

/// The title is interpolated into an OSC sequence, so anything that could end or
/// restart it has to go. `stripUnsafe` is the same policy the grid uses.
pub fn setTitle(allocator: std.mem.Allocator, title: []const u8) ![]u8 {
    const safe = try unicode.stripUnsafeAlloc(allocator, title);
    defer allocator.free(safe);
    return std.fmt.allocPrint(allocator, "\x1b]0;{s}\x07", .{safe});
}

pub fn fgTrue(out: *std.ArrayList(u8), allocator: std.mem.Allocator, r: u8, g: u8, b: u8) !void {
    try out.print(allocator, "\x1b[38;2;{d};{d};{d}m", .{ r, g, b });
}

pub fn bgTrue(out: *std.ArrayList(u8), allocator: std.mem.Allocator, r: u8, g: u8, b: u8) !void {
    try out.print(allocator, "\x1b[48;2;{d};{d};{d}m", .{ r, g, b });
}

pub fn fg256(out: *std.ArrayList(u8), allocator: std.mem.Allocator, i: u8) !void {
    try out.print(allocator, "\x1b[38;5;{d}m", .{i});
}

pub fn bg256(out: *std.ArrayList(u8), allocator: std.mem.Allocator, i: u8) !void {
    try out.print(allocator, "\x1b[48;5;{d}m", .{i});
}

pub fn fg16(out: *std.ArrayList(u8), allocator: std.mem.Allocator, i: u8) !void {
    const code: u32 = if (i < 8) 30 + @as(u32, i) else 90 + @as(u32, i) - 8;
    try out.print(allocator, "\x1b[{d}m", .{code});
}

pub fn bg16(out: *std.ArrayList(u8), allocator: std.mem.Allocator, i: u8) !void {
    const code: u32 = if (i < 8) 40 + @as(u32, i) else 100 + @as(u32, i) - 8;
    try out.print(allocator, "\x1b[{d}m", .{code});
}

fn isCsiParam(cp: u21) bool {
    return (cp >= '0' and cp <= '9') or cp == ';' or cp == '?' or
        cp == '<' or cp == '=' or cp == '>';
}

fn isTextUnsafe(cp: u21) bool {
    return cp <= 0x08 or cp == 0x0b or cp == 0x0c or
        (cp >= 0x0e and cp <= 0x1f) or
        (cp >= 0x7f and cp <= 0x9f) or
        (cp >= 0x202a and cp <= 0x202e) or
        (cp >= 0x2066 and cp <= 0x2069);
}

/// Decode the codepoints of `text` into `out`, so the scanner below can index
/// them. UTF-8 byte offsets are not usable here: a C1 control is two bytes.
fn decode(allocator: std.mem.Allocator, text: []const u8) ![]u21 {
    var list: std.ArrayList(u21) = .empty;
    errdefer list.deinit(allocator);
    var i: usize = 0;
    while (i < text.len) {
        const len = std.unicode.utf8ByteSequenceLength(text[i]) catch {
            try list.append(allocator, text[i]);
            i += 1;
            continue;
        };
        if (i + len > text.len) {
            try list.append(allocator, text[i]);
            i += 1;
            continue;
        }
        const cp = std.unicode.utf8Decode(text[i..][0..len]) catch text[i];
        try list.append(allocator, cp);
        i += len;
    }
    return list.toOwnedSlice(allocator);
}

fn scanToTerminator(cps: []const u21, from: usize, bel_terminates: bool) usize {
    var j = from;
    while (j < cps.len) : (j += 1) {
        if (bel_terminates and cps[j] == 0x07) return j + 1;
        if (cps[j] == 0x9c) return j + 1;
        if (cps[j] == 0x1b and j + 1 < cps.len and cps[j + 1] == '\\') return j + 2;
    }
    return cps.len;
}

/// Strip escape sequences.
///
/// Two things the obvious approach misses, both of which leave a live sequence
/// behind: CSI may carry intermediate bytes (0x20-0x2f) before its final byte,
/// as in `ESC [ 0 SP q`; and every sequence has an 8-bit C1 form where a single
/// byte replaces `ESC x`. After the structured pass, anything still holding a
/// control or bidi override is removed outright, so the result cannot steer a
/// terminal even if a form was missed.
pub fn stripAnsi(allocator: std.mem.Allocator, text: []const u8) ![]u8 {
    const cps = try decode(allocator, text);
    defer allocator.free(cps);

    var kept: std.ArrayList(u21) = .empty;
    defer kept.deinit(allocator);

    var i: usize = 0;
    while (i < cps.len) {
        const c = cps[i];

        // CSI: ESC [ … or the C1 form, U+009B.
        const csi_start: ?usize = if (c == 0x1b and i + 1 < cps.len and cps[i + 1] == '[')
            i + 2
        else if (c == 0x9b)
            i + 1
        else
            null;
        if (csi_start) |start| {
            var j = start;
            while (j < cps.len and isCsiParam(cps[j])) j += 1;
            while (j < cps.len and cps[j] >= 0x20 and cps[j] <= 0x2f) j += 1;
            // Without a final byte this is not a sequence yet; fall through and
            // let the unsafe pass below drop the bare ESC.
            if (j < cps.len and cps[j] >= 0x40 and cps[j] <= 0x7e) {
                i = j + 1;
                continue;
            }
        }

        // OSC: ESC ] … terminated by BEL, ST, C1 ST, or end of string.
        const osc_start: ?usize = if (c == 0x1b and i + 1 < cps.len and cps[i + 1] == ']')
            i + 2
        else if (c == 0x9d)
            i + 1
        else
            null;
        if (osc_start) |start| {
            i = scanToTerminator(cps, start, true);
            continue;
        }

        // DCS: ESC P … terminated by ST, C1 ST, or end of string.
        const dcs_start: ?usize = if (c == 0x1b and i + 1 < cps.len and cps[i + 1] == 'P')
            i + 2
        else if (c == 0x90)
            i + 1
        else
            null;
        if (dcs_start) |start| {
            i = scanToTerminator(cps, start, false);
            continue;
        }

        // Any other two-character escape: ESC then 0x40-0x5A or 0x5C-0x5F.
        if (c == 0x1b and i + 1 < cps.len) {
            const nxt = cps[i + 1];
            if ((nxt >= 0x40 and nxt <= 0x5a) or (nxt >= 0x5c and nxt <= 0x5f)) {
                i += 2;
                continue;
            }
        }

        try kept.append(allocator, c);
        i += 1;
    }

    // The grid's unsafe set minus tab, newline and carriage return. This works
    // on text, not cells, and multi-line callers rely on those three; the
    // framebuffer refuses them separately, which is the right layer for it.
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    for (kept.items) |cp| {
        if (isTextUnsafe(cp)) continue;
        var buf: [4]u8 = undefined;
        const len = std.unicode.utf8Encode(cp, &buf) catch continue;
        try out.appendSlice(allocator, buf[0..len]);
    }
    return out.toOwnedSlice(allocator);
}
