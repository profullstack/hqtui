"""A canvas you can draw on in your own coordinates.

``BrailleCanvas`` works in pixels: good primitives, but the caller does every
unit conversion, and a drawing written for one panel size is wrong in the next.
This wraps it with a domain per axis and a list of shapes placed in that domain,
so the same drawing fits whatever region it is given.

Y increases upwards, as it does on paper and in every plot, rather than
downwards as it does in a terminal. A canvas is for drawing things that have
their own geometry; making the caller flip every y would be handing them back
the conversion this exists to take away.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal, Sequence

from ..buffer import Style
from ..color import Color
from ..surface import Surface
from .braille import BrailleCanvas
from .plot import blit

__all__ = [
    "Bounds",
    "CanvasOptions",
    "Projection",
    "Shape",
    "ShapeKind",
    "draw_canvas",
    "projection",
]

Point = tuple[float, float]

#: Which of the shapes a Shape is.
ShapeKind = Literal["line", "polyline", "points", "circle", "rect"]


@dataclass(frozen=True, slots=True)
class Bounds:
    min: float = 0.0
    max: float = 1.0


@dataclass(frozen=True, slots=True)
class Shape:
    kind: ShapeKind = "line"
    #: Line: the two ends. Circle and rect: the centre or corner.
    x1: float = 0.0
    y1: float = 0.0
    x2: float = 0.0
    y2: float = 0.0
    #: points and polyline.
    points: Sequence[Point] = ()
    #: circle.
    radius: float = 0.0
    #: rect.
    width: float = 0.0
    height: float = 0.0
    fill: bool = False
    color: Color | None = None

    @property
    def usable(self) -> bool:
        """Whether the shape has anything finite to draw."""
        if self.kind == "line":
            return all(math.isfinite(v) for v in (self.x1, self.y1, self.x2, self.y2))
        if self.kind == "circle":
            return all(math.isfinite(v) for v in (self.x1, self.y1, self.radius))
        if self.kind == "rect":
            return all(math.isfinite(v) for v in (self.x1, self.y1, self.width, self.height))
        return any(math.isfinite(p[0]) and math.isfinite(p[1]) for p in self.points)


@dataclass(frozen=True, slots=True)
class CanvasOptions:
    shapes: Sequence[Shape] = ()
    #: The span the drawing is in. None means 0-1.
    x: Bounds | None = None
    y: Bounds | None = None
    #: Colour for shapes that do not name their own.
    color: Color | None = None
    background: Color | None = None
    #: A faint dotted grid behind the shapes.
    grid: bool = False
    grid_color: Color | None = None


def _span(bounds: Bounds | None) -> Bounds:
    """A usable span: a zero-width one cannot be mapped onto anything."""
    if bounds is None:
        return Bounds()
    if not math.isfinite(bounds.min) or not math.isfinite(bounds.max):
        return Bounds()
    if not bounds.max > bounds.min:
        return Bounds()
    return bounds


@dataclass(frozen=True, slots=True)
class Projection:
    """A projection from the caller's coordinates onto the canvas's pixels.

    Handed out so a caller can place their own labels against the same drawing:
    a chart axis or a map legend has to agree with the shapes, and re-deriving
    the mapping by hand is exactly the arithmetic this is here to remove.
    """

    width: float
    height: float
    x_bounds: Bounds
    y_bounds: Bounds

    def x(self, value: float) -> float:
        return (value - self.x_bounds.min) / (self.x_bounds.max - self.x_bounds.min) * self.width

    def y(self, value: float) -> float:
        """Flipped: the caller's y goes up, the canvas's goes down."""
        span = (value - self.y_bounds.min) / (self.y_bounds.max - self.y_bounds.min)
        return (1 - span) * self.height


def projection(canvas: BrailleCanvas, x_bounds: Bounds, y_bounds: Bounds) -> Projection:
    return Projection(
        width=float(max(2, canvas.width) - 1),
        height=float(max(2, canvas.height) - 1),
        x_bounds=x_bounds,
        y_bounds=y_bounds,
    )


def _draw_grid(surface: Surface, color: Color, bg: Color | None) -> None:
    w, h = surface.width, surface.height
    step = max(2, h // 4)
    for y in range(0, h, step):
        for x in range(0, w, 2):
            surface.char(x, y, "·", Style(fg=color, bg=bg))


def draw_canvas(surface: Surface, options: CanvasOptions) -> None:
    if surface.empty or not options.shapes:
        return
    theme = surface.theme
    bg = options.background
    xb = _span(options.x)
    yb = _span(options.y)

    if options.grid:
        color = options.grid_color
        if color is None:
            color = theme.border.mix(theme.background, 0.4)
        _draw_grid(surface, color, bg)

    canvas = BrailleCanvas(surface.width, surface.height)
    at = projection(canvas, xb, yb)
    base = options.color if options.color is not None else theme.accent

    # One shape at a time, blitted before the next is drawn, so each keeps its
    # own colour. A shared canvas would make the last colour win everywhere the
    # shapes overlap.
    for shape in options.shapes:
        if not shape.usable:
            continue
        canvas.clear()
        if shape.kind == "line":
            canvas.line(at.x(shape.x1), at.y(shape.y1), at.x(shape.x2), at.y(shape.y2))
        elif shape.kind == "polyline":
            pixels = [
                (at.x(p[0]), at.y(p[1]))
                for p in shape.points
                if math.isfinite(p[0]) and math.isfinite(p[1])
            ]
            if len(pixels) == 1:
                canvas.pixel(pixels[0][0], pixels[0][1])
            else:
                canvas.polyline(pixels)
        elif shape.kind == "points":
            for px, py in shape.points:
                if math.isfinite(px) and math.isfinite(py):
                    canvas.pixel(at.x(px), at.y(py))
        elif shape.kind == "circle":
            # A radius is a distance, not a position, so it is scaled by the span
            # rather than projected. The two axes rarely scale alike in a
            # terminal cell, and the x one is what a circle is measured against.
            scale = (max(2, canvas.width) - 1) / (xb.max - xb.min)
            canvas.circle(at.x(shape.x1), at.y(shape.y1), abs(shape.radius) * scale)
        elif shape.kind == "rect":
            # Given as a corner and a size, in the caller's own direction: a
            # positive height goes up, because their y does.
            x0 = at.x(shape.x1)
            x1 = at.x(shape.x1 + shape.width)
            y0 = at.y(shape.y1)
            y1 = at.y(shape.y1 + shape.height)
            if shape.fill:
                canvas.fill_rect(x0, min(y0, y1), x1, max(y0, y1))
            else:
                canvas.rect(x0, min(y0, y1), x1, max(y0, y1))

        color = shape.color if shape.color is not None else base
        blit(surface, canvas, lambda col, row, c=color: c, bg)
