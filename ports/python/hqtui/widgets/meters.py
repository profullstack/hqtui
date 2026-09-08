"""Meters, gauges, graphs and the rest of the "how full is it" family."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Sequence

from ..buffer import Attrs, Style
from ..color import Color, Gradient, round_half_up
from ..graphics.blocks import FillMode, clamp01, vertical_glyph
from ..graphics.plot import (
    BarOptions,
    BarStyle,
    PlotOptions,
    Series,
    SparklineOptions,
    bar,
    donut as draw_donut,
    gauge as draw_gauge,
    plot,
    sparkline,
)
from ..surface import Surface, TextOptions
from ..theme import heat_color, series_color
from ..unicode import Align, fit, string_width, truncate

__all__ = [
    "ColumnsOptions",
    "GraphOptions",
    "HeatBarOptions",
    "MeterItem",
    "MeterOptions",
    "MetersOptions",
    "ProgressOptions",
    "SparklineWidgetOptions",
    "clamp_ratio",
    "draw_columns",
    "draw_donut",
    "draw_gauge",
    "draw_graph",
    "draw_heat_bar",
    "draw_meter",
    "draw_meters",
    "draw_progress",
    "draw_sparkline",
    "nice_label",
]


def clamp_ratio(value: float) -> float:
    """A 0-1 ratio.

    Ordered so NaN falls through to 0 — ``min``/``max`` propagate it in the
    reference, which rendered "NaN%" in black on black.
    """
    if value > 1:
        return 1.0
    if value > 0:
        return value
    return 0.0


@dataclass(frozen=True, slots=True)
class MeterOptions:
    value: float = 0.0
    """0-1, or supply ``max`` and pass an absolute value."""
    max: float | None = None
    label: str = ""
    text: str | None = None
    """Right-hand readout. None means a percentage."""
    label_width: int | None = None
    value_width: int | None = None
    color: Color | None = None
    heat: bool | None = None
    """Green-to-red by fill level. None means on unless ``color`` is set."""
    background: Color | None = None
    style: str = BarStyle.SMOOTH
    show_value: bool = True


def draw_meter(surface: Surface, options: MeterOptions) -> None:
    """``label ████████░░░░ 42%`` on a single row. The most-used widget here."""
    if surface.empty:
        return
    theme = surface.theme
    # 0 and NaN are both falsy in the reference, which then treats `value` as an
    # already-normalised ratio instead of dividing by them.
    m = options.max
    divide = m is not None and m != 0 and m == m
    ratio = clamp_ratio(options.value / m if divide else options.value)

    label_width = 0
    if options.label:
        label_width = (
            options.label_width
            if options.label_width is not None
            else string_width(options.label) + 1
        )
    value_text = ""
    if options.show_value:
        value_text = (
            options.text
            if options.text is not None
            else f"{int(round_half_up(ratio * 100))}%"
        )
    value_width = 0
    if value_text:
        value_width = (
            options.value_width
            if options.value_width is not None
            else string_width(value_text) + 1
        )
    bar_width = max(0, surface.width - label_width - value_width)

    if label_width > 0:
        surface.text(
            0, 0, fit(truncate(options.label, label_width), label_width, Align.LEFT),
            TextOptions(fg=theme.muted, bg=options.background),
        )
    if bar_width > 0:
        heat = options.heat if options.heat is not None else options.color is None
        bar(
            surface.sub(label_width, 0, bar_width, 1),
            BarOptions(
                value=ratio, color=options.color, heat=heat,
                background=options.background, style=options.style,
            ),
        )
    if value_width > 0:
        if options.color is not None:
            fg = options.color
        elif options.heat is False:
            fg = theme.foreground
        else:
            fg = heat_color(theme, ratio)
        surface.text(
            surface.width - value_width, 0, fit(value_text, value_width, Align.RIGHT),
            TextOptions(fg=fg, bg=options.background, attrs=Attrs.BOLD),
        )


@dataclass(frozen=True, slots=True)
class MeterItem:
    label: str = ""
    value: float = 0.0
    max: float | None = None
    color: Color | None = None
    text: str | None = None


@dataclass(frozen=True, slots=True)
class MetersOptions:
    items: Sequence[MeterItem] = ()
    label_width: int | None = None
    value_width: int | None = None
    heat: bool | None = None
    background: Color | None = None
    style: str = BarStyle.SMOOTH
    columns: int = 1
    """Lay out in N columns when there is room, like btop's core grid."""
    gap: int = 2


