"""Two primitives for the space behind a widget rather than the widget itself.

``modal`` already blanks the region it is about to draw into, but it does it
privately, so anything else that floats — a custom overlay, a popover, a
tooltip somebody wrote themselves — has no way to say "this region is mine
now". These make that sayable.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..buffer import Attrs, Style
from ..color import Color
from ..surface import Surface
from ..unicode import string_width

__all__ = ["ClearOptions", "FillOptions", "draw_clear", "draw_fill"]


@dataclass(frozen=True, slots=True)
class ClearOptions:
    #: What to leave behind. Defaults to the theme's background.
    background: Color | None = None


def draw_clear(surface: Surface, options: ClearOptions = ClearOptions()) -> None:
    """Reset a region to empty, so an overlay can draw over what was there.

    Without this an overlay is drawn *into* whatever it lands on: the cells it
    does not touch keep the widget underneath, and a dialog ends up with someone
    else's table showing through the gaps between its words.
    """
    if surface.empty:
        return
    theme = surface.theme
    background = options.background if options.background is not None else theme.background
    surface.fill(Style(fg=theme.foreground, bg=background, attrs=Attrs.NONE))


@dataclass(frozen=True, slots=True)
class FillOptions:
    #: The symbol to repeat. A wide one is stepped over rather than written per
    #: column, since each glyph owns a continuation cell.
    symbol: str = " "
    fg: Color | None = None
    bg: Color | None = None
    attrs: Attrs | None = None


def draw_fill(surface: Surface, options: FillOptions = FillOptions()) -> None:
    """Flood a region with one repeated symbol and style."""
    if surface.empty:
        return
    symbol = options.symbol or " "
    style = Style(fg=options.fg, bg=options.bg, attrs=options.attrs)
    glyph_width = max(1, string_width(symbol))
    # A one-cell symbol is what ``fill`` is for. Anything wider has to be
    # stepped over rather than written per column: each glyph owns a
    # continuation cell, and writing the next one on top of it leaves a row of
    # half-characters.
    if glyph_width == 1:
        surface.fill(style, ord(symbol[0]))
        return
    for y in range(surface.height):
        # The last glyph is dropped rather than clipped when the region does not
        # divide evenly: half a wide character is not a fill, it is damage.
        for x in range(0, surface.width - glyph_width + 1, glyph_width):
            surface.char(x, y, symbol, style)
