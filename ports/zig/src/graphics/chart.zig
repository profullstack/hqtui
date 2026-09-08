//! Charts of arbitrary (x, y) data.
//!
//! `plot` takes `[]const f64` and puts one sample per column: the x axis is the
//! slice index. That is the right model for a history buffer and the wrong one
//! for everything else -- two series of different lengths silently render at
//! different horizontal scales, a gap in the data is indistinguishable from a
//! shorter series, and there is no way at all to say where on the x axis a
//! point belongs.
//!
//! This takes points and a domain for each axis, so a series is placed rather
//! than appended. `plot` is untouched and still means what it meant.

const std = @import("std");

const blocks = @import("blocks.zig");
const braille_mod = @import("braille.zig");
const buffer_mod = @import("../buffer.zig");
const color_mod = @import("../color.zig");
const plot_mod = @import("plot.zig");
const surface_mod = @import("../surface.zig");
const theme_mod = @import("../theme.zig");

const BrailleCanvas = braille_mod.BrailleCanvas;
const Color = color_mod.Color;
const FillMode = blocks.FillMode;
const Point = braille_mod.Point;
const Style = buffer_mod.Style;
const Surface = surface_mod.Surface;
const clamp01 = blocks.clamp01;
const firstCodepoint = blocks.firstCodepoint;
const roundHalfUp = color_mod.roundHalfUp;
const seriesColor = theme_mod.seriesColor;

/// How a series is marked: joined, dotted, or dropped to the baseline.
pub const MarkType = enum { line, scatter, bar };

pub const ChartSeries = struct {
    points: []const Point = &.{},
    color: ?Color = null,
    label: []const u8 = "",
    mark: MarkType = .line,
    /// Shade between the line and the baseline. Ignored for a scatter.
    fill: bool = false,
};

/// One axis: what it spans and how its numbers read.
pub const AxisOptions = struct {
    min: ?f64 = null,
    max: ?f64 = null,
    format: ?*const fn (f64, []u8) []const u8 = null,
    /// How many labels to place. Default 2 -- the ends.
    ticks: usize = 0,
};

pub const ChartPlotOptions = struct {
    /// Braille is sharpest; block and ascii are the graceful degradations.
    mode: FillMode = .braille,
    x: ?AxisOptions = null,
    y: ?AxisOptions = null,
    background: ?Color = null,
    grid: bool = false,
    grid_color: ?Color = null,
    /// 0-1 opacity of the area fill against the background.
    fill_alpha: ?f64 = null,
    /// Where a bar or an area is measured from. Defaults to the y minimum.
    baseline: ?f64 = null,
};

pub const Domain = struct { min: f64, max: f64 };

/// A finite number, or null: a caller's bound is data, and data can be NaN.
fn bound(value: ?f64) ?f64 {
    const v = value orelse return null;
    return if (std.math.isFinite(v)) v else null;
}

