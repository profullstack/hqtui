"""A chart with two real axes.

``graph`` plots a history buffer: one sample per column, x meaning "position in
the list". This plots data that has its own x values, with a labelled domain on
both axes, so two series of different lengths line up and a point lands where
its x says it does.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Sequence

from ..color import Color, round_half_up
from ..graphics.chart import (
    AxisOptions,
    ChartPlotOptions,
    ChartSeries,
    domain_of,
    plot_points,
)
from ..surface import Align, Surface, TextOptions
from ..theme import series_color
from ..unicode import fit, string_width
from .meters import nice_label

__all__ = ["ChartOptions", "draw_chart"]


@dataclass(slots=True)
class ChartOptions:
    series: Sequence[ChartSeries] = ()
    plot: ChartPlotOptions = field(default_factory=ChartPlotOptions)
    #: Numbers down the left edge.
    axis: bool = False
    axis_color: Color | None = None
    legend: bool = False
    legend_align: Align = "left"


def _ticks_for(minimum: float, maximum: float, count: int) -> list[float]:
    """Evenly spaced values across a domain, ends included.

    Two ticks means the ends and nothing else, which is what an axis wants when
    there is no room to say more.
    """
    n = max(2, int(count))
    return [minimum + (maximum - minimum) * i / (n - 1) for i in range(n)]


def _format_with(axis: AxisOptions | None, value: float) -> str:
    if axis is not None and axis.format is not None:
        return axis.format(value)
    return nice_label(value)


def draw_chart(surface: Surface, options: ChartOptions) -> None:
    if surface.empty:
        return
    theme = surface.theme
    series = list(options.series)
    axis_color = options.axis_color if options.axis_color is not None else theme.muted

    xd = domain_of(series, options.plot.x, 0)
    yd = domain_of(series, options.plot.y, 1)

    # The x labels take a row, and they can only take one when there is a row to
    # spare — a two-row chart is all plot.
    x_ticks = 2 if options.axis else 0
    if options.plot.x is not None and options.plot.x.ticks > 0:
        x_ticks = options.plot.x.ticks
    want_x_axis = options.axis and x_ticks >= 2 and surface.height > 2

    plot_surface = surface
    if options.axis:
        hi = _format_with(options.plot.y, yd.max)
        lo = _format_with(options.plot.y, yd.min)
        width = max(string_width(hi), string_width(lo)) + 1
        surface.text(0, 0, fit(hi, width, "right"), TextOptions(fg=axis_color))
        if surface.height > 1:
            # The minimum marks the bottom of the plot, which is a row higher
            # when the x labels have taken the last one.
            bottom = surface.height - 2 if want_x_axis else surface.height - 1
            surface.text(0, bottom, fit(lo, width, "right"), TextOptions(fg=axis_color))
        plot_surface = surface.sub(width, 0, surface.width - width, surface.height)

    area = plot_surface
    if want_x_axis and plot_surface.height > 1 and plot_surface.width > 0:
        area = plot_surface.sub(0, 0, plot_surface.width, plot_surface.height - 1)
        row = plot_surface.height - 1
        labels = [
            _format_with(options.plot.x, v) for v in _ticks_for(xd.min, xd.max, x_ticks)
        ]
        step = (plot_surface.width - 1) / (len(labels) - 1) if len(labels) > 1 else 0.0
        for i, label in enumerate(labels):
            # The last label is right-aligned to the edge, so it cannot run off it.
            x = min(plot_surface.width - string_width(label), int(round_half_up(i * step)))
            plot_surface.text(max(0, x), row, label, TextOptions(fg=axis_color))

    # The domain is resolved once and handed down, so the labels and the marks
    # cannot disagree about what the axis spans.
    plot = replace(
        options.plot,
        x=replace(options.plot.x or AxisOptions(), min=xd.min, max=xd.max),
        y=replace(options.plot.y or AxisOptions(), min=yd.min, max=yd.max),
    )
    plot_points(area, series, plot)

    if options.legend:
        parts = [
            (s.label, s.color if s.color is not None else series_color(theme, i))
            for i, s in enumerate(series)
            if s.label
        ]
        if options.legend_align == "right":
            total = sum(string_width(label) + 3 for label, _ in parts)
            x = max(0, area.width - total)
        else:
            x = 0
        y = area.height - 1 if area.height > 3 else 0
        for label, color in parts:
            x += area.text(x, y, "■ ", TextOptions(fg=color))
            x += area.text(x, y, f"{label} ", TextOptions(fg=theme.muted))
