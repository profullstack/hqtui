"""A drop shadow cast by a region onto whatever is behind it.

The point is that it dims what it covers rather than painting over it: a shadow
that filled its band with a flat colour would erase the dashboard underneath,
which is the opposite of what a shadow is for. Every covered cell keeps its own
character and its own hue, and only loses some of its light.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..buffer import Style
from ..color import Color, rgb
from ..layout import Rect
from ..surface import Surface

__all__ = ["ShadowOptions", "dim_rect", "draw_shadow"]


@dataclass(frozen=True, slots=True)
class ShadowOptions:
    #: How far the shadow falls.
    offset_x: int = 1
    offset_y: int = 1
    #: 0-1: how much light the covered cells lose.
    amount: float = 0.55
    #: Paint this colour instead of dimming what is underneath.
    #:
    #: For a shadow falling on empty background, where there is nothing to dim
    #: and a flat colour is cheaper and reads the same.
    color: Color | None = None


def dim_rect(
    surface: Surface, x: int, y: int, width: int, height: int, amount: float
) -> None:
    """Darken every cell in a region, keeping its character and its hue.

    Towards black rather than towards the theme's background: on a light theme
    the background *is* the light, so dimming towards it would make the shadow
    brighter than the page it falls on.
    """
    t = min(1.0, max(0.0, amount))
    black = rgb(0, 0, 0)
    buffer = surface.buffer
    clip = surface.clip
    for row in range(height):
        for col in range(width):
            ax = surface.rect.x + x + col
            ay = surface.rect.y + y + row
            if ax < clip.x or ay < clip.y or ax >= clip.x + clip.width or ay >= clip.y + clip.height:
                continue
            i = buffer.index(ax, ay)
            # The buffer stores raw ints, so each value is wrapped before it can
            # be mixed and unwrapped on the way back in.
            buffer.fg[i] = int(Color(buffer.fg[i]).mix(black, t))
            buffer.bg[i] = int(Color(buffer.bg[i]).mix(black, t))


def draw_shadow(surface: Surface, rect: Rect, options: ShadowOptions = ShadowOptions()) -> None:
    """Cast a shadow from ``rect`` onto ``surface``.

    The shadow is the band the region would cover if it were moved by the
    offset, minus the region itself. Drawn before the region is, so it never
    falls on top of it.
    """
    if surface.empty:
        return
    dx, dy = int(options.offset_x), int(options.offset_y)
    if dx == 0 and dy == 0:
        return

    def paint(x: int, y: int, w: int, h: int) -> None:
        if w <= 0 or h <= 0:
            return
        if options.color is not None:
            surface.fill_rect(x, y, w, h, Style(bg=options.color), 32)
        else:
            dim_rect(surface, x, y, w, h, options.amount)

    # The shadow is the moved region minus the original, which splits into two
    # rectangles that do not touch: the rows the move added, at the moved
    # region's full width, and then the columns it added over the rows the two
    # still share. Cutting it any other way overlaps at the corner, and a corner
    # dimmed twice reads as a smudge rather than an edge.
    tx, ty = rect.x + dx, rect.y + dy
    if dy > 0:
        paint(tx, rect.y + rect.height, rect.width, dy)
    elif dy < 0:
        paint(tx, ty, rect.width, -dy)

    y0 = max(rect.y, ty)
    shared = min(rect.y + rect.height, ty + rect.height) - y0
    if shared > 0:
        if dx > 0:
            paint(rect.x + rect.width, y0, dx, shared)
        elif dx < 0:
            paint(tx, y0, -dx, shared)
