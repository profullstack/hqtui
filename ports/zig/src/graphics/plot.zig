//! Line, area, bar and dial rendering. With `.braille` each cell carries a 2x4
//! pixel matrix, so a 40x10 panel plots at 80x40 resolution.
//!
//! Every entry point takes an allocator, because the Braille canvas and the
//! point list are the only two things here that cannot live on the stack. The
//! block and ASCII modes allocate nothing at all.

const std = @import("std");

const blocks = @import("blocks.zig");
const braille_mod = @import("braille.zig");
const buffer_mod = @import("../buffer.zig");
const color_mod = @import("../color.zig");
const surface_mod = @import("../surface.zig");
const theme_mod = @import("../theme.zig");
const unicode = @import("../unicode.zig");

const BrailleCanvas = braille_mod.BrailleCanvas;
const Color = color_mod.Color;
const FillMode = blocks.FillMode;
const Gradient = color_mod.Gradient;
const Point = braille_mod.Point;
const Style = buffer_mod.Style;
const Surface = surface_mod.Surface;
const clamp01 = blocks.clamp01;
const firstCodepoint = blocks.firstCodepoint;
const roundHalfUp = color_mod.roundHalfUp;

pub const Series = struct {
    values: []const f64 = &.{},
    color: ?Color = null,
    label: []const u8 = "",
    /// Shade the area beneath the line.
    fill: ?bool = null,
};

pub const PlotOptions = struct {
    /// Braille is sharpest; block and ascii are the graceful degradations.
    mode: FillMode = .braille,
    min: ?f64 = null,
    max: ?f64 = null,
    color: ?Color = null,
    /// Color the plot along a ramp by value rather than one flat color.
    colors: []const Color = &.{},
    fill: ?bool = null,
    /// 0-1 opacity of the area fill against the background.
    fill_alpha: f64 = 0.5,
    background: ?Color = null,
    /// Draw a faint dotted grid behind the series.
    grid: bool = false,
    grid_color: ?Color = null,
    baseline: ?f64 = null,
};

/// A finite number, or null — `sum / count` with no samples is NaN.
fn finite(v: ?f64) ?f64 {
    const value = v orelse return null;
    if (std.math.isNan(value) or std.math.isInf(value)) return null;
    return value;
}

