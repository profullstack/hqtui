//! A drop shadow cast by a region onto whatever is behind it.
//!
//! The point is that it dims what it covers rather than painting over it: a
//! shadow that filled its band with a flat colour would erase the dashboard
//! underneath, which is the opposite of what a shadow is for. Every covered cell
//! keeps its own character and its own hue, and only loses some of its light.

const std = @import("std");

const buffer_mod = @import("../buffer.zig");
const color_mod = @import("../color.zig");
const layout = @import("../layout.zig");
const surface_mod = @import("../surface.zig");

const Color = color_mod.Color;
const Rect = layout.Rect;
const Style = buffer_mod.Style;
const Surface = surface_mod.Surface;

pub const ShadowOptions = struct {
    /// How far the shadow falls.
    offset_x: isize = 1,
    offset_y: isize = 1,
    /// 0-1: how much light the covered cells lose.
    amount: f64 = 0.55,
    /// Paint this colour instead of dimming what is underneath.
    ///
    /// For a shadow falling on empty background, where there is nothing to dim
    /// and a flat colour is cheaper and reads the same.
    color: ?Color = null,
};

/// Darken every cell in a region, keeping its character and its hue.
///
/// Towards black rather than towards the theme's background: on a light theme
/// the background *is* the light, so dimming towards it would make the shadow
/// brighter than the page it falls on.
pub fn dimRect(s: Surface, x: isize, y: isize, width: usize, height: usize, amount: f64) void {
    const t = std.math.clamp(amount, 0, 1);
    const black = Color.rgb(0, 0, 0);
    for (0..height) |row| {
        for (0..width) |col| {
            const ax = s.rect.x + x + @as(isize, @intCast(col));
            const ay = s.rect.y + y + @as(isize, @intCast(row));
            if (ax < s.clip.x or ay < s.clip.y or
                ax >= s.clip.x + @as(isize, @intCast(s.clip.width)) or
                ay >= s.clip.y + @as(isize, @intCast(s.clip.height))) continue;
            const i = s.buffer.index(@intCast(ax), @intCast(ay));
            s.buffer.fg[i] = s.buffer.fg[i].mix(black, t);
            s.buffer.bg[i] = s.buffer.bg[i].mix(black, t);
        }
    }
}

/// Cast a shadow from `rect` onto `s`.
///
/// The shadow is the band the region would cover if it were moved by the offset,
/// minus the region itself. Drawn before the region is, so it never falls on top
/// of it.
pub fn drawShadow(s: Surface, rect: Rect, options: ShadowOptions) void {
    if (s.isEmpty()) return;
    const dx = options.offset_x;
    const dy = options.offset_y;
    if (dx == 0 and dy == 0) return;

    const paint = struct {
        fn go(sf: Surface, o: ShadowOptions, x: isize, y: isize, w: isize, h: isize) void {
            if (w <= 0 or h <= 0) return;
            if (o.color) |c| {
                sf.fillRect(x, y, @intCast(w), @intCast(h), .{ .bg = c }, 32);
            } else {
                dimRect(sf, x, y, @intCast(w), @intCast(h), o.amount);
            }
        }
    }.go;

    // The shadow is the moved region minus the original, which splits into two
    // rectangles that do not touch: the rows the move added, at the moved
    // region's full width, and then the columns it added over the rows the two
    // still share. Cutting it any other way overlaps at the corner, and a corner
    // dimmed twice reads as a smudge rather than an edge.
    const rw: isize = @intCast(rect.width);
    const rh: isize = @intCast(rect.height);
    const tx = rect.x + dx;
    const ty = rect.y + dy;
    if (dy > 0) {
        paint(s, options, tx, rect.y + rh, rw, dy);
    } else if (dy < 0) {
        paint(s, options, tx, ty, rw, -dy);
    }

    const y0 = @max(rect.y, ty);
    const shared = @min(rect.y + rh, ty + rh) - y0;
    if (shared > 0) {
        if (dx > 0) {
            paint(s, options, rect.x + rw, y0, dx, shared);
        } else if (dx < 0) {
            paint(s, options, tx, y0, -dx, shared);
        }
    }
}
