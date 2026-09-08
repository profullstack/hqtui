"""Charts of arbitrary (x, y) data.

``plot`` takes a sequence of floats and puts one sample per column: the x axis
is the list index. That is the right model for a history buffer and the wrong
one for everything else — two series of different lengths silently render at
different horizontal scales, a gap in the data is indistinguishable from a
shorter series, and there is no way at all to say where on the x axis a point
belongs.

This takes points and a domain for each axis, so a series is placed rather than
appended. ``plot`` is untouched and still means what it meant.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Literal, Sequence

from ..buffer import Style
from ..color import Color, round_half_up
from ..surface import Surface
from ..theme import series_color
from .blocks import FillMode, clamp01, vertical_glyph
from .braille import BrailleCanvas
from .plot import blit

__all__ = [
    "AxisOptions",
    "ChartPlotOptions",
    "ChartSeries",
    "Domain",
    "MarkType",
    "Point",
    "domain_of",
    "plot_points",
]

Point = tuple[float, float]

#: How a series is marked: joined, dotted, or dropped to the baseline.
MarkType = Literal["line", "scatter", "bar"]


@dataclass(slots=True)
class ChartSeries:
    points: Sequence[Point] = ()
    color: Color | None = None
    label: str = ""
    mark: MarkType = "line"
    #: Shade between the line and the baseline. Ignored for a scatter.
    fill: bool = False


@dataclass(slots=True)
class AxisOptions:
    """One axis: what it spans and how its numbers read."""

    min: float | None = None
    max: float | None = None
    format: Callable[[float], str] | None = None
    #: How many labels to place. Default 2 — the ends.
    ticks: int = 0


@dataclass(slots=True)
class ChartPlotOptions:
    #: braille is sharpest; block and ascii are the graceful degradations.
    mode: FillMode | str = FillMode.BRAILLE
    x: AxisOptions | None = None
    y: AxisOptions | None = None
    background: Color | None = None
    grid: bool = False
    grid_color: Color | None = None
    #: 0-1 opacity of the area fill against the background.
    fill_alpha: float | None = None
    #: Where a bar or an area is measured from. Defaults to the y minimum.
    baseline: float | None = None


@dataclass(frozen=True, slots=True)
class Domain:
    min: float
    max: float


def _bound(value: float | None) -> float | None:
    """A finite number, or None: a caller's bound is data, and data can be NaN."""
    if value is None or not math.isfinite(value):
        return None
    return value


def domain_of(
    series: Sequence[ChartSeries], axis: AxisOptions | None, which: int
) -> Domain:
    """The span an axis covers, from the caller where they said and from the
    data where they did not.

    A domain of zero width cannot be mapped — every point would land in the same
    place and a division would blow up — so a flat series is given room around
    itself rather than being collapsed onto one line.
    """
    minimum = _bound(axis.min if axis else None)
    maximum = _bound(axis.max if axis else None)
    if minimum is None or maximum is None:
        lo = math.inf
        hi = -math.inf
        for s in series:
            for point in s.points:
                v = point[which]
                if not math.isfinite(v):
                    continue
                lo = min(lo, v)
                hi = max(hi, v)
        if not math.isfinite(lo):
            lo, hi = 0.0, 1.0
        minimum = lo if minimum is None else minimum
        maximum = hi if maximum is None else maximum
    if not maximum > minimum:
        # A flat series still has to be drawn somewhere sensible.
        pad = abs(minimum) * 0.5 if abs(minimum) > 0 else 0.5
        return Domain(minimum - pad, minimum + pad)
    return Domain(minimum, maximum)


def _ratio(value: float, domain: Domain) -> float:
    """Where a value sits in its domain, 0 at the minimum and 1 at the maximum."""
    return (value - domain.min) / (domain.max - domain.min)


