//! Turns two framebuffers into the smallest practical stream of escape
//! sequences. The encoder keeps a model of the terminal's current pen so no
//! redundant SGR is emitted.

const std = @import("std");

const ansi = @import("ansi.zig");
const buffer_mod = @import("buffer.zig");
const capabilities = @import("capabilities.zig");
const color_mod = @import("color.zig");
const unicode = @import("unicode.zig");

const Attrs = buffer_mod.Attrs;
const Color = color_mod.Color;
const ColorDepth = capabilities.ColorDepth;
const FrameBuffer = buffer_mod.FrameBuffer;

/// Rewriting up to this many unchanged cells is cheaper than the escape sequence
/// needed to jump over them, so neighbouring dirty spans get merged.
const gap_merge = 5;

pub const EncodeResult = struct {
    /// The bytes to hand to stdout. Owned by the encoder, valid until the next
    /// `encode`.
    output: []const u8,
    changed_cells: usize,
    /// Rows that contained at least one change.
    dirty_rows: usize,
};

pub const Options = struct {
    colors: ColorDepth = .truecolor,
    /// Drain all color, keeping attributes.
    monochrome: bool = false,
};

const State = struct {
    x: i64 = -1,
    y: i64 = -1,
    /// False after anything that makes the cursor position unknowable.
    known: bool = false,
    fg: Color = .default,
    bg: Color = .default,
    attrs: Attrs = .none,
};