def draw_meters(surface: Surface, options: MetersOptions) -> None:
    """A stack (or grid) of meters — per-core CPU, per-disk usage, and so on."""
    if surface.empty:
        return
    columns = max(1, options.columns)
    gap = options.gap
    col_width = math.floor((surface.width - gap * (columns - 1)) / columns)
    per_column = math.ceil(len(options.items) / columns)
    if per_column == 0:
        return

    for i, item in enumerate(options.items):
        col, row = divmod(i, per_column)
        if row >= surface.height or col >= columns:
            continue
        draw_meter(
            surface.sub(col * (col_width + gap), row, max(0, col_width), 1),
            MeterOptions(
                value=item.value, max=item.max, label=item.label, text=item.text,
                color=item.color, label_width=options.label_width,
                value_width=options.value_width, heat=options.heat,
                background=options.background, style=options.style,
            ),
        )


@dataclass(frozen=True, slots=True)
class ProgressOptions:
    value: float = 0.0
    max: float | None = None
    label: str = ""
    color: Color | None = None
    background: Color | None = None
    show_count: bool = False
    """Show ``37/120`` instead of a percentage."""


def draw_progress(surface: Surface, options: ProgressOptions) -> None:
    maximum = options.max if options.max is not None else 1.0
    text = (
        f"{int(round_half_up(options.value))}/{int(round_half_up(maximum))}"
        if options.show_count
        else None
    )
    draw_meter(
        surface,
        MeterOptions(
            value=options.value, max=maximum, label=options.label,
            color=options.color if options.color is not None else surface.theme.primary,
            heat=False, background=options.background, text=text,
        ),
    )


def nice_label(value: float) -> str:
    """The axis label format the reference uses when none is given."""
    if abs(value) >= 1000:
        return f"{_js_number(round_half_up(value / 100) / 10)}k"
    if value == int(value) and math.isfinite(value):
        return _js_number(value)
    return f"{value:.1f}"


def _js_number(v: float) -> str:
    """JavaScript's number-to-string: no trailing zeros, no decimal point when
    the value is whole."""
    if v == int(v) and math.isfinite(v):
        return str(int(v))
    return repr(v)


@dataclass(frozen=True, slots=True)
class GraphOptions:
    values: Sequence[float] = ()
    """A single series; ``series`` is several and wins if both are set."""
    series: Sequence[Series] | None = None
    plot: PlotOptions = field(default_factory=PlotOptions)
    axis: bool = False
    """Draw min/max labels down the left edge."""
    axis_format: Callable[[float], str] | None = None
    axis_color: Color | None = None
    time_axis: Sequence[str] = ()
    """Time labels along the bottom, e.g. ``("60s", "30s", "0s")``."""
    legend: bool = False
    legend_align: "Align | str" = Align.LEFT


def draw_graph(surface: Surface, options: GraphOptions) -> None:
    """Line/area graph. Braille by default, so it reads at 2x4 the resolution."""
    if surface.empty:
        return
    theme = surface.theme
    series = list(options.series) if options.series is not None else [Series(values=options.values)]

    plot_surface = surface
    axis_color = options.axis_color if options.axis_color is not None else theme.muted

    # Whether the bottom row belongs to the time axis rather than the plot.
    # Decided before the y-axis labels are written: the minimum marks the bottom
    # of the *plot*, and the time axis takes that row away. Writing it at
    # height - 1 regardless put it against the first time label, so "$0" and
    # "08-10" rendered as "$008-10".
    time_axis_row = bool(options.time_axis) and surface.height > 2

    if options.axis:
        # Match the window the plot itself will use, so the labels stay truthful.
        columns = surface.width * 2 if options.plot.mode == FillMode.BRAILLE else surface.width
        n = max(1, columns)
        values = [
            v
            for s in series
            for v in (s.values if len(s.values) <= n else s.values[len(s.values) - n :])
            if v == v and not math.isinf(v)
        ]
        maximum = options.plot.max if options.plot.max is not None else (max(values) if values else 1)
        minimum = options.plot.min if options.plot.min is not None else 0
        fmt = options.axis_format or nice_label
        label_width = max(string_width(fmt(maximum)), string_width(fmt(minimum))) + 1
        surface.text(
            0, 0, fit(fmt(maximum), label_width, Align.RIGHT), TextOptions(fg=axis_color)
        )
        if surface.height > 1:
            bottom = surface.height - 2 if time_axis_row else surface.height - 1
            surface.text(
                0, bottom, fit(fmt(minimum), label_width, Align.RIGHT),
                TextOptions(fg=axis_color),
            )
        plot_surface = surface.sub(
            label_width, 0, max(0, surface.width - label_width), surface.height
        )

    graph_surface = plot_surface
    if options.time_axis and plot_surface.height > 1:
        graph_surface = plot_surface.sub(0, 0, plot_surface.width, plot_surface.height - 1)
        labels = list(options.time_axis)
        step = (plot_surface.width - 1) / (len(labels) - 1) if len(labels) > 1 else 0
        for i, label in enumerate(labels):
            x = min(plot_surface.width - string_width(label), int(round_half_up(i * step)))
            plot_surface.text(
                max(0, x), plot_surface.height - 1, label, TextOptions(fg=axis_color)
            )

    plot(graph_surface, series, options.plot)

    if options.legend:
        parts = [
            (s.label, s.color if s.color is not None else series_color(theme, i))
            for i, s in enumerate(series)
            if s.label
        ]
        total = sum(string_width(label) + 3 for label, _ in parts)
        x = max(0, graph_surface.width - total) if options.legend_align == Align.RIGHT else 0
        # Sit the legend on the last row when there is one to spare, so it never
        # lands on top of the plot's busiest corner.
        y = graph_surface.height - 1 if graph_surface.height > 3 else 0
        for label, color in parts:
            x += graph_surface.text(x, y, "■ ", TextOptions(fg=color))
            x += graph_surface.text(x, y, f"{label} ", TextOptions(fg=theme.muted))


