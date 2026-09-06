//! The screen is one grid of cells, not a tree of widgets. Four parallel slices
//! keep a frame allocation-free: no object is created per cell, ever.

const std = @import("std");

const color_mod = @import("color.zig");
const unicode = @import("unicode.zig");

const Color = color_mod.Color;
const Cell = unicode.Cell;

/// Style attribute bits packed into a cell's 16-bit slot.
pub const Attrs = packed struct(u16) {
    bold: bool = false,
    dim: bool = false,
    italic: bool = false,
    underline: bool = false,
    blink: bool = false,
    reverse: bool = false,
    strike: bool = false,
    _padding: u9 = 0,

    pub const none: Attrs = .{};
    pub const bold_only: Attrs = .{ .bold = true };

    pub fn bits(self: Attrs) u16 {
        return @bitCast(self);
    }

    pub fn fromBits(value: u16) Attrs {
        return @bitCast(value);
    }

    pub fn eql(self: Attrs, other: Attrs) bool {
        return self.bits() == other.bits();
    }

    pub fn merge(self: Attrs, other: Attrs) Attrs {
        return fromBits(self.bits() | other.bits());
    }

    /// Bits set in `self` that are not set in `other`.
    pub fn without(self: Attrs, other: Attrs) Attrs {
        return fromBits(self.bits() & ~other.bits());
    }

    pub fn isEmpty(self: Attrs) bool {
        return self.bits() == 0;
    }
};

/// A partial style. A null field means "leave whatever is already there", which
/// is what lets a widget set only the foreground of a region.
pub const Style = struct {
    fg: ?Color = null,
    bg: ?Color = null,
    attrs: ?Attrs = null,

    /// Changes nothing.
    pub const none: Style = .{};

    /// Fill in anything this style leaves unset from `other`.
    pub fn merged(self: Style, other: Style) Style {
        return .{
            .fg = self.fg orelse other.fg,
            .bg = self.bg orelse other.bg,
            .attrs = self.attrs orelse other.attrs,
        };
    }
};

