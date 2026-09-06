"""Line, area, bar and dial rendering.

With ``FillMode.BRAILLE`` each cell carries a 2x4 pixel matrix, so a 40x10 panel
plots at 80x40 resolution.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Sequence

from ..buffer import Attrs, Style
from ..color import Color, Gradient, round_half_up
from ..surface import Surface, TextOptions
from ..theme import series_color
from ..unicode import Align
from .blocks import FillMode, clamp01, horizontal_glyph, vertical_glyph
from .braille import BrailleCanvas

__all__ = [
    "BarOptions",
    "BarStyle",
    "DonutOptions",
    "DonutSegment",
    "GaugeOptions",
    "HistogramOptions",
    "PlotOptions",
    "Series",
    "SparklineOptions",
    "bar",
    "blit",
    "donut",
    "gauge",
    "histogram",
    "plot",
    "sparkline",
]


@dataclass(slots=True)
class Series:
    values: Sequence[float] = ()
    color: Color | None = None
    label: str = ""
    fill: bool | None = None
    """Shade the area beneath the line."""


@dataclass(slots=True)
class PlotOptions:
    mode: "FillMode | str" = FillMode.BRAILLE
    """Braille is sharpest; block and ascii are the graceful degradations."""
    min: float | None = None
    max: float | None = None
    color: Color | None = None
    colors: Sequence[Color] = ()
    """Color the plot along a ramp by value rather than one flat color."""
    fill: bool | None = None
    fill_alpha: float = 0.5
    """0-1 opacity of the area fill against the background."""
    background: Color | None = None
    grid: bool = False
    """Draw a faint dotted grid behind the series."""
    grid_color: Color | None = None
    baseline: float | None = None


def _finite(v: float | None) -> float | None:
    """A finite number, or None — ``sum / count`` with no samples is NaN."""
    if v is None or v != v or math.isinf(v):
        return None
    return v


def _extent(series: Sequence[Series], options: PlotOptions) -> tuple[float, float]:
    # A caller's axis bound is data, and data can be NaN. Falling back to the
    # computed extent keeps every plotted coordinate finite.
    lo_opt, hi_opt = _finite(options.min), _finite(options.max)
    if lo_opt is None or hi_opt is None:
        lo, hi = math.inf, -math.inf
        for s in series:
            for v in s.values:
                if v != v or math.isinf(v):
                    continue
                lo = min(lo, v)
                hi = max(hi, v)
        if math.isinf(lo):
            lo, hi = 0.0, 1.0
        low = lo_opt if lo_opt is not None else min(0.0, lo)
        high = hi_opt if hi_opt is not None else hi
    else:
        low, high = lo_opt, hi_opt
    if high <= low:
        high = low + 1
    return low, high


def _tail(values: Sequence[float], columns: int) -> Sequence[float]:
    """The trailing window of a series that will actually be drawn."""
    n = max(1, columns)
    return values if len(values) <= n else values[len(values) - n :]


def _draw_grid(surface: Surface, color: Color, bg: Color | None) -> None:
    w, h = surface.width, surface.height
    step = max(2, h // 4)
    for y in range(0, h, step):
        for x in range(0, w, 2):
            surface.char(x, y, "·", Style(fg=color, bg=bg))


def plot(surface: Surface, series: Sequence[Series], options: PlotOptions | None = None) -> None:
    """Draw one or more series across the whole surface."""
    o = options or PlotOptions()
    if surface.empty or not series:
        return
    theme = surface.theme
    bg = o.background
    w, h = surface.width, surface.height

    # Only the samples that will actually be drawn should set the scale, or an
    # old spike still sitting in the history buffer flattens the live line.
    columns = w * 2 if o.mode == FillMode.BRAILLE else w
    visible = [
        Series(values=_tail(s.values, columns), color=s.color, label=s.label, fill=s.fill)
        for s in series
    ]
    low, high = _extent(visible, o)
    span = high - low

    if o.grid:
        color = o.grid_color if o.grid_color is not None else theme.border.mix(theme.background, 0.4)
        _draw_grid(surface, color, bg)

    if o.mode in (FillMode.BLOCK, FillMode.ASCII, FillMode.HALF):
        # One column per cell, newest value on the right.
        for si, s in enumerate(visible):
            color = s.color or o.color or series_color(theme, si)
            ramp = Gradient(o.colors) if o.colors else None
            for x in range(w):
                idx = len(s.values) - w + x
                if idx < 0 or idx >= len(s.values):
                    continue
                v = s.values[idx]
                if v != v or math.isinf(v):
                    continue
                ratio = (v - low) / span
                filled = ratio * h
                full = math.floor(filled)
                cell_color = ramp.sample(ratio) if ramp else color
                style = Style(fg=cell_color, bg=bg)
                for k in range(min(full, h)):
                    surface.char(x, h - 1 - k, "█", style)
                if full < h:
                    glyph = vertical_glyph(filled - full, o.mode)
                    if glyph != " ":
                        surface.char(x, h - 1 - full, glyph, style)
        return

    # Braille: build one canvas per series so colors stay separable.
    canvas = BrailleCanvas(w, h)
    px, py = canvas.width, canvas.height

    for si, s in enumerate(visible):
        canvas.clear()
        color = s.color or o.color or series_color(theme, si)
        if not s.values:
            continue
        count = min(len(s.values), px)
        start = len(s.values) - count
        points: list[tuple[float, float]] = []
        for i in range(count):
            v = s.values[start + i]
            if v != v or math.isinf(v):
                continue
            ratio = (v - low) / span
            x = px - 1 if count == 1 else round_half_up(i / (count - 1) * (px - 1))
            y = round_half_up((1 - clamp01(ratio)) * (py - 1))
            points.append((x, y))
        if not points:
            continue
        if len(points) == 1:
            canvas.pixel(points[0][0], points[0][1])
        else:
            canvas.polyline(points)

        want_fill = s.fill if s.fill is not None else (o.fill or False)
        if want_fill:
            # The area is drawn with block elements rather than Braille: eight
            # scattered dots per cell reads as noise, a block reads as an area.
            # The line stays Braille, so it keeps the sub-cell resolution.
            base = bg if bg is not None else theme.background
            # The fill has to walk the same window as the line, averaging the
            # samples that land inside each cell — otherwise the area drifts out
            # of step.
            sample_count = min(len(s.values), px)
            sample_start = len(s.values) - sample_count
            for x in range(w):
                frm = sample_start + int(x / w * sample_count)
                to = max(frm + 1, sample_start + int((x + 1) / w * sample_count))
                total, seen = 0.0, 0
                for i in range(frm, min(to, len(s.values))):
                    sample = s.values[i]
                    if sample == sample and not math.isinf(sample):
                        total += sample
                        seen += 1
                if seen == 0:
                    continue
                ratio = clamp01((total / seen - low) / span)
                filled = ratio * h
                full = math.floor(filled)
                for k in range(min(full, h)):
                    row = h - 1 - k
                    depth = 0.0 if h <= 1 else row / (h - 1)
                    surface.char(
                        x, row, "█",
                        Style(fg=base.mix(color, o.fill_alpha * (1 - depth * 0.3)), bg=bg),
                    )
                if full < h:
                    glyph = vertical_glyph(filled - full, FillMode.BLOCK)
                    if glyph != " ":
                        row = h - 1 - full
                        depth = 0.0 if h <= 1 else row / (h - 1)
                        surface.char(
                            x, row, glyph,
                            Style(
                                fg=base.mix(color, o.fill_alpha * (1 - depth * 0.3) + 0.12),
                                bg=bg,
                            ),
                        )

        ramp = Gradient(o.colors) if o.colors else None
        blit(
            surface,
            canvas,
            (lambda col, row: color) if ramp is None
            else (lambda col, row: ramp.sample(1 - row / max(1, h - 1))),
            bg,
        )


def blit(
    surface: Surface,
    canvas: BrailleCanvas,
    color_at: Callable[[int, int], Color],
    bg: Color | None = None,
) -> None:
    """Copy a Braille canvas onto a surface, one glyph per cell."""
    for row in range(canvas.rows):
        for col in range(canvas.cols):
            value = canvas.cell(col, row)
            if value == 0:
                continue
            surface.char(col, row, value, Style(fg=color_at(col, row), bg=bg))


@dataclass(slots=True)
class SparklineOptions:
    color: Color | None = None
    colors: Sequence[Color] = ()
    min: float | None = None
    max: float | None = None
    background: Color | None = None
    mode: "FillMode | str" = FillMode.BLOCK


def sparkline(
    surface: Surface, values: Sequence[float], options: SparklineOptions | None = None
) -> None:
    """A single-row trend line. Cheap enough to put in a table cell."""
    o = options or SparklineOptions()
    if surface.empty:
        return
    theme = surface.theme
    w = surface.width
    low, high = _extent(
        [Series(values=_tail(values, w))], PlotOptions(min=o.min, max=o.max)
    )
    span = high - low
    ramp = Gradient(o.colors) if o.colors else None
    color = o.color if o.color is not None else theme.accent
    count = min(len(values), w)
    start = len(values) - count
    offset = w - count
    for i in range(count):
        v = values[start + i]
        if v != v or math.isinf(v):
            continue
        ratio = clamp01((v - low) / span)
        surface.char(
            offset + i, 0, vertical_glyph(ratio, o.mode),
            Style(fg=ramp.sample(ratio) if ramp else color, bg=o.background),
        )


class BarStyle(str):
    """How a horizontal bar's fill is drawn.

    Plain strings, matching the reference's spelling: ``"smooth"``,
    ``"segmented"`` (discrete ticks with gaps, so stacked bars stay separable —
    the btop look), or ``"ascii"``.
    """

    SMOOTH = "smooth"
    SEGMENTED = "segmented"
    ASCII = "ascii"


@dataclass(slots=True)
class BarOptions:
    value: float = 0.0
    """0-1. Values outside are clamped."""
    color: Color | None = None
    heat: bool | None = None
    """Color by fill level using the theme heat ramp."""
    track: Color | None = None
    background: Color | None = None
    style: str = BarStyle.SMOOTH
    track_char: str | None = None


def bar(surface: Surface, options: BarOptions) -> None:
    """A horizontal bar filling the surface's first row."""
    if surface.empty:
        return
    theme = surface.theme
    w = surface.width
    ratio = clamp01(options.value)
    style = options.style
    track_color = (
        options.track if options.track is not None else theme.background.mix(theme.border, 0.8)
    )
    heat = Gradient(theme.heat) if options.heat else None
    color = options.color if options.color is not None else theme.primary
    if style == BarStyle.ASCII:
        default_track, fill_char = "-", "#"
    elif style == BarStyle.SEGMENTED:
        default_track, fill_char = "▮", "▮"
    else:
        default_track, fill_char = "─", "█"
    track_char = options.track_char if options.track_char is not None else default_track

    filled = ratio * w
    full = math.floor(filled)

    for x in range(w):
        if x < full:
            t = ratio if w <= 1 else x / (w - 1)
            surface.char(
                x, 0, fill_char,
                Style(fg=heat.sample(t) if heat else color, bg=options.background),
            )
        elif x == full and style != BarStyle.SEGMENTED:
            glyph = horizontal_glyph(
                filled - full, FillMode.ASCII if style == BarStyle.ASCII else FillMode.BLOCK
            )
            blank = glyph == " "
            fg = track_color if blank else (heat.sample(ratio) if heat else color)
            surface.char(x, 0, track_char if blank else glyph, Style(fg=fg, bg=options.background))
        else:
            surface.char(x, 0, track_char, Style(fg=track_color, bg=options.background))


