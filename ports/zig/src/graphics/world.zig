//! The world, as shapes for the canvas, and the lookup that makes it clickable.
//!
//! The canvas already draws in the caller's own coordinates, and longitude and
//! latitude are just another pair of axes -- so a map is a list of polylines in
//! degrees, and nothing here needs a projection of its own beyond deciding
//! which window on the globe to show.
//!
//! The interesting half is the other direction. A click arrives as a terminal
//! cell, and a country is a polygon, so answering "what did they click" means
//! turning the cell back into degrees and testing it against the outlines.
//! Doing it that way rather than with bounding boxes is what makes the answer
//! right: Russia's bounding box covers most of the northern hemisphere, and
//! Chile's covers Argentina.

const std = @import("std");

const braille_mod = @import("braille.zig");
const canvas_mod = @import("canvas.zig");
const color_mod = @import("../color.zig");
const world_data = @import("world_data.zig");

const Bounds = canvas_mod.Bounds;
const Color = color_mod.Color;
const Point = braille_mod.Point;
const Shape = canvas_mod.Shape;

pub const CountryOutline = world_data.CountryOutline;
pub const WORLD_COUNTRIES = world_data.WORLD_COUNTRIES;

/// The whole globe, which is what a map shows unless told otherwise.
pub const WORLD_X = Bounds{ .min = -180, .max = 180 };
pub const WORLD_Y = Bounds{ .min = -90, .max = 90 };

pub const WorldShapeOptions = struct {
    /// Colour for countries with nothing special about them.
    color: ?Color = null,
    /// Countries to pick out, by name or ISO code.
    highlight: []const []const u8 = &.{},
    highlight_color: ?Color = null,
};

/// Match on either the name or the ISO code, case-insensitively.
fn matches(country: CountryOutline, keys: []const []const u8) bool {
    for (keys) |key| {
        if (key.len == 0) continue;
        if (std.ascii.eqlIgnoreCase(country.name, key)) return true;
        if (country.iso.len > 0 and std.ascii.eqlIgnoreCase(country.iso, key)) return true;
    }
    return false;
}

/// The world as canvas shapes, one polyline per landmass.
///
/// Polylines rather than scattered points: the outlines are closed rings, so
/// joining them draws a coastline instead of a dotted suggestion of one, and it
/// reads at a fraction of the resolution dots would need.
///
/// The caller owns the returned shapes and the points inside them, which is why
/// this takes an allocator: a ring becomes a list of pairs, and there is nowhere
/// else to put a couple of thousand of them.
pub fn worldShapes(
    allocator: std.mem.Allocator,
    options: WorldShapeOptions,
) ![]Shape {
    var shapes = try allocator.alloc(Shape, countRings());
    var at: usize = 0;
    errdefer freeShapes(allocator, shapes[0..at]);

    for (WORLD_COUNTRIES) |country| {
        const picked = options.highlight.len > 0 and matches(country, options.highlight);
        const color = if (picked) (options.highlight_color orelse options.color) else options.color;
        for (country.rings) |ring| {
            const count = ring.len / 2;
            // Closed: the last point joins the first, or every country has a
            // gap in its coastline where the ring started.
            const points = try allocator.alloc(Point, if (count > 0) count + 1 else 0);
            for (0..count) |i| {
                points[i] = .{ .x = ring[i * 2], .y = ring[i * 2 + 1] };
            }
            if (count > 0) points[count] = points[0];
            shapes[at] = .{ .kind = .polyline, .points = points, .color = color };
            at += 1;
        }
    }
    return shapes;
}

/// Release what `worldShapes` allocated.
pub fn freeShapes(allocator: std.mem.Allocator, shapes: []Shape) void {
    for (shapes) |shape| allocator.free(shape.points);
    allocator.free(shapes);
}

fn countRings() usize {
    var total: usize = 0;
    for (WORLD_COUNTRIES) |country| total += country.rings.len;
    return total;
}

