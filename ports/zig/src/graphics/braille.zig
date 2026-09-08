//! Braille turns every terminal cell into a 2x4 pixel matrix, which is why a
//! terminal graph can look like a real plot instead of a bar chart of hashes.

const std = @import("std");

const roundHalfUp = @import("../color.zig").roundHalfUp;
const unicode = @import("../unicode.zig");

const braille_base: u32 = 0x2800;

/// Dot numbering is column-major and famously not sequential.
const dot_bits = [4][2]u8{
    .{ 0x01, 0x08 },
    .{ 0x02, 0x10 },
    .{ 0x04, 0x20 },
    .{ 0x40, 0x80 },
};

/// `Math.min`/`Math.max` propagate NaN, where Zig's `@min`/`@max` return the
/// other operand. Every bounds test below is written so that NaN falls out
/// rather than landing in cell zero, and that only holds with JavaScript's
/// semantics — so they are spelled out.
fn jsMin(a: f64, b: f64) f64 {
    if (std.math.isNan(a) or std.math.isNan(b)) return std.math.nan(f64);
    return if (a < b) a else b;
}

fn jsMax(a: f64, b: f64) f64 {
    if (std.math.isNan(a) or std.math.isNan(b)) return std.math.nan(f64);
    return if (a > b) a else b;
}

pub const Point = struct { x: f64, y: f64 };

/// Round, treating a value within a hair of .5 as the tie it mathematically is.
///
/// Plot geometry runs through cos and sin, and libm implementations differ by an
/// ULP at the exact angles where a coordinate lands on .5 — cos(120°) is -0.5,
/// and V8 returns a hair under it where others return a hair over. Rounding the
/// raw value lets that ULP decide a pixel, so the same widget at the same size
/// differs between ports. The tolerance is far wider than an ULP and far
/// narrower than anything geometric.
fn snapRound(v: f64) f64 {
    return roundHalfUp(if (v >= 0) v + 1e-9 else v - 1e-9);
}