@dataclass(slots=True)
class GaugeOptions:
    value: float = 0.0
    color: Color | None = None
    background: Color | None = None
    label: str = ""
    heat: bool | None = None


def gauge(surface: Surface, options: GaugeOptions) -> None:
    """A semicircular dial drawn with Braille. Needs about 9x5 cells."""
    if surface.empty or surface.height < 3:
        bar(surface, BarOptions(value=options.value, color=options.color, heat=options.heat))
        return
    theme = surface.theme
    ratio = clamp01(options.value)
    canvas = BrailleCanvas(surface.width, surface.height)
    cx = canvas.width / 2
    cy = canvas.height - 2
    radius = min(canvas.width / 2 - 1, canvas.height - 3)
    heat = Gradient(theme.heat)

    steps = int(max(24, round_half_up(radius * 4)))
    for i in range(steps + 1):
        t = i / steps
        angle = math.pi * (1 - t)
        x = cx + math.cos(angle) * radius
        y = cy - math.sin(angle) * radius * 0.85
        if t <= ratio:
            canvas.pixel(x, y)
            canvas.pixel(x, y - 1)

    color = options.color
    if color is None:
        color = theme.primary if options.heat is False else heat.sample(ratio)
    blit(surface, canvas, lambda col, row: color, options.background)

    # Unfilled remainder of the dial, dimmed.
    rest = BrailleCanvas(surface.width, surface.height)
    for i in range(steps + 1):
        t = i / steps
        if t <= ratio:
            continue
        angle = math.pi * (1 - t)
        rest.pixel(cx + math.cos(angle) * radius, cy - math.sin(angle) * radius * 0.85)
    dim = theme.background.mix(theme.border, 0.9)
    blit(surface, rest, lambda col, row: dim, options.background)

    if options.label:
        surface.text_aligned(
            surface.height - 1, options.label, Align.CENTER,
            TextOptions(fg=color, attrs=Attrs.BOLD),
        )