/// Whether a point is inside a ring, by ray casting.
///
/// The ring is a flat list of interleaved coordinates, so this walks it two at
/// a time rather than allocating a pair per vertex -- it runs once per country
/// per click, and there are a couple of thousand vertices.
fn insideRing(ring: []const f64, lon: f64, lat: f64) bool {
    var inside = false;
    const n = ring.len / 2;
    if (n == 0) return false;
    var j = n - 1;
    for (0..n) |i| {
        const xi = ring[i * 2];
        const yi = ring[i * 2 + 1];
        const xj = ring[j * 2];
        const yj = ring[j * 2 + 1];
        if ((yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    return inside;
}

/// The country containing a point, or null for open water.
///
/// Where outlines overlap -- and at this resolution simplified borders do
/// overlap -- the first match wins, which is stable because the data is sorted
/// by name.
pub fn countryAt(lon: f64, lat: f64) ?CountryOutline {
    if (!std.math.isFinite(lon) or !std.math.isFinite(lat)) return null;
    for (WORLD_COUNTRIES) |country| {
        for (country.rings) |ring| {
            if (insideRing(ring, lon, lat)) return country;
        }
    }
    return null;
}

/// Look a country up by name or ISO code.
pub fn findCountry(key: []const u8) ?CountryOutline {
    const keys = [_][]const u8{key};
    for (WORLD_COUNTRIES) |country| {
        if (matches(country, &keys)) return country;
    }
    return null;
}

/// The window a country fills, with a little room around it.
///
/// For zooming a map to a country: the bounding box alone puts the coastline
/// flat against the edge of the panel, which reads as though the country has
/// been cut off rather than framed.
pub fn countryBounds(country: CountryOutline, margin: f64) struct { x: Bounds, y: Bounds } {
    var min_lon: f64 = std.math.inf(f64);
    var max_lon: f64 = -std.math.inf(f64);
    var min_lat: f64 = std.math.inf(f64);
    var max_lat: f64 = -std.math.inf(f64);
    for (country.rings) |ring| {
        var i: usize = 0;
        while (i + 1 < ring.len) : (i += 2) {
            min_lon = @min(min_lon, ring[i]);
            max_lon = @max(max_lon, ring[i]);
            min_lat = @min(min_lat, ring[i + 1]);
            max_lat = @max(max_lat, ring[i + 1]);
        }
    }
    if (!std.math.isFinite(min_lon)) return .{ .x = WORLD_X, .y = WORLD_Y };
    // A single-point country would give a zero-width window, which cannot be
    // mapped onto anything.
    const pad_x = @max((max_lon - min_lon) * margin, 1.0);
    const pad_y = @max((max_lat - min_lat) * margin, 1.0);
    return .{
        .x = .{ .min = min_lon - pad_x, .max = max_lon + pad_x },
        .y = .{ .min = min_lat - pad_y, .max = max_lat + pad_y },
    };
}

/// The degrees under a terminal cell, given the window the map was drawn with.
///
/// The inverse of what the canvas does on the way in, taken at the centre of
/// the cell: a click lands on a whole cell, and the centre is the only point in
/// it that is not arbitrarily nearer one neighbour than the other.
pub fn degreesAt(
    column: usize,
    row: usize,
    width: usize,
    height: usize,
    x: Bounds,
    y: Bounds,
) ?struct { lon: f64, lat: f64 } {
    if (width == 0 or height == 0) return null;
    // The canvas is 2x4 Braille pixels per cell, and it spans its bounds across
    // `pixels - 1`, so the inverse has to use the same denominators or a click
    // drifts from what was drawn.
    const px: f64 = @floatFromInt(@max(1, width * 2 -| 1));
    const py: f64 = @floatFromInt(@max(1, height * 4 -| 1));
    const cx: f64 = @floatFromInt(column * 2 + 1);
    const cy: f64 = @floatFromInt(row * 4 + 2);
    return .{
        .lon = x.min + (cx / px) * (x.max - x.min),
        .lat = y.min + (1 - cy / py) * (y.max - y.min),
    };
}