/// The span an axis covers, from the caller where they said and from the data
/// where they did not.
///
/// A domain of zero width cannot be mapped -- every point would land in the same
/// place and a division would blow up -- so a flat series is given room around
/// itself rather than being collapsed onto one line.
pub fn domainOf(series: []const ChartSeries, axis: ?AxisOptions, which: usize) Domain {
    var min = if (axis) |a| bound(a.min) else null;
    var max = if (axis) |a| bound(a.max) else null;
    if (min == null or max == null) {
        var lo: f64 = std.math.inf(f64);
        var hi: f64 = -std.math.inf(f64);
        for (series) |s| {
            for (s.points) |p| {
                const v = if (which == 0) p.x else p.y;
                if (!std.math.isFinite(v)) continue;
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        }
        if (!std.math.isFinite(lo)) {
            lo = 0;
            hi = 1;
        }
        if (min == null) min = lo;
        if (max == null) max = hi;
    }
    const lo = min.?;
    const hi = max.?;
    if (!(hi > lo)) {
        // A flat series still has to be drawn somewhere sensible.
        const pad: f64 = if (@abs(lo) > 0) @abs(lo) * 0.5 else 0.5;
        return .{ .min = lo - pad, .max = lo + pad };
    }
    return .{ .min = lo, .max = hi };
}

/// Where a value sits in its domain, 0 at the minimum and 1 at the maximum.
fn ratio(value: f64, d: Domain) f64 {
    return (value - d.min) / (d.max - d.min);
}

fn drawGrid(s: Surface, color: Color, bg: ?Color) void {
    const w = s.width();
    const h = s.height();
    const step = @max(2, h / 4);
    var y: usize = 0;
    while (y < h) : (y += step) {
        var x: usize = 0;
        while (x < w) : (x += 2) {
            s.glyph(@intCast(x), @intCast(y), '·', .{ .fg = color, .bg = bg });
        }
    }
}

/// Draw point series across the whole surface.
///
/// Points are drawn in the order they are given: a line joins them as they come,
/// which is what lets a chart draw a loop or a path that doubles back. Sorting
/// them would quietly make that impossible.
pub fn plotPoints(
    allocator: std.mem.Allocator,
    s: Surface,
    series: []const ChartSeries,
    options: ChartPlotOptions,
) !void {
    if (s.isEmpty() or series.len == 0) return;
    const theme = s.theme;
    const bg = options.background;
    const w = s.width();
    const h = s.height();

    const xd = domainOf(series, options.x, 0);
    const yd = domainOf(series, options.y, 1);
    const baseline = bound(options.baseline) orelse yd.min;

    if (options.grid) {
        const color = options.grid_color orelse theme.border.mix(theme.background, 0.4);
        drawGrid(s, color, bg);
    }

    if (options.mode != .braille) {
        plotCells(s, series, options.mode, xd, yd, baseline, bg);
        return;
    }

    var canvas = try BrailleCanvas.init(allocator, w, h);
    defer canvas.deinit();
    const px: f64 = @floatFromInt(canvas.width);
    const py: f64 = @floatFromInt(canvas.height);

    for (series, 0..) |cs, si| {
        canvas.clear();
        const color = cs.color orelse seriesColor(theme.*, @intCast(si));
        if (cs.points.len == 0) continue;

        // Two buffers per series rather than one shared one: a series is drawn
        // and blitted before the next is touched, so nothing outlives the loop.
        const finite = try allocator.alloc(Point, cs.points.len);
        defer allocator.free(finite);
        var count: usize = 0;
        for (cs.points) |p| {
            if (!std.math.isFinite(p.x) or !std.math.isFinite(p.y)) continue;
            finite[count] = p;
            count += 1;
        }
        if (count == 0) continue;

        const pixels = try allocator.alloc(Point, count);
        defer allocator.free(pixels);
        for (finite[0..count], 0..) |p, i| {
            pixels[i] = .{
                .x = roundHalfUp(clamp01(ratio(p.x, xd)) * (px - 1)),
                .y = roundHalfUp((1 - clamp01(ratio(p.y, yd))) * (py - 1)),
            };
        }

        switch (cs.mark) {
            .scatter => for (pixels) |p| canvas.pixel(p.x, p.y),
            .bar => {
                const floor = roundHalfUp((1 - clamp01(ratio(baseline, yd))) * (py - 1));
                for (pixels) |p| canvas.vline(p.x, @min(p.y, floor), @max(p.y, floor));
            },
            .line => {
                if (pixels.len == 1) {
                    canvas.pixel(pixels[0].x, pixels[0].y);
                } else {
                    canvas.polyline(pixels);
                }
            },
        }

        if (cs.fill and cs.mark != .scatter) {
            try fillUnder(
                allocator,
                s,
                finite[0..count],
                xd,
                yd,
                baseline,
                color,
                bg,
                options.fill_alpha orelse 0.5,
            );
        }
        plot_mod.blitFlat(s, &canvas, color, bg);
    }
}

/// The area between a series and its baseline, in block elements.
///
/// Braille would give eight scattered dots per cell, which reads as noise where
/// an area should read as an area. The line itself stays Braille, so it keeps
/// the sub-cell resolution.
///
/// The height of each column is interpolated along the line rather than sampled
/// from the points that happen to land in it. Sampling leaves a gap wherever a
/// column has no point of its own, which with arbitrary x values is most of
/// them -- the area comes out striped instead of solid.
fn fillUnder(
    allocator: std.mem.Allocator,
    s: Surface,
    points: []const Point,
    xd: Domain,
    yd: Domain,
    baseline: f64,
    color: Color,
    bg: ?Color,
    alpha: f64,
) !void {
    const w = s.width();
    const h = s.height();
    if (w == 0 or h == 0 or points.len == 0) return;
    const base = bg orelse s.theme.background;
    const floor = clamp01(ratio(baseline, yd));

    const tops = try allocator.alloc(f64, w);
    defer allocator.free(tops);
    @memset(tops, std.math.nan(f64));

    const fw: f64 = @floatFromInt(w);
    const fh: f64 = @floatFromInt(h);

    for (0..points.len - 1) |i| {
        const p0 = points[i];
        const p1 = points[i + 1];
        const c0 = ratio(p0.x, xd) * (fw - 1);
        const c1 = ratio(p1.x, xd) * (fw - 1);
        const lo = @max(0, @floor(@min(c0, c1)));
        const hi = @min(fw - 1, @max(0, @ceil(@max(c0, c1))));
        var col: usize = @intFromFloat(lo);
        const last: usize = @intFromFloat(hi);
        while (col <= last and col < w) : (col += 1) {
            const fc: f64 = @floatFromInt(col);
            const t = if (c1 == c0) 0 else (fc - c0) / (c1 - c0);
            if (t < -0.5 or t > 1.5) continue;
            const y = p0.y + (p1.y - p0.y) * clamp01(t);
            const value = clamp01(ratio(y, yd));
            // A path that doubles back covers a column twice; the outer edge is
            // the one that bounds the area.
            const previous = tops[col];
            if (std.math.isNan(previous) or @abs(value - floor) > @abs(previous - floor)) {
                tops[col] = value;
            }
        }
    }
    if (points.len == 1) {
        const c: f64 = roundHalfUp(ratio(points[0].x, xd) * (fw - 1));
        if (c >= 0 and c < fw) tops[@intFromFloat(c)] = clamp01(ratio(points[0].y, yd));
    }

    for (0..w) |x| {
        const top = tops[x];
        if (std.math.isNan(top)) continue;
        const from01 = @min(floor, top);
        const filled = (@max(floor, top) - from01) * fh;
        const bottom: isize = @intFromFloat(@floor(from01 * fh));
        const full: isize = @intFromFloat(@floor(filled));
        var k: isize = 0;
        while (k < full and k < @as(isize, @intCast(h))) : (k += 1) {
            const row = @as(isize, @intCast(h)) - 1 - bottom - k;
            if (row < 0 or row >= @as(isize, @intCast(h))) continue;
            const depth: f64 = if (h <= 1) 0 else @as(f64, @floatFromInt(row)) / (fh - 1);
            s.glyph(@intCast(x), row, '█', .{
                .fg = base.mix(color, alpha * (1 - depth * 0.3)),
                .bg = bg,
            });
        }
        if (full < @as(isize, @intCast(h))) {
            const glyph = blocks.verticalGlyph(filled - @as(f64, @floatFromInt(full)), .block);
            const row = @as(isize, @intCast(h)) - 1 - bottom - full;
            if (!std.mem.eql(u8, glyph, " ") and row >= 0 and row < @as(isize, @intCast(h))) {
                const depth: f64 = if (h <= 1) 0 else @as(f64, @floatFromInt(row)) / (fh - 1);
                s.glyph(@intCast(x), row, firstCodepoint(glyph), .{
                    .fg = base.mix(color, alpha * (1 - depth * 0.3) + 0.12),
                    .bg = bg,
                });
            }
        }
    }
}

/// The block and ascii degradations: one column per cell, tallest point wins.
///
/// A scatter keeps its dots rather than growing columns, because a scatter that
/// fills to the baseline is a bar chart wearing the wrong name.
fn plotCells(
    s: Surface,
    series: []const ChartSeries,
    mode: FillMode,
    xd: Domain,
    yd: Domain,
    baseline: f64,
    bg: ?Color,
) void {
    const w = s.width();
    const h = s.height();
    if (w == 0 or h == 0) return;
    const theme = s.theme;
    const floor_ratio = clamp01(ratio(baseline, yd));
    const fw: f64 = @floatFromInt(w);
    const fh: f64 = @floatFromInt(h);

    // Bounded by the surface width, which is a terminal's, so the stack is the
    // right place for it and nothing here has to allocate.
    var tops: [1024]f64 = undefined;
    const columns = @min(w, tops.len);

    for (series, 0..) |cs, si| {
        const color = cs.color orelse seriesColor(theme.*, @intCast(si));
        @memset(tops[0..columns], std.math.nan(f64));

        // Highest value per column, so a column shows the peak that fell in it
        // rather than whichever point happened to be last.
        for (cs.points) |p| {
            if (!std.math.isFinite(p.x) or !std.math.isFinite(p.y)) continue;
            const raw = roundHalfUp(ratio(p.x, xd) * (fw - 1));
            const clamped = @max(0, @min(raw, fw - 1));
            const col: usize = @intFromFloat(clamped);
            if (col >= columns) continue;
            const value = clamp01(ratio(p.y, yd));
            if (std.math.isNan(tops[col]) or value > tops[col]) tops[col] = value;
        }

        for (0..columns) |x| {
            const top = tops[x];
            if (std.math.isNan(top)) continue;
            if (cs.mark == .scatter) {
                const k = @min(@as(isize, @intFromFloat(@floor(top * fh))), @as(isize, @intCast(h)) - 1);
                const row = @as(isize, @intCast(h)) - 1 - k;
                const glyph: u21 = if (mode == .ascii) '*' else '•';
                s.glyph(@intCast(x), row, glyph, .{ .fg = color, .bg = bg });
                continue;
            }
            const from = @min(floor_ratio, top) * fh;
            const filled = (@max(floor_ratio, top) - @min(floor_ratio, top)) * fh;
            const full: isize = @intFromFloat(@floor(filled));
            const bottom: isize = @intFromFloat(@floor(from));
            var k: isize = 0;
            while (k < full) : (k += 1) {
                const row = @as(isize, @intCast(h)) - 1 - bottom - k;
                if (row >= 0 and row < @as(isize, @intCast(h))) {
                    s.glyph(@intCast(x), row, '█', .{ .fg = color, .bg = bg });
                }
            }
            const glyph = blocks.verticalGlyph(filled - @as(f64, @floatFromInt(full)), mode);
            const row = @as(isize, @intCast(h)) - 1 - bottom - full;
            if (!std.mem.eql(u8, glyph, " ") and row >= 0 and row < @as(isize, @intCast(h))) {
                s.glyph(@intCast(x), row, firstCodepoint(glyph), .{ .fg = color, .bg = bg });
            }
        }
    }
}
