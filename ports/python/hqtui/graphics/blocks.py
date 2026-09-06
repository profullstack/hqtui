"""Sub-cell glyph ramps. Every one degrades to ASCII when Unicode is off."""

from __future__ import annotations

import math
from enum import Enum

from ..color import round_half_up

__all__ = [
    "ASCII_RAMP",
    "FillMode",
    "HORIZONTAL_EIGHTHS",
    "QUADRANTS",
    "SHADES",
    "VERTICAL_EIGHTHS",
    "best_mode",
    "horizontal_glyph",
    "shade_glyph",
    "vertical_glyph",
]

HORIZONTAL_EIGHTHS = ("", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█")
"""Left-to-right eighths: ▏▎▍▌▋▊▉█ — horizontal bars and meters."""

VERTICAL_EIGHTHS = ("", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█")
"""Bottom-up eighths: ▁▂▃▄▅▆▇█ — sparklines and column charts."""

QUADRANTS = (
    " ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█",
)
"""Quadrants indexed by a 4-bit mask: 1=TL, 2=TR, 4=BL, 8=BR."""

SHADES = ("░", "▒", "▓", "█")
ASCII_RAMP = (" ", ".", ":", "-", "=", "+", "*", "#", "%", "@")

HALF_UPPER = "▀"
HALF_LOWER = "▄"
FULL_BLOCK = "█"


class FillMode(str, Enum):
    """How sub-cell detail is drawn.

    Braille is sharpest; the rest are the graceful degradations for terminals or
    fonts that cannot manage it.
    """

    BRAILLE = "braille"
    BLOCK = "block"
    HALF = "half"
    QUADRANT = "quadrant"
    ASCII = "ascii"


def clamp01(ratio: float) -> float:
    """Clamp to 0-1.

    NaN becomes 0 rather than propagating. The reference lets it through, where
    every subsequent comparison is false and the widget draws its empty state;
    Python would raise on ``math.floor(nan)`` instead, and 0 reaches the same
    empty state without the exception.
    """
    if ratio != ratio:
        return 0.0
    if ratio <= 0:
        return 0.0
    if ratio >= 1:
        return 1.0
    return ratio


def vertical_glyph(ratio: float, mode: "FillMode | str" = FillMode.BLOCK) -> str:
    """Pick the glyph for a 0-1 fill of one cell, bottom-up."""
    r = clamp01(ratio)
    if mode == FillMode.ASCII:
        if r == 0:
            return " "
        if r < 0.4:
            return "."
        return "=" if r < 0.7 else "#"
    if mode == FillMode.HALF:
        if r == 0:
            return " "
        return "▄" if r < 0.5 else "█"
    i = int(round_half_up(r * 8))
    return " " if i == 0 else VERTICAL_EIGHTHS[i]


def horizontal_glyph(ratio: float, mode: "FillMode | str" = FillMode.BLOCK) -> str:
    """Pick the glyph for a 0-1 fill of one cell, left to right."""
    r = clamp01(ratio)
    if mode == FillMode.ASCII:
        if r == 0:
            return " "
        return "-" if r < 0.5 else "#"
    i = int(round_half_up(r * 8))
    return " " if i == 0 else HORIZONTAL_EIGHTHS[i]


def shade_glyph(ratio: float, unicode: bool = True) -> str:
    """Map a 0-1 value onto a shade block, for heatmaps and dim fills."""
    r = clamp01(ratio)
    if not unicode:
        return ASCII_RAMP[int(round_half_up(r * (len(ASCII_RAMP) - 1)))]
    if r == 0:
        return " "
    return SHADES[min(len(SHADES) - 1, int(math.floor(r * len(SHADES))))]


def best_mode(unicode: bool, braille: bool) -> FillMode:
    """Braille when the terminal supports it, blocks when it does not."""
    if braille:
        return FillMode.BRAILLE
    return FillMode.BLOCK if unicode else FillMode.ASCII
