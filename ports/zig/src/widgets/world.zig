//! A world map you can click.
//!
//! The drawing is the canvas doing what it already does -- polylines in the
//! caller's own coordinates, which for a map are degrees. What this adds is the
//! other direction: turning a click back into a country.

const std = @import("std");

const canvas_mod = @import("../graphics/canvas.zig");
const color_mod = @import("../color.zig");
const surface_mod = @import("../surface.zig");
const world = @import("../graphics/world.zig");

const Bounds = canvas_mod.Bounds;
const Color = color_mod.Color;
const CountryOutline = world.CountryOutline;
const Surface = surface_mod.Surface;

pub const WorldMapOptions = struct {
    /// The window on the globe. Null means all of it.
    x: ?Bounds = null,
    y: ?Bounds = null,
    /// Coastline colour.
    color: ?Color = null,
    /// Countries to pick out, by name or ISO code.
    highlight: []const []const u8 = &.{},
    highlight_color: ?Color = null,
    background: ?Color = null,
    grid: bool = false,

    fn window(self: WorldMapOptions) struct { x: Bounds, y: Bounds } {
        return .{ .x = self.x orelse world.WORLD_X, .y = self.y orelse world.WORLD_Y };
    }
};

pub fn drawWorldMap(
    allocator: std.mem.Allocator,
    s: Surface,
    options: WorldMapOptions,
) !void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const shapes = try world.worldShapes(allocator, .{
        .color = options.color orelse theme.border,
        .highlight = options.highlight,
        .highlight_color = options.highlight_color orelse theme.accent,
    });
    defer world.freeShapes(allocator, shapes);

    const win = options.window();
    try canvas_mod.drawCanvas(allocator, s, .{
        .shapes = shapes,
        .x = win.x,
        .y = win.y,
        .background = options.background,
        .grid = options.grid,
    });
}

/// The country under a cell of a map drawn with these bounds.
///
/// Exposed so a caller can answer a hover as well as a click, and so the
/// arithmetic that has to agree with the drawing lives in one place.
pub fn countryAtCell(
    column: usize,
    row: usize,
    width: usize,
    height: usize,
    options: WorldMapOptions,
) ?CountryOutline {
    const win = options.window();
    const at = world.degreesAt(column, row, width, height, win.x, win.y) orelse return null;
    return world.countryAt(at.lon, at.lat);
}