@dataclass(slots=True)
class DonutSegment:
    value: float = 0.0
    color: Color | None = None
    label: str = ""


@dataclass(slots=True)
class DonutOptions:
    segments: Sequence[DonutSegment] = field(default_factory=tuple)
    background: Color | None = None


def donut(surface: Surface, options: DonutOptions) -> None:
    """A ring chart. Reads well from about 12x6 cells."""
    if surface.empty:
        return
    theme = surface.theme
    total = sum(max(0.0, s.value) for s in options.segments) or 1.0
    canvas = BrailleCanvas(surface.width, surface.height)
    cx = canvas.width / 2
    cy = canvas.height / 2
    outer = min(canvas.width / 2, canvas.height / 2) - 1
    inner = outer * 0.55
    color_for: dict[tuple[int, int], Color] = {}

    angle = -math.pi / 2
    for i, seg in enumerate(options.segments):
        sweep = max(0.0, seg.value) / total * math.pi * 2
        color = seg.color if seg.color is not None else series_color(theme, i)
        steps = int(max(8, round_half_up(sweep * outer * 3)))
        for s in range(steps + 1):
            a = angle + sweep * s / steps
            r = inner
            while r <= outer:
                x = round_half_up(cx + math.cos(a) * r)
                y = round_half_up(cy + math.sin(a) * r * 0.9)
                canvas.pixel(x, y)
                color_for[(int(x) >> 1, int(y) >> 2)] = color
                r += 0.4
        angle += sweep

    blit(
        surface, canvas,
        lambda col, row: color_for.get((col, row), theme.muted),
        options.background,
    )


@dataclass(slots=True)
class HistogramOptions:
    values: Sequence[float] = ()
    color: Color | None = None
    colors: Sequence[Color] = ()
    background: Color | None = None
    max: float | None = None


def histogram(surface: Surface, options: HistogramOptions) -> None:
    """A vertical column chart, one column per value, newest on the right."""
    plot(
        surface,
        [Series(values=options.values)],
        PlotOptions(
            mode=FillMode.BLOCK, color=options.color, colors=options.colors,
            background=options.background, max=options.max, min=0.0,
        ),
    )
