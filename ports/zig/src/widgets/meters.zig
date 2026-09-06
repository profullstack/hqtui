//! Meters, gauges, graphs and the rest of the "how full is it" family.

const std = @import("std");

const blocks = @import("../graphics/blocks.zig");
const buffer_mod = @import("../buffer.zig");
const color_mod = @import("../color.zig");
const plot_mod = @import("../graphics/plot.zig");
const surface_mod = @import("../surface.zig");
const theme_mod = @import("../theme.zig");
const unicode = @import("../unicode.zig");

const Align = unicode.Align;
const Attrs = buffer_mod.Attrs;
const BarOptions = plot_mod.BarOptions;
const BarStyle = plot_mod.BarStyle;
const Color = color_mod.Color;
const Gradient = color_mod.Gradient;
const PlotOptions = plot_mod.PlotOptions;
const Series = plot_mod.Series;
const Style = buffer_mod.Style;
const Surface = surface_mod.Surface;
const TextOptions = surface_mod.TextOptions;
const roundHalfUp = color_mod.roundHalfUp;

pub const drawGauge = plot_mod.gauge;
pub const drawDonut = plot_mod.donut;
pub const GaugeOptions = plot_mod.GaugeOptions;
pub const DonutOptions = plot_mod.DonutOptions;
pub const DonutSegment = plot_mod.DonutSegment;

/// A 0-1 ratio. Ordered so NaN falls through to 0 — `min`/`max` propagate it in
/// the reference, which rendered "NaN%" in black on black.
pub fn clampRatio(value: f64) f64 {
    if (value > 1) return 1;
    if (value > 0) return value;
    return 0;
}

pub const MeterOptions = struct {
    /// 0-1, or supply `max` and pass an absolute value.
    value: f64 = 0,
    max: ?f64 = null,
    label: []const u8 = "",
    /// Right-hand readout. Null means a percentage.
    text: ?[]const u8 = null,
    label_width: ?usize = null,
    value_width: ?usize = null,
    color: ?Color = null,
    /// Green-to-red by fill level. Null means on unless `color` is set.
    heat: ?bool = null,
    background: ?Color = null,
    style: BarStyle = .smooth,
    show_value: bool = true,
};

/// `label ████████░░░░ 42%` on a single row. The most-used widget here.
pub fn drawMeter(s: Surface, options: MeterOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;

    // 0 and NaN are both falsy in the reference, which then treats `value` as an
    // already-normalised ratio instead of dividing by them.
    const ratio = clampRatio(blk: {
        const m = options.max orelse break :blk options.value;
        if (m == 0 or std.math.isNan(m)) break :blk options.value;
        break :blk options.value / m;
    });

    const label_width: usize = if (options.label.len == 0)
        0
    else
        options.label_width orelse unicode.stringWidth(options.label) + 1;

    var percent_buf: [16]u8 = undefined;
    const value_text: []const u8 = if (!options.show_value)
        ""
    else
        options.text orelse (std.fmt.bufPrint(
            &percent_buf,
            "{d}%",
            .{@as(i64, @intFromFloat(roundHalfUp(ratio * 100)))},
        ) catch "");

    const value_width: usize = if (value_text.len == 0)
        0
    else
        options.value_width orelse unicode.stringWidth(value_text) + 1;

    const bar_width = s.width() -| label_width -| value_width;

    if (label_width > 0) {
        var cut: [256]u8 = undefined;
        var padded: [256]u8 = undefined;
        const shown = unicode.fit(
            &padded,
            unicode.truncate(&cut, options.label, label_width),
            label_width,
            .left,
        );
        _ = s.text(0, 0, shown, .{ .fg = theme.muted, .bg = options.background });
    }
    if (bar_width > 0) {
        plot_mod.bar(s.sub(@intCast(label_width), 0, bar_width, 1), .{
            .value = ratio,
            .color = options.color,
            .heat = options.heat orelse (options.color == null),
            .background = options.background,
            .style = options.style,
        });
    }
    if (value_width > 0) {
        var padded: [64]u8 = undefined;
        const shown = unicode.fit(&padded, value_text, value_width, .right);
        const fg = options.color orelse blk: {
            if (options.heat) |on| {
                if (!on) break :blk theme.foreground;
            }
            break :blk theme_mod.heatColor(theme.*, ratio);
        };
        _ = s.text(
            @as(isize, @intCast(s.width())) - @as(isize, @intCast(value_width)),
            0,
            shown,
            .{ .fg = fg, .bg = options.background, .attrs = .bold_only },
        );
    }
}

