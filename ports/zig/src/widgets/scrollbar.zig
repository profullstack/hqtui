//! A scrollbar, on its own.
//!
//! The renderer used to live inside the table and was reachable only by being a
//! table, list, tree or log. Anything else that scrolls — a wrapped paragraph, a
//! canvas, a `draw()` somebody wrote themselves — could not show one.
//!
//! This is the same drawing, lifted out and given the four edges plus state the
//! caller owns. The dense widgets route through it, so there is one
//! implementation and one appearance.

const std = @import("std");

const buffer_mod = @import("../buffer.zig");
const color_mod = @import("../color.zig");
const surface_mod = @import("../surface.zig");

const Style = buffer_mod.Style;
const Surface = surface_mod.Surface;
const roundHalfUp = color_mod.roundHalfUp;

/// Which edge the bar sits on, and therefore which way it runs.
pub const ScrollbarOrientation = enum {
    right,
    left,
    bottom,
    top,

    pub fn isVertical(self: ScrollbarOrientation) bool {
        return self == .right or self == .left;
    }
};

/// How much there is, how much of it is visible, and how far through it we are
/// — the state the caller owns.
pub const ScrollbarOptions = struct {
    total: usize = 0,
    viewport: usize = 0,
    offset: usize = 0,
    orientation: ScrollbarOrientation = .right,
};

pub const Thumb = struct { start: usize, size: usize };

/// Where the thumb sits and how long it is, in cells along the track.
///
/// Split out because it is the whole of the behaviour: everything else is
/// putting characters in a line. A thumb is never shorter than one cell, or it
/// would vanish on a long document, and never starts past the end of the track.
///
/// The thumb is as long as the visible fraction, so it needs the viewport as
/// well as the track. For a table those are the same number — the bar is
/// exactly as tall as the rows it describes. A bar you place yourself has no
/// such guarantee, so pass the window it describes; `thumbOf` keeps the
/// track-is-the-viewport form the dense widgets use.
pub fn thumb(track: usize, total: usize, offset: usize, viewport: usize) Thumb {
    if (track == 0 or total == 0) return .{ .start = 0, .size = 0 };
    const visible = if (viewport > 0) viewport else track;
    if (total <= visible) return .{ .start = 0, .size = track };

    const ft: f64 = @floatFromInt(track);
    const scaled: i64 = @intFromFloat(roundHalfUp(
        @as(f64, @floatFromInt(visible)) / @as(f64, @floatFromInt(total)) * ft,
    ));
    const size: usize = @min(track, @as(usize, @intCast(@max(1, scaled))));
    const max_offset: usize = @max(1, total - visible);
    const clamped = @min(offset, max_offset);
    const start: i64 = @intFromFloat(roundHalfUp(
        @as(f64, @floatFromInt(clamped)) / @as(f64, @floatFromInt(max_offset)) *
            @as(f64, @floatFromInt(track - size)),
    ));
    return .{
        .start = @intCast(std.math.clamp(start, 0, @as(i64, @intCast(track - size)))),
        .size = size,
    };
}

/// The original signature, kept because the table, list, tree and log all call
/// it this way and their fixtures pin the result.
/// `thumb` for a bar whose track is exactly the window it describes.
pub fn thumbOf(track: usize, total: usize, offset: usize) Thumb {
    return thumb(track, total, offset, track);
}

pub fn drawScrollbar(
    s: Surface,
    x: isize,
    y: isize,
    height: usize,
    total: usize,
    offset: usize,
) void {
    const theme = s.theme;
    const track = theme.background.mix(theme.border, 0.7);
    const t = thumbOf(height, total, offset);

    for (0..height) |i| {
        const in_thumb = i >= t.start and i < t.start + t.size;
        s.glyph(
            x,
            y + @as(isize, @intCast(i)),
            if (in_thumb) '█' else '│',
            .{ .fg = if (in_thumb) theme.accent else track },
        );
    }
}

/// A scrollbar filling the surface it is given, on whichever edge.
///
/// A horizontal bar uses the half-height glyphs rather than the full block: a
/// run of full blocks across a row reads as a solid rule, which is not what a
/// thumb is meant to look like.
pub fn drawScrollbarWidget(s: Surface, options: ScrollbarOptions) void {
    if (s.width() == 0 or s.height() == 0) return;
    const vertical = options.orientation.isVertical();
    const theme = s.theme;
    const track_color = theme.background.mix(theme.border, 0.7);

    const length = if (vertical) s.height() else s.width();
    const viewport = if (options.viewport > 0) options.viewport else length;
    const t = thumb(length, options.total, options.offset, viewport);

    const line: isize = if (vertical)
        (if (options.orientation == .right) @as(isize, @intCast(s.width())) - 1 else 0)
    else
        (if (options.orientation == .bottom) @as(isize, @intCast(s.height())) - 1 else 0);

    for (0..length) |i| {
        const in_thumb = i >= t.start and i < t.start + t.size;
        const glyph: u21 = if (vertical)
            (if (in_thumb) '█' else '│')
        else
            (if (in_thumb) '━' else '─');
        const style = Style{ .fg = if (in_thumb) theme.accent else track_color };
        const at: isize = @intCast(i);
        if (vertical) s.glyph(line, at, glyph, style) else s.glyph(at, line, glyph, style);
    }
}

/// Which offset a click at `position` along the track means.
///
/// The thumb centres on the click, which is what every scrollbar does and what
/// makes dragging feel like dragging rather than nudging.
pub fn offsetForPosition(position: usize, track: usize, total: usize, viewport: usize) usize {
    const visible = if (viewport > 0) viewport else track;
    if (track == 0 or total <= visible) return 0;
    const t = thumb(track, total, 0, visible);
    const usable: usize = @max(1, track -| t.size);
    const at = @min(position -| (t.size / 2), usable);
    return @intFromFloat(roundHalfUp(
        @as(f64, @floatFromInt(at)) / @as(f64, @floatFromInt(usable)) *
            @as(f64, @floatFromInt(total - visible)),
    ));
}