pub const BrailleCanvas = struct {
    allocator: std.mem.Allocator,
    /// Pixel dimensions: cols * 2 wide, rows * 4 tall.
    width: usize,
    height: usize,
    cols: usize,
    rows: usize,
    dots: []u8,

    /// Coordinates are clamped to this before anything iterates over them. It is
    /// far larger than any canvas and far below 2^53, where `x += 1` stops
    /// advancing and a Bresenham walk can never reach its endpoint.
    const limit: f64 = 1e7;

    /// Above this many Bresenham steps the walk is clipped to the canvas first.
    /// Clipping shifts which pixels a partly-offscreen line lands on, so it is
    /// reserved for walks long enough that their exact pattern cannot matter.
    const max_walk: f64 = 100_000;

    pub fn init(allocator: std.mem.Allocator, cols: usize, rows: usize) !BrailleCanvas {
        const dots = try allocator.alloc(u8, cols * rows);
        @memset(dots, 0);
        return .{
            .allocator = allocator,
            .width = cols * 2,
            .height = rows * 4,
            .cols = cols,
            .rows = rows,
            .dots = dots,
        };
    }

    pub fn deinit(self: *BrailleCanvas) void {
        self.allocator.free(self.dots);
        self.* = undefined;
    }

    pub fn clear(self: *BrailleCanvas) void {
        @memset(self.dots, 0);
    }

    /// Resolve a pixel coordinate to a cell index and dot bit. The test is
    /// written positively so that NaN, which compares false against everything,
    /// is ignored rather than landing in cell 0.
    fn locate(self: BrailleCanvas, x: f64, y: f64) ?struct { cell: usize, bit: u8 } {
        const px = snapRound(x);
        const py = snapRound(y);
        if (!(px >= 0 and py >= 0 and
            px < @as(f64, @floatFromInt(self.width)) and
            py < @as(f64, @floatFromInt(self.height)))) return null;
        const ix: usize = @intFromFloat(px);
        const iy: usize = @intFromFloat(py);
        return .{
            .cell = (iy >> 2) * self.cols + (ix >> 1),
            .bit = dot_bits[iy & 3][ix & 1],
        };
    }

    /// Set one pixel. Out-of-range coordinates are ignored, not clamped.
    pub fn pixel(self: *BrailleCanvas, x: f64, y: f64) void {
        if (self.locate(x, y)) |at| self.dots[at.cell] |= at.bit;
    }

    pub fn unset(self: *BrailleCanvas, x: f64, y: f64) void {
        if (self.locate(x, y)) |at| self.dots[at.cell] &= ~at.bit;
    }

    pub fn get(self: BrailleCanvas, x: f64, y: f64) bool {
        if (self.locate(x, y)) |at| return self.dots[at.cell] & at.bit != 0;
        return false;
    }

    /// Finite, bounded, and direction-preserving. NaN has no direction.
    fn finite(v: f64) ?f64 {
        if (std.math.isNan(v)) return null;
        if (v > limit) return limit;
        if (v < -limit) return -limit;
        return v;
    }

    /// The inclusive span an axis-aligned loop should cover, clipped to the
    /// canvas. Nothing outside it can draw, so clipping here is what makes every
    /// loop below finite for any input — infinite, enormous or NaN.
    fn span(a: f64, b: f64, bound: usize) struct { lo: i64, hi: i64 } {
        const lo = jsMin(a, b);
        const hi = jsMax(a, b);
        if (!(lo <= hi)) return .{ .lo = 0, .hi = -1 };
        const start = jsMax(0, @ceil(lo));
        const end = jsMin(@as(f64, @floatFromInt(bound)) - 1, @floor(hi));
        return .{ .lo = @intFromFloat(start), .hi = @intFromFloat(end) };
    }

    /// Liang-Barsky. Clipping before the walk — rather than clamping the
    /// endpoints, which would change the slope — keeps the line where it belongs
    /// and bounds the number of steps to the canvas.
    fn clipLine(
        self: BrailleCanvas,
        x0: f64,
        y0: f64,
        x1: f64,
        y1: f64,
    ) ?struct { x0: f64, y0: f64, x1: f64, y1: f64 } {
        const fx0 = finite(x0) orelse return null;
        const fy0 = finite(y0) orelse return null;
        const fx1 = finite(x1) orelse return null;
        const fy1 = finite(y1) orelse return null;
        const dx = fx1 - fx0;
        const dy = fy1 - fy0;
        var t0: f64 = 0;
        var t1: f64 = 1;
        const edges = [4][2]f64{
            .{ -dx, fx0 },
            .{ dx, @as(f64, @floatFromInt(self.width)) - 1 - fx0 },
            .{ -dy, fy0 },
            .{ dy, @as(f64, @floatFromInt(self.height)) - 1 - fy0 },
        };
        for (edges) |edge| {
            const p = edge[0];
            const q = edge[1];
            if (p == 0) {
                if (q < 0) return null;
                continue;
            }
            const r = q / p;
            if (p < 0) {
                if (r > t1) return null;
                if (r > t0) t0 = r;
            } else {
                if (r < t0) return null;
                if (r < t1) t1 = r;
            }
        }
        return .{
            .x0 = fx0 + t0 * dx,
            .y0 = fy0 + t0 * dy,
            .x1 = fx0 + t1 * dx,
            .y1 = fy0 + t1 * dy,
        };
    }

    /// Bresenham. Used for every line graph in the library.
    pub fn line(self: *BrailleCanvas, x0: f64, y0: f64, x1: f64, y1: f64) void {
        // The walk below only ends at `x == ex and y == ey`. Testing the
        // endpoints for finiteness is not enough to guarantee it gets there: the
        // deltas are derived from them and overflow, and past 2^53 `x += 1` does
        // not advance at all. Clipping to the canvas bounds the walk for every
        // input.
        var ax = finite(x0) orelse return;
        var ay = finite(y0) orelse return;
        var bx = finite(x1) orelse return;
        var by = finite(y1) orelse return;

        if (jsMax(@abs(bx - ax), @abs(by - ay)) > max_walk) {
            const clipped = self.clipLine(ax, ay, bx, by) orelse return;
            ax = clipped.x0;
            ay = clipped.y0;
            bx = clipped.x1;
            by = clipped.y1;
        }

        var x: i64 = @intFromFloat(roundHalfUp(ax));
        var y: i64 = @intFromFloat(roundHalfUp(ay));
        const ex: i64 = @intFromFloat(roundHalfUp(bx));
        const ey: i64 = @intFromFloat(roundHalfUp(by));
        const dx: i64 = @intCast(@abs(ex - x));
        const dy: i64 = -@as(i64, @intCast(@abs(ey - y)));
        const sx: i64 = if (x < ex) 1 else -1;
        const sy: i64 = if (y < ey) 1 else -1;
        var err = dx + dy;
        while (true) {
            self.pixel(@floatFromInt(x), @floatFromInt(y));
            if (x == ex and y == ey) break;
            const e2 = 2 * err;
            if (e2 >= dy) {
                err += dy;
                x += sx;
            }
            if (e2 <= dx) {
                err += dx;
                y += sy;
            }
        }
    }

    pub fn polyline(self: *BrailleCanvas, points: []const Point) void {
        var i: usize = 1;
        while (i < points.len) : (i += 1) {
            self.line(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
        }
    }

    pub fn vline(self: *BrailleCanvas, x: f64, y0: f64, y1: f64) void {
        const s = span(y0, y1, self.height);
        var y = s.lo;
        while (y <= s.hi) : (y += 1) self.pixel(x, @floatFromInt(y));
    }

    pub fn hline(self: *BrailleCanvas, y: f64, x0: f64, x1: f64) void {
        const s = span(x0, x1, self.width);
        var x = s.lo;
        while (x <= s.hi) : (x += 1) self.pixel(@floatFromInt(x), y);
    }

    pub fn rect(self: *BrailleCanvas, x0: f64, y0: f64, x1: f64, y1: f64) void {
        self.hline(y0, x0, x1);
        self.hline(y1, x0, x1);
        self.vline(x0, y0, y1);
        self.vline(x1, y0, y1);
    }

    pub fn fillRect(self: *BrailleCanvas, x0: f64, y0: f64, x1: f64, y1: f64) void {
        const s = span(y0, y1, self.height);
        var y = s.lo;
        while (y <= s.hi) : (y += 1) self.hline(@floatFromInt(y), x0, x1);
    }

    /// Fill the area under a series — the shaded region of an area graph.
    pub fn fillUnder(self: *BrailleCanvas, points: []const Point, baseline: f64) void {
        var i: usize = 1;
        while (i < points.len) : (i += 1) {
            const x0 = points[i - 1].x;
            const y0 = points[i - 1].y;
            const x1 = points[i].x;
            const y1 = points[i].y;
            // Bounded by the canvas: a span wider than it cannot add a column.
            var raw = roundHalfUp(@abs(x1 - x0));
            if (raw == 0) raw = 1;
            const steps = jsMax(1, jsMin(@floatFromInt(self.width), raw));
            const step_count: i64 = @intFromFloat(steps);
            var s: i64 = 0;
            while (s <= step_count) : (s += 1) {
                const t = @as(f64, @floatFromInt(s)) / steps;
                self.vline(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, baseline);
            }
        }
    }

    pub fn circle(self: *BrailleCanvas, cx: f64, cy: f64, radius: f64) void {
        // A radius larger than the canvas draws the same arc as one exactly its
        // size, and an unbounded one never finishes the `x >= y` walk.
        const r = finite(radius) orelse return;
        var x: i64 = @intFromFloat(roundHalfUp(
            jsMin(@abs(r), @floatFromInt(self.width + self.height)),
        ));
        var y: i64 = 0;
        var err: i64 = 1 - x;
        while (x >= y) {
            const fx: f64 = @floatFromInt(x);
            const fy: f64 = @floatFromInt(y);
            self.pixel(cx + fx, cy + fy);
            self.pixel(cx + fy, cy + fx);
            self.pixel(cx - fy, cy + fx);
            self.pixel(cx - fx, cy + fy);
            self.pixel(cx - fx, cy - fy);
            self.pixel(cx - fy, cy - fx);
            self.pixel(cx + fy, cy - fx);
            self.pixel(cx + fx, cy - fy);
            y += 1;
            if (err < 0) {
                err += 2 * y + 1;
            } else {
                x -= 1;
                err += 2 * (y - x) + 1;
            }
        }
    }

    /// The Braille codepoint for one cell, or 0 when the cell is empty.
    pub fn cell(self: BrailleCanvas, col: usize, row: usize) unicode.Cell {
        if (col >= self.cols or row >= self.rows) return 0;
        const bits = self.dots[row * self.cols + col];
        return if (bits == 0) 0 else braille_base | @as(u32, bits);
    }

    /// Rows of Braille text — handy for tests and for the HTML renderer. The
    /// caller owns the lines and the slice.
    pub fn toLines(self: BrailleCanvas, allocator: std.mem.Allocator) ![][]u8 {
        const lines = try allocator.alloc([]u8, self.rows);
        errdefer allocator.free(lines);
        for (0..self.rows) |row| {
            var row_text: std.ArrayList(u8) = .empty;
            errdefer row_text.deinit(allocator);
            for (0..self.cols) |col| {
                const v = self.cell(col, row);
                if (v == 0) {
                    try row_text.append(allocator, ' ');
                } else {
                    var buf: [4]u8 = undefined;
                    const n = std.unicode.utf8Encode(@intCast(v), &buf) catch 1;
                    try row_text.appendSlice(allocator, buf[0..n]);
                }
            }
            lines[row] = try row_text.toOwnedSlice(allocator);
        }
        return lines;
    }

    pub fn freeLines(allocator: std.mem.Allocator, lines: [][]u8) void {
        for (lines) |row_text| allocator.free(row_text);
        allocator.free(lines);
    }
};