fn extent(series: []const Series, options: PlotOptions, columns: usize) struct { min: f64, max: f64 } {
    // A caller's axis bound is data, and data can be NaN. Falling back to the
    // computed extent keeps every plotted coordinate finite.
    const lo_opt = finite(options.min);
    const hi_opt = finite(options.max);
    var low: f64 = undefined;
    var high: f64 = undefined;

    if (lo_opt == null or hi_opt == null) {
        var lo = std.math.inf(f64);
        var hi = -std.math.inf(f64);
        for (series) |s| {
            for (tail(s.values, columns)) |v| {
                if (std.math.isNan(v) or std.math.isInf(v)) continue;
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        }
        if (std.math.isInf(lo)) {
            lo = 0;
            hi = 1;
        }
        low = lo_opt orelse @min(0, lo);
        high = hi_opt orelse hi;
    } else {
        low = lo_opt.?;
        high = hi_opt.?;
    }
    if (high <= low) high = low + 1;
    return .{ .min = low, .max = high };
}

/// The trailing window of a series that will actually be drawn.
///
/// A slice, not a copy: the other ports allocate here and Zig does not have to.
pub fn tail(values: []const f64, columns: usize) []const f64 {
    const n = @max(1, columns);
    return if (values.len <= n) values else values[values.len - n ..];
}

fn drawGrid(s: Surface, c: Color, bg: ?Color) void {
    const w = s.width();
    const h = s.height();
    const step = @max(2, h / 4);
    var y: usize = 0;
    while (y < h) : (y += step) {
        var x: usize = 0;
        while (x < w) : (x += 2) {
            s.glyph(@intCast(x), @intCast(y), '·', .{ .fg = c, .bg = bg });
        }
    }
}

/// Draw one or more series across the whole surface.
pub fn plot(
    allocator: std.mem.Allocator,
    s: Surface,
    series: []const Series,
    options: PlotOptions,
) !void {
    if (s.isEmpty() or series.len == 0) return;
    const theme = s.theme;
    const bg = options.background;
    const w = s.width();
    const h = s.height();

    // Only the samples that will actually be drawn should set the scale, or an
    // old spike still sitting in the history buffer flattens the live line.
    const columns = if (options.mode == .braille) w * 2 else w;
    const bounds = extent(series, options, columns);
    const span = bounds.max - bounds.min;

    if (options.grid) {
        drawGrid(s, options.grid_color orelse theme.border.mix(theme.background, 0.4), bg);
    }

    if (options.mode == .block or options.mode == .ascii or options.mode == .half) {
        // One column per cell, newest value on the right.
        for (series, 0..) |sr, si| {
            const values = tail(sr.values, columns);
            const c = sr.color orelse options.color orelse theme_mod.seriesColor(theme.*, @intCast(si));
            const ramp: ?Gradient = if (options.colors.len > 0) Gradient.init(options.colors) else null;

            for (0..w) |x| {
                const idx = @as(isize, @intCast(values.len)) - @as(isize, @intCast(w)) + @as(isize, @intCast(x));
                if (idx < 0 or idx >= values.len) continue;
                const v = values[@intCast(idx)];
                if (std.math.isNan(v) or std.math.isInf(v)) continue;

                const ratio = (v - bounds.min) / span;
                const filled = ratio * @as(f64, @floatFromInt(h));
                const full_f = @floor(filled);
                const cell_color = if (ramp) |r| r.sample(ratio) else c;
                const style: Style = .{ .fg = cell_color, .bg = bg };
                const full: i64 = if (std.math.isNan(full_f) or std.math.isInf(full_f))
                    0
                else
                    @intFromFloat(full_f);

                var k: i64 = 0;
                while (k < full and k < @as(i64, @intCast(h))) : (k += 1) {
                    s.glyph(@intCast(x), @as(isize, @intCast(h)) - 1 - @as(isize, @intCast(k)), '█', style);
                }
                if (full < @as(i64, @intCast(h))) {
                    const glyph = blocks.verticalGlyph(filled - full_f, options.mode);
                    if (!std.mem.eql(u8, glyph, " ")) {
                        s.glyph(
                            @intCast(x),
                            @as(isize, @intCast(h)) - 1 - @as(isize, @intCast(full)),
                            firstCodepoint(glyph),
                            style,
                        );
                    }
                }
            }
        }
        return;
    }

    // Braille: build one canvas per series so colors stay separable.
    var canvas = try BrailleCanvas.init(allocator, w, h);
    defer canvas.deinit();
    const px = canvas.width;
    const py = canvas.height;

    const points = try allocator.alloc(Point, @max(1, px));
    defer allocator.free(points);

    for (series, 0..) |sr, si| {
        canvas.clear();
        const values = tail(sr.values, columns);
        const c = sr.color orelse options.color orelse theme_mod.seriesColor(theme.*, @intCast(si));
        if (values.len == 0) continue;

        const count = @min(values.len, px);
        const start = values.len - count;
        var n: usize = 0;
        for (0..count) |i| {
            const v = values[start + i];
            if (std.math.isNan(v) or std.math.isInf(v)) continue;
            const ratio = (v - bounds.min) / span;
            const x: f64 = if (count == 1)
                @floatFromInt(px - 1)
            else
                roundHalfUp(@as(f64, @floatFromInt(i)) / @as(f64, @floatFromInt(count - 1)) *
                    @as(f64, @floatFromInt(px - 1)));
            const y = roundHalfUp((1 - clamp01(ratio)) * @as(f64, @floatFromInt(py - 1)));
            points[n] = .{ .x = x, .y = y };
            n += 1;
        }
        if (n == 0) continue;
        if (n == 1) canvas.pixel(points[0].x, points[0].y) else canvas.polyline(points[0..n]);

        const want_fill = sr.fill orelse options.fill orelse false;
        if (want_fill) {
            // The area is drawn with block elements rather than Braille: eight
            // scattered dots per cell reads as noise, a block reads as an area.
            // The line stays Braille, so it keeps the sub-cell resolution.
            const base = bg orelse theme.background;
            // The fill has to walk the same window as the line, averaging the
            // samples that land inside each cell — otherwise the area drifts out
            // of step.
            const sample_count = @min(values.len, px);
            const sample_start = values.len - sample_count;
            for (0..w) |x| {
                const fw: f64 = @floatFromInt(w);
                const fs: f64 = @floatFromInt(sample_count);
                const from = sample_start + @as(usize, @intFromFloat(@as(f64, @floatFromInt(x)) / fw * fs));
                const to = @max(
                    from + 1,
                    sample_start + @as(usize, @intFromFloat(@as(f64, @floatFromInt(x + 1)) / fw * fs)),
                );
                var total: f64 = 0;
                var seen: usize = 0;
                var i = from;
                while (i < to and i < values.len) : (i += 1) {
                    const sample = values[i];
                    if (!std.math.isNan(sample) and !std.math.isInf(sample)) {
                        total += sample;
                        seen += 1;
                    }
                }
                if (seen == 0) continue;
                const ratio = clamp01((total / @as(f64, @floatFromInt(seen)) - bounds.min) / span);
                const filled = ratio * @as(f64, @floatFromInt(h));
                const full: i64 = @intFromFloat(@floor(filled));

                var k: i64 = 0;
                while (k < full and k < @as(i64, @intCast(h))) : (k += 1) {
                    const row = @as(i64, @intCast(h)) - 1 - k;
                    const depth: f64 = if (h <= 1)
                        0
                    else
                        @as(f64, @floatFromInt(row)) / @as(f64, @floatFromInt(h - 1));
                    s.glyph(@intCast(x), @intCast(row), '█', .{
                        .fg = base.mix(c, options.fill_alpha * (1 - depth * 0.3)),
                        .bg = bg,
                    });
                }
                if (full < @as(i64, @intCast(h))) {
                    const glyph = blocks.verticalGlyph(filled - @floor(filled), .block);
                    if (!std.mem.eql(u8, glyph, " ")) {
                        const row = @as(i64, @intCast(h)) - 1 - full;
                        const depth: f64 = if (h <= 1)
                            0
                        else
                            @as(f64, @floatFromInt(row)) / @as(f64, @floatFromInt(h - 1));
                        s.glyph(@intCast(x), @intCast(row), firstCodepoint(glyph), .{
                            .fg = base.mix(c, options.fill_alpha * (1 - depth * 0.3) + 0.12),
                            .bg = bg,
                        });
                    }
                }
            }
        }

        if (options.colors.len > 0) {
            const ramp = Gradient.init(options.colors);
            blitRamp(s, &canvas, ramp, h, bg);
        } else {
            blitFlat(s, &canvas, c, bg);
        }
    }
}

/// Copy a Braille canvas onto a surface in one flat color.
pub fn blitFlat(s: Surface, canvas: *const BrailleCanvas, c: Color, bg: ?Color) void {
    for (0..canvas.rows) |row| {
        for (0..canvas.cols) |col| {
            const value = canvas.cell(col, row);
            if (value == 0) continue;
            s.char(@intCast(col), @intCast(row), value, .{ .fg = c, .bg = bg });
        }
    }
}

/// Copy a Braille canvas onto a surface, coloring each row along a ramp.
pub fn blitRamp(
    s: Surface,
    canvas: *const BrailleCanvas,
    ramp: Gradient,
    height: usize,
    bg: ?Color,
) void {
    const denom: f64 = @floatFromInt(@max(1, height -| 1));
    for (0..canvas.rows) |row| {
        const c = ramp.sample(1 - @as(f64, @floatFromInt(row)) / denom);
        for (0..canvas.cols) |col| {
            const value = canvas.cell(col, row);
            if (value == 0) continue;
            s.char(@intCast(col), @intCast(row), value, .{ .fg = c, .bg = bg });
        }
    }
}

pub const SparklineOptions = struct {
    color: ?Color = null,
    colors: []const Color = &.{},
    min: ?f64 = null,
    max: ?f64 = null,
    background: ?Color = null,
    mode: FillMode = .block,
};

/// A single-row trend line. Cheap enough to put in a table cell.
pub fn sparkline(s: Surface, values: []const f64, options: SparklineOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const w = s.width();
    const one = [_]Series{.{ .values = tail(values, w) }};
    const bounds = extent(&one, .{ .min = options.min, .max = options.max }, w);
    const span = bounds.max - bounds.min;
    const ramp: ?Gradient = if (options.colors.len > 0) Gradient.init(options.colors) else null;
    const c = options.color orelse theme.accent;

    const count = @min(values.len, w);
    const start = values.len - count;
    const offset = w - count;
    for (0..count) |i| {
        const v = values[start + i];
        if (std.math.isNan(v) or std.math.isInf(v)) continue;
        const ratio = clamp01((v - bounds.min) / span);
        s.glyph(
            @intCast(offset + i),
            0,
            firstCodepoint(blocks.verticalGlyph(ratio, options.mode)),
            .{ .fg = if (ramp) |r| r.sample(ratio) else c, .bg = options.background },
        );
    }
}

/// How a horizontal bar's fill is drawn.
pub const BarStyle = enum {
    smooth,
    /// Discrete ticks with gaps, so stacked bars stay separable. The btop look.
    segmented,
    ascii,

    pub fn parse(name: []const u8) BarStyle {
        if (std.mem.eql(u8, name, "segmented")) return .segmented;
        if (std.mem.eql(u8, name, "ascii")) return .ascii;
        return .smooth;
    }
};

pub const BarOptions = struct {
    /// 0-1. Values outside are clamped.
    value: f64 = 0,
    color: ?Color = null,
    /// Color by fill level using the theme heat ramp.
    heat: ?bool = null,
    track: ?Color = null,
    background: ?Color = null,
    style: BarStyle = .smooth,
    track_char: ?u21 = null,
};

/// A horizontal bar filling the surface's first row.
pub fn bar(s: Surface, options: BarOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const w = s.width();
    const ratio = clamp01(options.value);
    const track_color = options.track orelse theme.background.mix(theme.border, 0.8);
    const heat: ?Gradient = if (options.heat orelse false) Gradient.init(theme.heat) else null;
    const c = options.color orelse theme.primary;

    const default_track: u21 = switch (options.style) {
        .ascii => '-',
        .segmented => '▮',
        .smooth => '─',
    };
    const fill_char: u21 = switch (options.style) {
        .ascii => '#',
        .segmented => '▮',
        .smooth => '█',
    };
    const track_char = options.track_char orelse default_track;

    const filled = ratio * @as(f64, @floatFromInt(w));
    const full: i64 = @intFromFloat(@floor(filled));

    for (0..w) |xi| {
        const x: i64 = @intCast(xi);
        if (x < full) {
            const t: f64 = if (w <= 1)
                ratio
            else
                @as(f64, @floatFromInt(xi)) / @as(f64, @floatFromInt(w - 1));
            s.glyph(@intCast(xi), 0, fill_char, .{
                .fg = if (heat) |g| g.sample(t) else c,
                .bg = options.background,
            });
        } else if (x == full and options.style != .segmented) {
            const glyph = blocks.horizontalGlyph(
                filled - @floor(filled),
                if (options.style == .ascii) .ascii else .block,
            );
            const blank = std.mem.eql(u8, glyph, " ");
            const fg = if (blank)
                track_color
            else if (heat) |g| g.sample(ratio) else c;
            s.glyph(
                @intCast(xi),
                0,
                if (blank) track_char else firstCodepoint(glyph),
                .{ .fg = fg, .bg = options.background },
            );
        } else {
            s.glyph(@intCast(xi), 0, track_char, .{
                .fg = track_color,
                .bg = options.background,
            });
        }
    }
}

pub const GaugeOptions = struct {
    value: f64 = 0,
    color: ?Color = null,
    background: ?Color = null,
    label: []const u8 = "",
    heat: ?bool = null,
};

/// A semicircular dial drawn with Braille. Needs about 9x5 cells to look right.
pub fn gauge(allocator: std.mem.Allocator, s: Surface, options: GaugeOptions) !void {
    if (s.isEmpty() or s.height() < 3) {
        bar(s, .{ .value = options.value, .color = options.color, .heat = options.heat });
        return;
    }
    const theme = s.theme;
    const ratio = clamp01(options.value);

    var canvas = try BrailleCanvas.init(allocator, s.width(), s.height());
    defer canvas.deinit();

    const cx = @as(f64, @floatFromInt(canvas.width)) / 2;
    const cy = @as(f64, @floatFromInt(canvas.height)) - 2;
    const radius = @min(
        @as(f64, @floatFromInt(canvas.width)) / 2 - 1,
        @as(f64, @floatFromInt(canvas.height)) - 3,
    );
    const heat = Gradient.init(theme.heat);
    const steps: i64 = @intFromFloat(@max(24, roundHalfUp(radius * 4)));

    var i: i64 = 0;
    while (i <= steps) : (i += 1) {
        const t = @as(f64, @floatFromInt(i)) / @as(f64, @floatFromInt(steps));
        const angle = std.math.pi * (1 - t);
        const x = cx + @cos(angle) * radius;
        const y = cy - @sin(angle) * radius * 0.85;
        if (t <= ratio) {
            canvas.pixel(x, y);
            canvas.pixel(x, y - 1);
        }
    }

    const c = options.color orelse
        (if (options.heat) |on| (if (on) heat.sample(ratio) else theme.primary) else heat.sample(ratio));
    blitFlat(s, &canvas, c, options.background);

    // Unfilled remainder of the dial, dimmed.
    var rest = try BrailleCanvas.init(allocator, s.width(), s.height());
    defer rest.deinit();
    i = 0;
    while (i <= steps) : (i += 1) {
        const t = @as(f64, @floatFromInt(i)) / @as(f64, @floatFromInt(steps));
        if (t <= ratio) continue;
        const angle = std.math.pi * (1 - t);
        rest.pixel(cx + @cos(angle) * radius, cy - @sin(angle) * radius * 0.85);
    }
    blitFlat(s, &rest, theme.background.mix(theme.border, 0.9), options.background);

    if (options.label.len > 0) {
        s.textAligned(@intCast(s.height() - 1), options.label, .center, .{
            .fg = c,
            .attrs = .bold_only,
        });
    }
}

pub const DonutSegment = struct {
    value: f64 = 0,
    color: ?Color = null,
    label: []const u8 = "",
};

pub const DonutOptions = struct {
    segments: []const DonutSegment = &.{},
    background: ?Color = null,
};

/// A ring chart. Reads well from about 12x6 cells.
pub fn donut(allocator: std.mem.Allocator, s: Surface, options: DonutOptions) !void {
    if (s.isEmpty()) return;
    const theme = s.theme;

    var total: f64 = 0;
    for (options.segments) |seg| total += @max(0, seg.value);
    if (total == 0) total = 1;

    var canvas = try BrailleCanvas.init(allocator, s.width(), s.height());
    defer canvas.deinit();

    // One color per *cell*, so the ring's segments stay separable after the
    // pixels are folded down into glyphs. The other ports use a hash map keyed
    // by cell; a flat array is the same thing without the hashing.
    const cell_colors = try allocator.alloc(?Color, canvas.cols * canvas.rows);
    defer allocator.free(cell_colors);
    @memset(cell_colors, null);

    const cx = @as(f64, @floatFromInt(canvas.width)) / 2;
    const cy = @as(f64, @floatFromInt(canvas.height)) / 2;
    const outer = @min(
        @as(f64, @floatFromInt(canvas.width)) / 2,
        @as(f64, @floatFromInt(canvas.height)) / 2,
    ) - 1;
    const inner = outer * 0.55;

    var angle: f64 = -std.math.pi / 2.0;
    for (options.segments, 0..) |seg, si| {
        const sweep = @max(0, seg.value) / total * std.math.pi * 2;
        const c = seg.color orelse theme_mod.seriesColor(theme.*, @intCast(si));
        const steps: i64 = @intFromFloat(@max(8, roundHalfUp(sweep * outer * 3)));

        var st: i64 = 0;
        while (st <= steps) : (st += 1) {
            const a = angle + sweep * @as(f64, @floatFromInt(st)) / @as(f64, @floatFromInt(steps));
            var r = inner;
            while (r <= outer) : (r += 0.4) {
                const x = roundHalfUp(cx + @cos(a) * r);
                const y = roundHalfUp(cy + @sin(a) * r * 0.9);
                canvas.pixel(x, y);
                const col = @as(i64, @intFromFloat(x)) >> 1;
                const row = @as(i64, @intFromFloat(y)) >> 2;
                if (col >= 0 and row >= 0 and
                    col < @as(i64, @intCast(canvas.cols)) and
                    row < @as(i64, @intCast(canvas.rows)))
                {
                    cell_colors[@intCast(row * @as(i64, @intCast(canvas.cols)) + col)] = c;
                }
            }
        }
        angle += sweep;
    }

    for (0..canvas.rows) |row| {
        for (0..canvas.cols) |col| {
            const value = canvas.cell(col, row);
            if (value == 0) continue;
            s.char(@intCast(col), @intCast(row), value, .{
                .fg = cell_colors[row * canvas.cols + col] orelse theme.muted,
                .bg = options.background,
            });
        }
    }
}

pub const HistogramOptions = struct {
    values: []const f64 = &.{},
    color: ?Color = null,
    colors: []const Color = &.{},
    background: ?Color = null,
    max: ?f64 = null,
};

/// Vertical column chart, one column per value, newest on the right.
pub fn histogram(allocator: std.mem.Allocator, s: Surface, options: HistogramOptions) !void {
    const one = [_]Series{.{ .values = options.values }};
    try plot(allocator, s, &one, .{
        .mode = .block,
        .color = options.color,
        .colors = options.colors,
        .background = options.background,
        .max = options.max,
        .min = 0,
    });
}