@dataclass(frozen=True, slots=True)
class SparklineWidgetOptions:
    values: Sequence[float] = ()
    color: Color | None = None
    colors: Sequence[Color] = ()
    min: float | None = None
    max: float | None = None
    label: str = ""
    text: str = ""
    background: Color | None = None


def draw_sparkline(surface: Surface, options: SparklineWidgetOptions) -> None:
    """One-row trend, optionally with a label and a right-hand readout."""
    if surface.empty:
        return
    theme = surface.theme
    label_width = string_width(options.label) + 1 if options.label else 0
    value_width = string_width(options.text) + 1 if options.text else 0
    if options.label:
        surface.text(
            0, 0, options.label, TextOptions(fg=theme.muted, bg=options.background)
        )
    width = surface.width - label_width - value_width
    if width > 0:
        sparkline(
            surface.sub(label_width, 0, width, 1), options.values,
            SparklineOptions(
                color=options.color, colors=options.colors, min=options.min,
                max=options.max, background=options.background,
            ),
        )
    if value_width > 0:
        surface.text(
            surface.width - value_width, 0, fit(options.text, value_width, Align.RIGHT),
            TextOptions(
                fg=options.color if options.color is not None else theme.accent,
                bg=options.background, attrs=Attrs.BOLD,
            ),
        )


@dataclass(frozen=True, slots=True)
class HeatBarOptions:
    value: float = 0.0
    """0-1. Renders like btop's temperature bars."""
    width: int | None = None
    color: Color | None = None
    background: Color | None = None
    char: str = "▮"


def draw_heat_bar(surface: Surface, options: HeatBarOptions) -> None:
    """A segmented heat bar: discrete ticks colored along the theme ramp."""
    if surface.empty:
        return
    theme = surface.theme
    ratio = clamp01(options.value)
    width = min(options.width if options.width is not None else surface.width, surface.width)
    filled = int(round_half_up(ratio * width))
    ramp = Gradient(theme.heat)
    off = theme.background.mix(theme.border, 0.75)
    for x in range(width):
        if x < filled:
            if options.color is not None:
                fg = options.color
            else:
                fg = ramp.sample(ratio if width <= 1 else x / (width - 1))
        else:
            fg = off
        surface.char(x, 0, options.char, Style(fg=fg, bg=options.background))


@dataclass(frozen=True, slots=True)
class ColumnsOptions:
    values: Sequence[float] = ()
    color: Color | None = None
    colors: Sequence[Color] = ()
    max: float | None = None
    background: Color | None = None


def draw_columns(surface: Surface, options: ColumnsOptions) -> None:
    """Block-mode column chart. Cheaper than Braille and reads well when short."""
    if surface.empty:
        return
    theme = surface.theme
    maximum = options.max if options.max is not None else max([1.0, *options.values])
    ramp = Gradient(options.colors) if options.colors else None
    count = min(len(options.values), surface.width)
    start = len(options.values) - count
    h = surface.height
    for i in range(count):
        ratio = clamp01(options.values[start + i] / maximum)
        filled = ratio * h
        full = math.floor(filled)
        color = (
            ramp.sample(ratio) if ramp
            else (options.color if options.color is not None else theme.primary)
        )
        style = Style(fg=color, bg=options.background)
        for k in range(full):
            surface.char(i, h - 1 - k, "█", style)
        if full < h:
            glyph = vertical_glyph(filled - full, FillMode.BLOCK)
            if glyph != " ":
                surface.char(i, h - 1 - full, glyph, style)