pub const MeterItem = struct {
    label: []const u8 = "",
    value: f64 = 0,
    max: ?f64 = null,
    color: ?Color = null,
    text: ?[]const u8 = null,
};

pub const MetersOptions = struct {
    items: []const MeterItem = &.{},
    label_width: ?usize = null,
    value_width: ?usize = null,
    heat: ?bool = null,
    background: ?Color = null,
    style: BarStyle = .smooth,
    /// Lay out in N columns when there is room, like btop's core grid.
    columns: usize = 1,
    gap: usize = 2,
};

/// A stack (or grid) of meters — per-core CPU, per-disk usage, and so on.
pub fn drawMeters(s: Surface, options: MetersOptions) void {
    if (s.isEmpty()) return;
    const columns = @max(1, options.columns);
    const gap = options.gap;
    const col_width: isize = @intFromFloat(@floor(
        (@as(f64, @floatFromInt(s.width())) -
            @as(f64, @floatFromInt(gap * (columns - 1)))) / @as(f64, @floatFromInt(columns)),
    ));
    const per_column = (options.items.len + columns - 1) / columns;
    if (per_column == 0) return;

    for (options.items, 0..) |item, i| {
        const col = i / per_column;
        const row = i % per_column;
        if (row >= s.height() or col >= columns) continue;
        drawMeter(
            s.sub(
                @as(isize, @intCast(col)) * (col_width + @as(isize, @intCast(gap))),
                @intCast(row),
                @intCast(@max(0, col_width)),
                1,
            ),
            .{
                .value = item.value,
                .max = item.max,
                .label = item.label,
                .text = item.text,
                .color = item.color,
                .label_width = options.label_width,
                .value_width = options.value_width,
                .heat = options.heat,
                .background = options.background,
                .style = options.style,
            },
        );
    }
}

pub const ProgressOptions = struct {
    value: f64 = 0,
    max: ?f64 = null,
    label: []const u8 = "",
    color: ?Color = null,
    background: ?Color = null,
    /// Show `37/120` instead of a percentage.
    show_count: bool = false,
};

pub fn drawProgress(s: Surface, options: ProgressOptions) void {
    const maximum = options.max orelse 1;
    var count_buf: [32]u8 = undefined;
    const text: ?[]const u8 = if (options.show_count)
        (std.fmt.bufPrint(&count_buf, "{d}/{d}", .{
            @as(i64, @intFromFloat(roundHalfUp(options.value))),
            @as(i64, @intFromFloat(roundHalfUp(maximum))),
        }) catch null)
    else
        null;

    drawMeter(s, .{
        .value = options.value,
        .max = maximum,
        .label = options.label,
        .color = options.color orelse s.theme.primary,
        .heat = false,
        .background = options.background,
        .text = text,
    });
}

/// The axis label format the reference uses when none is given. Writes into
/// `buf` and returns the slice.
pub fn niceLabel(buf: []u8, value: f64) []const u8 {
    if (@abs(value) >= 1000) {
        return jsNumber(buf, roundHalfUp(value / 100) / 10, "k");
    }
    if (value == @trunc(value) and std.math.isFinite(value)) {
        return jsNumber(buf, value, "");
    }
    return std.fmt.bufPrint(buf, "{d:.1}", .{value}) catch "";
}

/// JavaScript's number-to-string: no trailing zeros, no decimal point when the
/// value is whole.
fn jsNumber(buf: []u8, value: f64, suffix: []const u8) []const u8 {
    if (value == @trunc(value) and std.math.isFinite(value)) {
        return std.fmt.bufPrint(buf, "{d}{s}", .{ @as(i64, @intFromFloat(value)), suffix }) catch "";
    }
    return std.fmt.bufPrint(buf, "{d}{s}", .{ value, suffix }) catch "";
}

pub const GraphOptions = struct {
    /// A single series; `series` is several and wins if both are set.
    values: []const f64 = &.{},
    series: ?[]const Series = null,
    plot: PlotOptions = .{},
    /// Draw min/max labels down the left edge.
    axis: bool = false,
    axis_color: ?Color = null,
    /// Time labels along the bottom, e.g. `.{ "60s", "30s", "0s" }`.
    time_axis: []const []const u8 = &.{},
    legend: bool = false,
    legend_align: Align = .left,
};