/// A grid of styled cells. The only thing the encoder ever reads.
pub const FrameBuffer = struct {
    allocator: std.mem.Allocator,
    width: usize,
    height: usize,
    chars: []Cell,
    fg: []Color,
    bg: []Color,
    attrs: []Attrs,

    pub fn init(allocator: std.mem.Allocator, width: usize, height: usize) !FrameBuffer {
        const n = width * height;
        var self: FrameBuffer = .{
            .allocator = allocator,
            .width = width,
            .height = height,
            .chars = try allocator.alloc(Cell, n),
            .fg = try allocator.alloc(Color, n),
            .bg = try allocator.alloc(Color, n),
            .attrs = try allocator.alloc(Attrs, n),
        };
        self.clear(.default, .default);
        return self;
    }

    pub fn deinit(self: *FrameBuffer) void {
        self.allocator.free(self.chars);
        self.allocator.free(self.fg);
        self.allocator.free(self.bg);
        self.allocator.free(self.attrs);
        self.* = undefined;
    }

    /// Resize, reusing the existing allocation when it is large enough.
    pub fn resize(self: *FrameBuffer, width: usize, height: usize) !void {
        if (width == self.width and height == self.height) return;
        const n = width * height;
        if (n > self.chars.len) {
            self.chars = try self.allocator.realloc(self.chars, n);
            self.fg = try self.allocator.realloc(self.fg, n);
            self.bg = try self.allocator.realloc(self.bg, n);
            self.attrs = try self.allocator.realloc(self.attrs, n);
        }
        self.width = width;
        self.height = height;
        self.clear(.default, .default);
    }

    pub fn index(self: FrameBuffer, x: usize, y: usize) usize {
        return y * self.width + x;
    }

    pub fn clear(self: *FrameBuffer, bg: Color, fg: Color) void {
        const n = self.width * self.height;
        @memset(self.chars[0..n], 32);
        @memset(self.fg[0..n], fg);
        @memset(self.bg[0..n], bg);
        @memset(self.attrs[0..n], .none);
    }

    pub fn inBounds(self: FrameBuffer, x: isize, y: isize) bool {
        return x >= 0 and y >= 0 and
            x < @as(isize, @intCast(self.width)) and y < @as(isize, @intCast(self.height));
    }

    fn applyStyle(self: *FrameBuffer, i: usize, style: Style) void {
        if (style.fg) |v| self.fg[i] = v;
        if (style.bg) |v| self.bg[i] = v;
        if (style.attrs) |v| self.attrs[i] = v;
    }

    /// Write one already-decoded cell value. Returns columns consumed.
    ///
    /// This is the only path that writes a character into the grid, and the
    /// encoder hands cell text straight to the terminal. Refusing unsafe values
    /// here means the buffer *cannot* hold a live escape, whatever the caller
    /// passes — including the low-level escape hatch.
    pub fn setCell(self: *FrameBuffer, x: isize, y: isize, value_in: Cell, style: Style) usize {
        if (!self.inBounds(x, y)) return 0;
        const ux: usize = @intCast(x);
        const uy: usize = @intCast(y);

        var value = value_in;
        // Ordered so printable ASCII costs one comparison. A lead-less
        // continuation is not writable either; it would eat a column silently.
        if (value >= 0x7f) {
            if (unicode.isUnsafeCodepoint(value) or value == unicode.continuation) {
                value = 32;
            } else if (!validScalar(value)) {
                value = unicode.replacement;
            }
        } else if (value < 0x20) {
            value = 32;
        }

        const w = unicode.cellWidth(value);
        const i = self.index(ux, uy);
        // Overwriting the tail of a wide char to our left would orphan it.
        if (self.chars[i] == unicode.continuation and ux > 0) self.chars[i - 1] = 32;
        self.chars[i] = value;
        self.applyStyle(i, style);

        if (w == 2) {
            if (ux + 1 < self.width) {
                self.chars[i + 1] = unicode.continuation;
                self.applyStyle(i + 1, style);
            } else {
                // No room for the second half: draw a space rather than corrupt
                // the row.
                self.chars[i] = 32;
                return 1;
            }
        }
        return @max(1, w);
    }

    /// Write text left to right. Returns the number of columns written.
    pub fn write(self: *FrameBuffer, x: isize, y: isize, text: []const u8, style: Style) usize {
        return self.writeCapped(x, y, text, style, std.math.maxInt(usize));
    }

    pub fn writeCapped(
        self: *FrameBuffer,
        x: isize,
        y: isize,
        text: []const u8,
        style: Style,
        max_width: usize,
    ) usize {
        if (y < 0 or y >= @as(isize, @intCast(self.height))) return 0;
        var cx = x;
        var used: usize = 0;
        var it = unicode.graphemes(text);
        while (it.next()) |g| {
            if (used + g.width > max_width) break;
            if (cx >= @as(isize, @intCast(self.width))) break;
            if (cx + @as(isize, @intCast(g.width)) > @as(isize, @intCast(self.width))) break;
            if (cx >= 0) _ = self.setCell(cx, y, g.value, style);
            cx += @intCast(g.width);
            used += g.width;
        }
        return used;
    }

    pub fn fillRect(
        self: *FrameBuffer,
        x: isize,
        y: isize,
        w: usize,
        h: usize,
        ch: Cell,
        style: Style,
    ) void {
        const x0: usize = @intCast(@max(0, x));
        const y0: usize = @intCast(@max(0, y));
        const x1 = @min(self.width, @as(usize, @intCast(@max(0, x + @as(isize, @intCast(w))))));
        const y1 = @min(self.height, @as(usize, @intCast(@max(0, y + @as(isize, @intCast(h))))));
        var cy = y0;
        while (cy < y1) : (cy += 1) {
            var cx = x0;
            while (cx < x1) : (cx += 1) {
                _ = self.setCell(@intCast(cx), @intCast(cy), ch, style);
            }
        }
    }

    /// Restyle a region without touching its characters.
    pub fn styleRect(self: *FrameBuffer, x: isize, y: isize, w: usize, h: usize, style: Style) void {
        const x0: usize = @intCast(@max(0, x));
        const y0: usize = @intCast(@max(0, y));
        const x1 = @min(self.width, @as(usize, @intCast(@max(0, x + @as(isize, @intCast(w))))));
        const y1 = @min(self.height, @as(usize, @intCast(@max(0, y + @as(isize, @intCast(h))))));
        var cy = y0;
        while (cy < y1) : (cy += 1) {
            var cx = x0;
            while (cx < x1) : (cx += 1) {
                self.applyStyle(self.index(cx, cy), style);
            }
        }
    }

    /// Copy another buffer's contents (same dimensions assumed).
    pub fn copyFrom(self: *FrameBuffer, other: *const FrameBuffer) void {
        const n = @min(self.width * self.height, other.width * other.height);
        @memcpy(self.chars[0..n], other.chars[0..n]);
        @memcpy(self.fg[0..n], other.fg[0..n]);
        @memcpy(self.bg[0..n], other.bg[0..n]);
        @memcpy(self.attrs[0..n], other.attrs[0..n]);
    }

    /// Plain text of one row, appended to `out`.
    pub fn rowText(self: FrameBuffer, out: *std.ArrayList(u8), allocator: std.mem.Allocator, y: usize) !void {
        if (y >= self.height) return;
        const row = y * self.width;
        var x: usize = 0;
        while (x < self.width) : (x += 1) {
            const v = self.chars[row + x];
            if (v == unicode.continuation) continue;
            if (v == 0) {
                try out.append(allocator, ' ');
            } else {
                var buf: [4]u8 = undefined;
                try out.appendSlice(allocator, unicode.cellText(v, &buf));
            }
        }
    }

    /// Plain text of one row, allocated. The caller owns it.
    pub fn rowTextAlloc(self: FrameBuffer, allocator: std.mem.Allocator, y: usize) ![]u8 {
        var out: std.ArrayList(u8) = .empty;
        errdefer out.deinit(allocator);
        try self.rowText(&out, allocator, y);
        return out.toOwnedSlice(allocator);
    }

    /// Whole buffer as plain text, trailing whitespace trimmed per row.
    pub fn toText(self: FrameBuffer, allocator: std.mem.Allocator) ![]u8 {
        var out: std.ArrayList(u8) = .empty;
        errdefer out.deinit(allocator);
        var y: usize = 0;
        while (y < self.height) : (y += 1) {
            if (y > 0) try out.append(allocator, '\n');
            const row = try self.rowTextAlloc(allocator, y);
            defer allocator.free(row);
            try out.appendSlice(allocator, std.mem.trimRight(u8, row, " "));
        }
        return out.toOwnedSlice(allocator);
    }
};

/// A cell value only holds a real character if it is a Unicode scalar. The
/// reference reaches this check via lone surrogates, which valid UTF-8 cannot
/// contain; a caller using the raw `setCell` escape hatch still can, so the
/// guard stays.
fn validScalar(value: Cell) bool {
    if (value >= unicode.cluster_base) return true;
    return value <= 0x10ffff and !(value >= 0xd800 and value <= 0xdfff);
}
