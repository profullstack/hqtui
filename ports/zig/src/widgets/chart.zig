//! A chart with two real axes.
//!
//! `graph` plots a history buffer: one sample per column, x meaning "position
//! in the slice". This plots data that has its own x values, with a labelled
//! domain on both axes, so two series of different lengths line up and a point
//! lands where its x says it does.

const std = @import("std");

const chart_mod = @import("../graphics/chart.zig");
const color_mod = @import("../color.zig");
const meters = @import("meters.zig");
const surface_mod = @import("../surface.zig");
const theme_mod = @import("../theme.zig");
const unicode = @import("../unicode.zig");

const AxisOptions = chart_mod.AxisOptions;
const ChartPlotOptions = chart_mod.ChartPlotOptions;
const ChartSeries = chart_mod.ChartSeries;
const Color = color_mod.Color;
const Surface = surface_mod.Surface;
const roundHalfUp = color_mod.roundHalfUp;
const seriesColor = theme_mod.seriesColor;

pub const ChartOptions = struct {
    series: []const ChartSeries = &.{},
    plot: ChartPlotOptions = .{},
    /// Numbers down the left edge.
    axis: bool = false,
    axis_color: ?Color = null,
    legend: bool = false,
    legend_align: unicode.Align = .left,
};

/// One evenly spaced tick value, ends included.
///
/// Two ticks means the ends and nothing else, which is what an axis wants when
/// there is no room to say more.
fn tickAt(min: f64, max: f64, i: usize, count: usize) f64 {
    const n = @max(2, count);
    return min + (max - min) * @as(f64, @floatFromInt(i)) / @as(f64, @floatFromInt(n - 1));
}

fn formatWith(axis: ?AxisOptions, buf: []u8, value: f64) []const u8 {
    if (axis) |a| {
        if (a.format) |format| return format(value, buf);
    }
    return meters.niceLabel(buf, value);
}

pub fn drawChart(allocator: std.mem.Allocator, s: Surface, options: ChartOptions) !void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const axis_color = options.axis_color orelse theme.muted;

    const xd = chart_mod.domainOf(options.series, options.plot.x, 0);
    const yd = chart_mod.domainOf(options.series, options.plot.y, 1);

    // The x labels take a row, and they can only take one when there is a row
    // to spare -- a two-row chart is all plot.
    var x_ticks: usize = if (options.axis) 2 else 0;
    if (options.plot.x) |a| {
        if (a.ticks > 0) x_ticks = a.ticks;
    }
    const want_x_axis = options.axis and x_ticks >= 2 and s.height() > 2;

    var plot_surface = s;
    if (options.axis) {
        var hi_buf: [32]u8 = undefined;
        var lo_buf: [32]u8 = undefined;
        const hi = formatWith(options.plot.y, &hi_buf, yd.max);
        const lo = formatWith(options.plot.y, &lo_buf, yd.min);
        const width = @max(unicode.stringWidth(hi), unicode.stringWidth(lo)) + 1;

        var padded: [64]u8 = undefined;
        _ = s.text(0, 0, unicode.fit(&padded, hi, width, .right), .{ .fg = axis_color });
        if (s.height() > 1) {
            var padded_lo: [64]u8 = undefined;
            // The minimum marks the bottom of the plot, which is a row higher
            // when the x labels have taken the last one.
            const bottom: isize = if (want_x_axis)
                @intCast(s.height() - 2)
            else
                @intCast(s.height() - 1);
            _ = s.text(0, bottom, unicode.fit(&padded_lo, lo, width, .right), .{ .fg = axis_color });
        }
        plot_surface = s.sub(@intCast(width), 0, s.width() -| width, s.height());
    }

    var area = plot_surface;
    if (want_x_axis and plot_surface.height() > 1 and plot_surface.width() > 0) {
        area = plot_surface.sub(0, 0, plot_surface.width(), plot_surface.height() - 1);
        const row: isize = @intCast(plot_surface.height() - 1);
        const step: f64 = if (x_ticks > 1)
            @as(f64, @floatFromInt(plot_surface.width() - 1)) / @as(f64, @floatFromInt(x_ticks - 1))
        else
            0;
        for (0..x_ticks) |i| {
            var buf: [32]u8 = undefined;
            const label = formatWith(options.plot.x, &buf, tickAt(xd.min, xd.max, i, x_ticks));
            // The last label is right-aligned to the edge, so it cannot run off it.
            const at: isize = @intFromFloat(roundHalfUp(@as(f64, @floatFromInt(i)) * step));
            const limit: isize = @as(isize, @intCast(plot_surface.width())) -
                @as(isize, @intCast(unicode.stringWidth(label)));
            _ = plot_surface.text(@max(0, @min(at, limit)), row, label, .{ .fg = axis_color });
        }
    }

    // The domain is resolved once and handed down, so the labels and the marks
    // cannot disagree about what the axis spans.
    var plot = options.plot;
    var x_axis = options.plot.x orelse AxisOptions{};
    x_axis.min = xd.min;
    x_axis.max = xd.max;
    var y_axis = options.plot.y orelse AxisOptions{};
    y_axis.min = yd.min;
    y_axis.max = yd.max;
    plot.x = x_axis;
    plot.y = y_axis;
    try chart_mod.plotPoints(allocator, area, options.series, plot);

    if (options.legend) {
        var total: usize = 0;
        for (options.series) |cs| {
            if (cs.label.len > 0) total += unicode.stringWidth(cs.label) + 3;
        }
        var x: isize = if (options.legend_align == .right)
            @max(0, @as(isize, @intCast(area.width())) - @as(isize, @intCast(total)))
        else
            0;
        const y: isize = if (area.height() > 3) @intCast(area.height() - 1) else 0;
        for (options.series, 0..) |cs, i| {
            if (cs.label.len == 0) continue;
            const color = cs.color orelse seriesColor(theme.*, @intCast(i));
            x += @intCast(area.text(x, y, "■ ", .{ .fg = color }));
            var buf: [128]u8 = undefined;
            const label = std.fmt.bufPrint(&buf, "{s} ", .{cs.label}) catch cs.label;
            x += @intCast(area.text(x, y, label, .{ .fg = theme.muted }));
        }
    }
}