/// Line/area graph. Braille by default, so it reads at 2x4 the cell resolution.
pub fn drawGraph(allocator: std.mem.Allocator, s: Surface, options: GraphOptions) !void {
    if (s.isEmpty()) return;
    const theme = s.theme;

    const single = [_]Series{.{ .values = options.values }};
    const series = options.series orelse &single;

    var plot_surface = s;
    const axis_color = options.axis_color orelse theme.muted;

    if (options.axis) {
        // Match the window the plot itself will use, so the labels stay truthful.
        const columns = if (options.plot.mode == .braille) s.width() * 2 else s.width();
        var maximum: f64 = if (options.plot.max) |m| m else blk: {
            var found = false;
            var hi: f64 = 1;
            for (series) |sr| {
                for (plot_mod.tail(sr.values, columns)) |v| {
                    if (std.math.isNan(v) or std.math.isInf(v)) continue;
                    if (!found or v > hi) {
                        hi = v;
                        found = true;
                    }
                }
            }
            break :blk if (found) hi else 1;
        };
        if (std.math.isNan(maximum)) maximum = 1;
        const minimum: f64 = options.plot.min orelse 0;

        var max_buf: [32]u8 = undefined;
        var min_buf: [32]u8 = undefined;
        const max_label = niceLabel(&max_buf, maximum);
        const min_label = niceLabel(&min_buf, minimum);
        const label_width = @max(
            unicode.stringWidth(max_label),
            unicode.stringWidth(min_label),
        ) + 1;

        var padded: [64]u8 = undefined;
        _ = s.text(0, 0, unicode.fit(&padded, max_label, label_width, .right), .{ .fg = axis_color });
        if (s.height() > 1) {
            var padded_min: [64]u8 = undefined;
            _ = s.text(
                0,
                @intCast(s.height() - 1),
                unicode.fit(&padded_min, min_label, label_width, .right),
                .{ .fg = axis_color },
            );
        }
        plot_surface = s.sub(@intCast(label_width), 0, s.width() -| label_width, s.height());
    }

    var graph_surface = plot_surface;
    if (options.time_axis.len > 0 and plot_surface.height() > 1) {
        graph_surface = plot_surface.sub(0, 0, plot_surface.width(), plot_surface.height() - 1);
        const step: f64 = if (options.time_axis.len > 1)
            @as(f64, @floatFromInt(plot_surface.width() - 1)) /
                @as(f64, @floatFromInt(options.time_axis.len - 1))
        else
            0;
        for (options.time_axis, 0..) |label, i| {
            const at: isize = @intFromFloat(roundHalfUp(@as(f64, @floatFromInt(i)) * step));
            const x = @min(
                @as(isize, @intCast(plot_surface.width())) -
                    @as(isize, @intCast(unicode.stringWidth(label))),
                at,
            );
            _ = plot_surface.text(
                @max(0, x),
                @intCast(plot_surface.height() - 1),
                label,
                .{ .fg = axis_color },
            );
        }
    }

    try plot_mod.plot(allocator, graph_surface, series, options.plot);

    if (options.legend) {
        var total: usize = 0;
        for (series) |sr| {
            if (sr.label.len > 0) total += unicode.stringWidth(sr.label) + 3;
        }
        var x: isize = if (options.legend_align == .right)
            @max(0, @as(isize, @intCast(graph_surface.width())) - @as(isize, @intCast(total)))
        else
            0;
        // Sit the legend on the last row when there is one to spare, so it never
        // lands on top of the plot's busiest corner.
        const y: isize = if (graph_surface.height() > 3)
            @intCast(graph_surface.height() - 1)
        else
            0;
        for (series, 0..) |sr, i| {
            if (sr.label.len == 0) continue;
            const c = sr.color orelse theme_mod.seriesColor(theme.*, @intCast(i));
            x += @intCast(graph_surface.text(x, y, "■ ", .{ .fg = c }));
            var label_buf: [128]u8 = undefined;
            const labelled = std.fmt.bufPrint(&label_buf, "{s} ", .{sr.label}) catch continue;
            x += @intCast(graph_surface.text(x, y, labelled, .{ .fg = theme.muted }));
        }
    }
}

