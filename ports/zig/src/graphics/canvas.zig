//! A canvas you can draw on in your own coordinates.
//!
//! `BrailleCanvas` works in pixels: good primitives, but the caller does every
//! unit conversion, and a drawing written for one panel size is wrong in the
//! next. This wraps it with a domain per axis and a list of shapes placed in
//! that domain, so the same drawing fits whatever region it is given.
//!
//! Y increases upwards, as it does on paper and in every plot, rather than
//! downwards as it does in a terminal. A canvas is for drawing things that have
//! their own geometry; making the caller flip every y would be handing them
//! back the conversion this exists to take away.

const std = @import("std");

const braille_mod = @import("braille.zig");
const buffer_mod = @import("../buffer.zig");
const color_mod = @import("../color.zig");
const plot_mod = @import("plot.zig");
const surface_mod = @import("../surface.zig");

const BrailleCanvas = braille_mod.BrailleCanvas;
const Color = color_mod.Color;
const Point = braille_mod.Point;
const Surface = surface_mod.Surface;

pub const Bounds = struct { min: f64 = 0, max: f64 = 1 };

/// Which of the shapes a Shape is.
pub const ShapeKind = enum { line, polyline, points, circle, rect };

pub const Shape = struct {
    kind: ShapeKind = .line,
    /// Line: the two ends. Circle and rect: the centre or corner.
    x1: f64 = 0,
    y1: f64 = 0,
    x2: f64 = 0,
    y2: f64 = 0,
    /// points and polyline.
    points: []const Point = &.{},
    /// circle.
    radius: f64 = 0,
    /// rect.
    width: f64 = 0,
    height: f64 = 0,
    fill: bool = false,
    color: ?Color = null,

    /// Whether the shape has anything finite to draw.
    fn usable(self: Shape) bool {
        return switch (self.kind) {
            .line => std.math.isFinite(self.x1) and std.math.isFinite(self.y1) and
                std.math.isFinite(self.x2) and std.math.isFinite(self.y2),
            .circle => std.math.isFinite(self.x1) and std.math.isFinite(self.y1) and
                std.math.isFinite(self.radius),
            .rect => std.math.isFinite(self.x1) and std.math.isFinite(self.y1) and
                std.math.isFinite(self.width) and std.math.isFinite(self.height),
            .polyline, .points => blk: {
                for (self.points) |p| {
                    if (std.math.isFinite(p.x) and std.math.isFinite(p.y)) break :blk true;
                }
                break :blk false;
            },
        };
    }
};

pub const CanvasOptions = struct {
    shapes: []const Shape = &.{},
    /// The span the drawing is in. Null means 0-1.
    x: ?Bounds = null,
    y: ?Bounds = null,
    /// Colour for shapes that do not name their own.
    color: ?Color = null,
    background: ?Color = null,
    /// A faint dotted grid behind the shapes.
    grid: bool = false,
    grid_color: ?Color = null,
};

/// A usable span: a zero-width one cannot be mapped onto anything.
fn span(bounds: ?Bounds) Bounds {
    const b = bounds orelse return .{};
    if (!std.math.isFinite(b.min) or !std.math.isFinite(b.max) or !(b.max > b.min)) return .{};
    return b;
}

/// A projection from the caller's coordinates onto the canvas's pixels.
///
/// Handed out so a caller can place their own labels against the same drawing:
/// a chart axis or a map legend has to agree with the shapes, and re-deriving
/// the mapping by hand is exactly the arithmetic this is here to remove.
pub const Projection = struct {
    width: f64,
    height: f64,
    x_bounds: Bounds,
    y_bounds: Bounds,

    pub fn x(self: Projection, value: f64) f64 {
        return (value - self.x_bounds.min) / (self.x_bounds.max - self.x_bounds.min) * self.width;
    }

    /// Flipped: the caller's y goes up, the canvas's goes down.
    pub fn y(self: Projection, value: f64) f64 {
        const at = (value - self.y_bounds.min) / (self.y_bounds.max - self.y_bounds.min);
        return (1 - at) * self.height;
    }
};