def _draw_grid(surface: Surface, color: Color, bg: Color | None) -> None:
    w, h = surface.width, surface.height
    step = max(2, h // 4)
    for y in range(0, h, step):
        for x in range(0, w, 2):
            surface.char(x, y, "·", Style(fg=color, bg=bg))


def plot_points(
    surface: Surface, series: Sequence[ChartSeries], options: ChartPlotOptions | None = None
) -> None:
    """Draw point series across the whole surface.

    Points are drawn in the order they are given: a line joins them as they
    come, which is what lets a chart draw a loop or a path that doubles back.
    Sorting them would quietly make that impossible.
    """
    options = options or ChartPlotOptions()
    if surface.empty or not series:
        return
    theme = surface.theme
    mode = options.mode or FillMode.BRAILLE
    bg = options.background
    w, h = surface.width, surface.height

    xd = domain_of(series, options.x, 0)
    yd = domain_of(series, options.y, 1)
    baseline = _bound(options.baseline)
    baseline = yd.min if baseline is None else baseline

    if options.grid:
        color = options.grid_color
        if color is None:
            color = theme.border.mix(theme.background, 0.4)
        _draw_grid(surface, color, bg)

    if mode != FillMode.BRAILLE:
        _plot_cells(surface, series, mode, xd, yd, baseline, bg)
        return

    canvas = BrailleCanvas(w, h)
    px = float(canvas.width)
    py = float(canvas.height)

    for si, s in enumerate(series):
        canvas.clear()
        color = s.color if s.color is not None else series_color(theme, si)
        finite = [p for p in s.points if math.isfinite(p[0]) and math.isfinite(p[1])]
        if not finite:
            continue
        pixels = [
            (
                round_half_up(clamp01(_ratio(p[0], xd)) * (px - 1)),
                round_half_up((1 - clamp01(_ratio(p[1], yd))) * (py - 1)),
            )
            for p in finite
        ]

        if s.mark == "scatter":
            for x, y in pixels:
                canvas.pixel(x, y)
        elif s.mark == "bar":
            floor = round_half_up((1 - clamp01(_ratio(baseline, yd))) * (py - 1))
            for x, y in pixels:
                canvas.vline(x, min(y, floor), max(y, floor))
        elif len(pixels) == 1:
            canvas.pixel(pixels[0][0], pixels[0][1])
        else:
            canvas.polyline(pixels)

        if s.fill and s.mark != "scatter":
            alpha = 0.5 if options.fill_alpha is None else options.fill_alpha
            _fill_under(surface, finite, xd, yd, baseline, color, bg, alpha)
        blit(surface, canvas, lambda col, row, c=color: c, bg)


def _fill_under(
    surface: Surface,
    points: Sequence[Point],
    xd: Domain,
    yd: Domain,
    baseline: float,
    color: Color,
    bg: Color | None,
    alpha: float,
) -> None:
    """The area between a series and its baseline, in block elements.

    Braille would give eight scattered dots per cell, which reads as noise where
    an area should read as an area. The line itself stays Braille, so it keeps
    the sub-cell resolution.

    The height of each column is interpolated along the line rather than sampled
    from the points that happen to land in it. Sampling leaves a gap wherever a
    column has no point of its own, which with arbitrary x values is most of
    them — the area comes out striped instead of solid.
    """
    w, h = surface.width, surface.height
    if w == 0 or h == 0 or not points:
        return
    base = bg if bg is not None else surface.theme.background
    floor = clamp01(_ratio(baseline, yd))

    def column(x: float) -> float:
        return _ratio(x, xd) * (w - 1)

    tops: list[float] = [math.nan] * w

    def record(col: int, value: float) -> None:
        if col < 0 or col >= w:
            return
        # A path that doubles back covers a column twice; the outer edge is the
        # one that bounds the area.
        previous = tops[col]
        if math.isnan(previous) or abs(value - floor) > abs(previous - floor):
            tops[col] = value

    if len(points) == 1:
        record(int(round_half_up(column(points[0][0]))), clamp01(_ratio(points[0][1], yd)))
    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        c0, c1 = column(x0), column(x1)
        start = int(max(0.0, math.floor(min(c0, c1))))
        end = int(min(float(w - 1), max(0.0, math.ceil(max(c0, c1)))))
        for col in range(start, end + 1):
            t = 0.0 if c1 == c0 else (col - c0) / (c1 - c0)
            if t < -0.5 or t > 1.5:
                continue
            y = y0 + (y1 - y0) * clamp01(t)
            record(col, clamp01(_ratio(y, yd)))

    for x in range(w):
        top = tops[x]
        if math.isnan(top):
            continue
        from01 = min(floor, top)
        filled = (max(floor, top) - from01) * h
        bottom = int(math.floor(from01 * h))
        full = int(math.floor(filled))
        for k in range(min(full, h)):
            row = h - 1 - bottom - k
            if row < 0 or row >= h:
                continue
            depth = 0.0 if h <= 1 else row / (h - 1)
            surface.char(x, row, "█", Style(fg=base.mix(color, alpha * (1 - depth * 0.3)), bg=bg))
        if full < h:
            glyph = vertical_glyph(filled - full, FillMode.BLOCK)
            row = h - 1 - bottom - full
            if glyph != " " and 0 <= row < h:
                depth = 0.0 if h <= 1 else row / (h - 1)
                surface.char(
                    x, row, glyph,
                    Style(fg=base.mix(color, alpha * (1 - depth * 0.3) + 0.12), bg=bg),
                )


def _plot_cells(
    surface: Surface,
    series: Sequence[ChartSeries],
    mode: FillMode | str,
    xd: Domain,
    yd: Domain,
    baseline: float,
    bg: Color | None,
) -> None:
    """The block and ascii degradations: one column per cell, tallest point wins.

    A scatter keeps its dots rather than growing columns, because a scatter that
    fills to the baseline is a bar chart wearing the wrong name.
    """
    w, h = surface.width, surface.height
    theme = surface.theme
    floor_ratio = clamp01(_ratio(baseline, yd))

    for si, s in enumerate(series):
        color = s.color if s.color is not None else series_color(theme, si)
        # Highest value per column, so a column shows the peak that fell in it
        # rather than whichever point happened to be last.
        tops: list[float] = [math.nan] * w
        for point in s.points:
            if not math.isfinite(point[0]) or not math.isfinite(point[1]):
                continue
            col = int(round_half_up(_ratio(point[0], xd) * (w - 1)))
            col = max(0, min(col, w - 1))
            value = clamp01(_ratio(point[1], yd))
            if math.isnan(tops[col]) or value > tops[col]:
                tops[col] = value

        for x in range(w):
            top = tops[x]
            if math.isnan(top):
                continue
            if s.mark == "scatter":
                row = h - 1 - min(int(math.floor(top * h)), h - 1)
                surface.char(
                    x, row, "*" if mode == FillMode.ASCII else "•", Style(fg=color, bg=bg)
                )
                continue
            start = min(floor_ratio, top) * h
            filled = (max(floor_ratio, top) - min(floor_ratio, top)) * h
            full = int(math.floor(filled))
            for k in range(full):
                row = h - 1 - int(math.floor(start)) - k
                if 0 <= row < h:
                    surface.char(x, row, "█", Style(fg=color, bg=bg))
            glyph = vertical_glyph(filled - full, mode)
            row = h - 1 - int(math.floor(start)) - full
            if glyph != " " and 0 <= row < h:
                surface.char(x, row, glyph, Style(fg=color, bg=bg))