pub const SparklineWidgetOptions = struct {
    values: []const f64 = &.{},
    color: ?Color = null,
    colors: []const Color = &.{},
    min: ?f64 = null,
    max: ?f64 = null,
    label: []const u8 = "",
    text: []const u8 = "",
    background: ?Color = null,
};

/// One-row trend, optionally with a label and a right-hand readout.
pub fn drawSparkline(s: Surface, options: SparklineWidgetOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const label_width: usize = if (options.label.len > 0)
        unicode.stringWidth(options.label) + 1
    else
        0;
    const value_width: usize = if (options.text.len > 0)
        unicode.stringWidth(options.text) + 1
    else
        0;

    if (options.label.len > 0) {
        _ = s.text(0, 0, options.label, .{ .fg = theme.muted, .bg = options.background });
    }
    const width: isize = @as(isize, @intCast(s.width())) -
        @as(isize, @intCast(label_width)) - @as(isize, @intCast(value_width));
    if (width > 0) {
        plot_mod.sparkline(
            s.sub(@intCast(label_width), 0, @intCast(width), 1),
            options.values,
            .{
                .color = options.color,
                .colors = options.colors,
                .min = options.min,
                .max = options.max,
                .background = options.background,
            },
        );
    }
    if (value_width > 0) {
        var padded: [64]u8 = undefined;
        _ = s.text(
            @as(isize, @intCast(s.width())) - @as(isize, @intCast(value_width)),
            0,
            unicode.fit(&padded, options.text, value_width, .right),
            .{
                .fg = options.color orelse theme.accent,
                .bg = options.background,
                .attrs = .bold_only,
            },
        );
    }
}

pub const HeatBarOptions = struct {
    /// 0-1. Renders like btop's temperature bars.
    value: f64 = 0,
    width: ?usize = null,
    color: ?Color = null,
    background: ?Color = null,
    char: u21 = '▮',
};

/// A segmented heat bar: discrete ticks colored along the theme ramp.
pub fn drawHeatBar(s: Surface, options: HeatBarOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const ratio = blocks.clamp01(options.value);
    const width = @min(options.width orelse s.width(), s.width());
    const filled: usize = @intFromFloat(roundHalfUp(ratio * @as(f64, @floatFromInt(width))));
    const ramp = Gradient.init(theme.heat);
    const off = theme.background.mix(theme.border, 0.75);

    for (0..width) |x| {
        const fg = if (x < filled)
            (options.color orelse ramp.sample(if (width <= 1)
                ratio
            else
                @as(f64, @floatFromInt(x)) / @as(f64, @floatFromInt(width - 1))))
        else
            off;
        s.glyph(@intCast(x), 0, options.char, .{ .fg = fg, .bg = options.background });
    }
}

pub const ColumnsOptions = struct {
    values: []const f64 = &.{},
    color: ?Color = null,
    colors: []const Color = &.{},
    max: ?f64 = null,
    background: ?Color = null,
};

/// Block-mode column chart. Cheaper than Braille and reads well when short.
pub fn drawColumns(s: Surface, options: ColumnsOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const maximum = options.max orelse blk: {
        var hi: f64 = 1;
        for (options.values) |v| {
            if (v > hi) hi = v;
        }
        break :blk hi;
    };
    const ramp: ?Gradient = if (options.colors.len > 0) Gradient.init(options.colors) else null;
    const count = @min(options.values.len, s.width());
    const start = options.values.len - count;
    const h = s.height();

    for (0..count) |i| {
        const ratio = blocks.clamp01(options.values[start + i] / maximum);
        const filled = ratio * @as(f64, @floatFromInt(h));
        const full: usize = @intFromFloat(@floor(filled));
        const c = if (ramp) |r| r.sample(ratio) else (options.color orelse theme.primary);
        const style: Style = .{ .fg = c, .bg = options.background };

        for (0..full) |k| {
            s.glyph(@intCast(i), @as(isize, @intCast(h)) - 1 - @as(isize, @intCast(k)), '█', style);
        }
        if (full < h) {
            const glyph = blocks.verticalGlyph(filled - @floor(filled), .block);
            if (!std.mem.eql(u8, glyph, " ")) {
                s.glyph(
                    @intCast(i),
                    @as(isize, @intCast(h)) - 1 - @as(isize, @intCast(full)),
                    blocks.firstCodepoint(glyph),
                    style,
                );
            }
        }
    }
}