pub fn projection(canvas: *const BrailleCanvas, x_bounds: Bounds, y_bounds: Bounds) Projection {
    return .{
        .width = @floatFromInt(@max(2, canvas.width) - 1),
        .height = @floatFromInt(@max(2, canvas.height) - 1),
        .x_bounds = x_bounds,
        .y_bounds = y_bounds,
    };
}

fn drawGrid(s: Surface, color: Color, bg: ?Color) void {
    const w = s.width();
    const h = s.height();
    const step = @max(2, h / 4);
    var yy: usize = 0;
    while (yy < h) : (yy += step) {
        var xx: usize = 0;
        while (xx < w) : (xx += 2) {
            s.glyph(@intCast(xx), @intCast(yy), '·', .{ .fg = color, .bg = bg });
        }
    }
}

pub fn drawCanvas(
    allocator: std.mem.Allocator,
    s: Surface,
    options: CanvasOptions,
) !void {
    if (s.isEmpty() or options.shapes.len == 0) return;
    const theme = s.theme;
    const bg = options.background;
    const xb = span(options.x);
    const yb = span(options.y);

    if (options.grid) {
        const color = options.grid_color orelse theme.border.mix(theme.background, 0.4);
        drawGrid(s, color, bg);
    }

    var canvas = try BrailleCanvas.init(allocator, s.width(), s.height());
    defer canvas.deinit();
    const at = projection(&canvas, xb, yb);
    const base = options.color orelse theme.accent;

    // One shape at a time, blitted before the next is drawn, so each keeps its
    // own colour. A shared canvas would make the last colour win everywhere the
    // shapes overlap.
    for (options.shapes) |shape| {
        if (!shape.usable()) continue;
        canvas.clear();
        switch (shape.kind) {
            .line => canvas.line(at.x(shape.x1), at.y(shape.y1), at.x(shape.x2), at.y(shape.y2)),
            .polyline => {
                const pixels = try allocator.alloc(Point, shape.points.len);
                defer allocator.free(pixels);
                var count: usize = 0;
                for (shape.points) |p| {
                    if (!std.math.isFinite(p.x) or !std.math.isFinite(p.y)) continue;
                    pixels[count] = .{ .x = at.x(p.x), .y = at.y(p.y) };
                    count += 1;
                }
                if (count == 1) {
                    canvas.pixel(pixels[0].x, pixels[0].y);
                } else if (count > 1) {
                    canvas.polyline(pixels[0..count]);
                }
            },
            .points => {
                for (shape.points) |p| {
                    if (std.math.isFinite(p.x) and std.math.isFinite(p.y)) {
                        canvas.pixel(at.x(p.x), at.y(p.y));
                    }
                }
            },
            .circle => {
                // A radius is a distance, not a position, so it is scaled by the
                // span rather than projected. The two axes rarely scale alike in
                // a terminal cell, and the x one is what a circle is measured
                // against.
                const scale = @as(f64, @floatFromInt(@max(2, canvas.width) - 1)) /
                    (xb.max - xb.min);
                canvas.circle(at.x(shape.x1), at.y(shape.y1), @abs(shape.radius) * scale);
            },
            .rect => {
                // Given as a corner and a size, in the caller's own direction: a
                // positive height goes up, because their y does.
                const x0 = at.x(shape.x1);
                const x1 = at.x(shape.x1 + shape.width);
                const y0 = at.y(shape.y1);
                const y1 = at.y(shape.y1 + shape.height);
                if (shape.fill) {
                    canvas.fillRect(x0, @min(y0, y1), x1, @max(y0, y1));
                } else {
                    canvas.rect(x0, @min(y0, y1), x1, @max(y0, y1));
                }
            },
        }
        plot_mod.blitFlat(s, &canvas, shape.color orelse base, bg);
    }
}
