"""Sub-cell graphics: a Braille pixel canvas, block-element ramps, and the
plotting primitives built on them."""

from .blocks import (
    ASCII_RAMP,
    FillMode,
    HORIZONTAL_EIGHTHS,
    QUADRANTS,
    SHADES,
    VERTICAL_EIGHTHS,
    best_mode,
    clamp01,
    horizontal_glyph,
    shade_glyph,
    vertical_glyph,
)
from .braille import BrailleCanvas
from .plot import (
    BarOptions,
    BarStyle,
    DonutOptions,
    DonutSegment,
    GaugeOptions,
    HistogramOptions,
    PlotOptions,
    Series,
    SparklineOptions,
    bar,
    blit,
    donut,
    gauge,
    histogram,
    plot,
    sparkline,
)

__all__ = [
    "ASCII_RAMP", "BarOptions", "BarStyle", "BrailleCanvas", "DonutOptions",
    "DonutSegment", "FillMode", "GaugeOptions", "HORIZONTAL_EIGHTHS",
    "HistogramOptions", "PlotOptions", "QUADRANTS", "SHADES", "Series",
    "SparklineOptions", "VERTICAL_EIGHTHS", "bar", "best_mode", "blit",
    "clamp01", "donut", "gauge", "histogram", "horizontal_glyph", "plot",
    "shade_glyph", "sparkline", "vertical_glyph",
]