pub const Encoder = struct {
    allocator: std.mem.Allocator,
    colors: ColorDepth,
    monochrome: bool,
    state: State = .{},
    parts: std.ArrayList(u8) = .empty,

    pub fn init(allocator: std.mem.Allocator, options: Options) Encoder {
        return .{
            .allocator = allocator,
            .colors = options.colors,
            .monochrome = options.monochrome,
        };
    }

    pub fn deinit(self: *Encoder) void {
        self.parts.deinit(self.allocator);
        self.* = undefined;
    }

    /// Forget what we believe about the terminal; the next write re-states
    /// everything.
    pub fn invalidateState(self: *Encoder) !void {
        self.state = .{};
        try self.parts.appendSlice(self.allocator, "\x1b[0m");
    }

    fn writeFg(self: *Encoder, c: Color) !void {
        if (self.colors == .none) return;
        if (c.isDefault()) {
            try self.parts.appendSlice(self.allocator, ansi.fg_default);
            return;
        }
        const col = if (self.monochrome) c.grayscale() else c;
        switch (self.colors) {
            .truecolor => try ansi.fgTrue(&self.parts, self.allocator, col.red(), col.green(), col.blue()),
            .ansi256 => try ansi.fg256(&self.parts, self.allocator, col.to256()),
            else => try ansi.fg16(&self.parts, self.allocator, col.to16()),
        }
    }

    fn writeBg(self: *Encoder, c: Color) !void {
        if (self.colors == .none) return;
        if (c.isDefault()) {
            try self.parts.appendSlice(self.allocator, ansi.bg_default);
            return;
        }
        const col = if (self.monochrome) c.grayscale() else c;
        switch (self.colors) {
            .truecolor => try ansi.bgTrue(&self.parts, self.allocator, col.red(), col.green(), col.blue()),
            .ansi256 => try ansi.bg256(&self.parts, self.allocator, col.to256()),
            else => try ansi.bg16(&self.parts, self.allocator, col.to16()),
        }
    }

    fn applyStyle(self: *Encoder, fg: Color, bg: Color, attrs: Attrs) !void {
        if (self.state.fg == fg and self.state.bg == bg and self.state.attrs.eql(attrs)) return;

        // Attributes can only be added cheaply; removing one means a full reset.
        if (!self.state.attrs.without(attrs).isEmpty()) {
            try self.parts.appendSlice(self.allocator, "\x1b[0m");
            self.state.attrs = .none;
            self.state.fg = .default;
            self.state.bg = .default;
        }

        const added = attrs.without(self.state.attrs);
        if (!added.isEmpty()) {
            var codes: [7]u8 = undefined;
            var n: usize = 0;
            inline for (.{
                .{ "bold", 1 },  .{ "dim", 2 },     .{ "italic", 3 },
                .{ "underline", 4 }, .{ "blink", 5 }, .{ "reverse", 7 },
                .{ "strike", 9 },
            }) |pair| {
                if (@field(added, pair[0])) {
                    codes[n] = pair[1];
                    n += 1;
                }
            }
            if (n > 0) {
                try self.parts.appendSlice(self.allocator, "\x1b[");
                for (codes[0..n], 0..) |code, i| {
                    if (i > 0) try self.parts.append(self.allocator, ';');
                    try self.parts.print(self.allocator, "{d}", .{code});
                }
                try self.parts.append(self.allocator, 'm');
            }
            self.state.attrs = attrs;
        }

        if (self.state.fg != fg) {
            try self.writeFg(fg);
            self.state.fg = fg;
        }
        if (self.state.bg != bg) {
            try self.writeBg(bg);
            self.state.bg = bg;
        }
    }

    fn moveCursor(self: *Encoder, x: usize, y: usize) !void {
        const xi: i64 = @intCast(x);
        const yi: i64 = @intCast(y);
        if (self.state.known and self.state.y == yi) {
            if (self.state.x == xi) return;
            if (xi > self.state.x and xi - self.state.x <= 3) {
                // Short hop: cheaper than a full CUP, and never repaints cells.
                try ansi.moveRight(&self.parts, self.allocator, @intCast(xi - self.state.x));
            } else if (x == 0) {
                try self.parts.append(self.allocator, '\r');
            } else {
                try ansi.moveToColumn(&self.parts, self.allocator, x);
            }
        } else {
            try ansi.moveTo(&self.parts, self.allocator, x, y);
        }
        self.state.x = xi;
        self.state.y = yi;
        self.state.known = true;
    }

    /// Encode the difference between `prev` and `next`. Pass `full` to repaint
    /// every cell (first frame, resize, or after a redraw request).
    pub fn encode(
        self: *Encoder,
        prev: *const FrameBuffer,
        next: *const FrameBuffer,
        full: bool,
    ) !EncodeResult {
        self.parts.clearRetainingCapacity();
        var changed: usize = 0;
        var dirty_rows: usize = 0;

        const w = next.width;
        const h = next.height;
        const same_size = prev.width == w and prev.height == h;
        const repaint = full or !same_size;
        if (repaint) try self.invalidateState();

        // Whether a cell actually changed. When the sizes disagree the previous
        // frame cannot be indexed with this frame's stride, so every cell counts
        // as different.
        const differs = struct {
            fn f(p: *const FrameBuffer, n: *const FrameBuffer, same: bool, i: usize) bool {
                if (!same) return true;
                return n.chars[i] != p.chars[i] or
                    n.fg[i] != p.fg[i] or
                    n.bg[i] != p.bg[i] or
                    !n.attrs[i].eql(p.attrs[i]);
            }
        }.f;

        for (0..h) |y| {
            const row_start = y * w;
            var x: usize = 0;
            var row_dirty = false;

            while (x < w) {
                // A full repaint forces every cell out even when unchanged;
                // `changed_cells` still reports real churn, not repaint volume,
                // which is why the two tests are separate.
                if (!(repaint or differs(prev, next, same_size, row_start + x))) {
                    x += 1;
                    continue;
                }

                // Walk left onto the lead cell if we landed on a wide char's tail.
                var start = x;
                while (start > 0 and next.chars[row_start + start] == unicode.continuation) {
                    start -= 1;
                }

                // Extend the run while cells are dirty, tolerating short gaps.
                var end = start;
                var clean: usize = 0;
                var probe = start;
                while (probe < w) : (probe += 1) {
                    if (repaint or differs(prev, next, same_size, row_start + probe)) {
                        end = probe;
                        clean = 0;
                    } else {
                        clean += 1;
                        if (clean > gap_merge) break;
                    }
                }

                try self.moveCursor(start, y);
                var cx = start;
                while (cx <= end) : (cx += 1) {
                    const j = row_start + cx;
                    const value = next.chars[j];
                    if (value == unicode.continuation) continue; // with its lead cell
                    try self.applyStyle(next.fg[j], next.bg[j], next.attrs[j]);
                    if (value == 0) {
                        try self.parts.append(self.allocator, ' ');
                    } else {
                        var buf: [4]u8 = undefined;
                        try self.parts.appendSlice(self.allocator, unicode.cellText(value, &buf));
                    }
                    self.state.x += @intCast(@max(1, unicode.cellWidth(value)));
                    if (differs(prev, next, same_size, j)) changed += 1;
                }
                // Writing the final column may have triggered autowrap; stop
                // trusting x.
                if (self.state.x >= @as(i64, @intCast(w))) self.state.known = false;
                row_dirty = true;
                x = end + 1;
            }
            if (row_dirty) dirty_rows += 1;
        }

        return .{
            .output = self.parts.items,
            .changed_cells = changed,
            .dirty_rows = dirty_rows,
        };
    }
};

/// One-shot encode of a whole buffer, e.g. for a screenshot. The caller owns the
/// returned bytes.
pub fn encodeFull(
    allocator: std.mem.Allocator,
    buf: *const FrameBuffer,
    options: Options,
) ![]u8 {
    var empty = try FrameBuffer.init(allocator, buf.width, buf.height);
    defer empty.deinit();
    var encoder = Encoder.init(allocator, options);
    defer encoder.deinit();
    const result = try encoder.encode(&empty, buf, true);
    return allocator.dupe(u8, result.output);
}
