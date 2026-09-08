"""A scrollbar, on its own.

The renderer used to live inside the table and was reachable only by being a
table, list, tree or log. Anything else that scrolls — a wrapped paragraph, a
canvas, a ``draw()`` somebody wrote themselves — could not show one.

This is the same drawing, lifted out and given the four edges plus state the
caller owns. The dense widgets route through it, so there is one implementation
and one appearance.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..buffer import Style
from ..color import round_half_up
from ..surface import Surface

#: Which edge the bar sits on, and therefore which way it runs.
ScrollbarOrientation = Literal["right", "left", "bottom", "top"]


@dataclass(frozen=True, slots=True)
class ScrollbarOptions:
    """How much there is, how much of it is visible, and how far through it we
    are — the state the caller owns."""

    total: int = 0
    viewport: int = 0
    offset: int = 0
    orientation: ScrollbarOrientation = "right"


def is_vertical(orientation: ScrollbarOrientation) -> bool:
    return orientation in ("right", "left")


def thumb(track: int, total: int, offset: int, viewport: int | None = None) -> tuple[int, int]:
    """Where the thumb starts and how long it is, in cells along the track.

    Split out because it is the whole of the behaviour: everything else is
    putting characters in a line. A thumb is never shorter than one cell, or it
    would vanish on a long document, and never starts past the end of the track.

    The thumb is as long as the visible fraction, so it needs the viewport as
    well as the track. For a table those are the same number — the bar is
    exactly as tall as the rows it describes — which is why ``viewport``
    defaults to the track. A bar you place yourself has no such guarantee.
    """
    if track <= 0 or total <= 0:
        return (0, 0)
    visible = viewport if viewport and viewport > 0 else track
    if total <= visible:
        return (0, track)
    size = min(track, max(1, int(round_half_up(visible / total * track))))
    max_offset = max(1, total - visible)
    clamped = max(0, min(offset, max_offset))
    start = int(round_half_up(clamped / max_offset * (track - size)))
    return (max(0, min(start, track - size)), size)


def draw_scrollbar(
    surface: Surface, x: int, y: int, height: int, total: int, offset: int
) -> None:
    """The original signature, kept because the table, list, tree and log all
    call it this way and their fixtures pin the result."""
    theme = surface.theme
    track = theme.background.mix(theme.border, 0.7)
    start, size = thumb(height, total, offset)
    for i in range(height):
        in_thumb = start <= i < start + size
        surface.char(
            x, y + i, "█" if in_thumb else "│",
            Style(fg=theme.accent if in_thumb else track),
        )


def draw_scrollbar_widget(surface: Surface, options: ScrollbarOptions) -> None:
    """A scrollbar filling the surface it is given, on whichever edge.

    A horizontal bar uses the half-height glyphs rather than the full block: a
    run of full blocks across a row reads as a solid rule, which is not what a
    thumb is meant to look like.
    """
    if surface.width == 0 or surface.height == 0:
        return
    vertical = is_vertical(options.orientation)
    theme = surface.theme
    track_color = theme.background.mix(theme.border, 0.7)

    length = surface.height if vertical else surface.width
    viewport = options.viewport if options.viewport > 0 else length
    start, size = thumb(length, options.total, options.offset, viewport)

    if vertical:
        line = surface.width - 1 if options.orientation == "right" else 0
    else:
        line = surface.height - 1 if options.orientation == "bottom" else 0

    for i in range(length):
        in_thumb = start <= i < start + size
        if vertical:
            glyph = "█" if in_thumb else "│"
        else:
            glyph = "━" if in_thumb else "─"
        style = Style(fg=theme.accent if in_thumb else track_color)
        if vertical:
            surface.char(line, i, glyph, style)
        else:
            surface.char(i, line, glyph, style)


def offset_for_position(position: int, track: int, total: int, viewport: int) -> int:
    """Which offset a click at ``position`` along the track means.

    The thumb centres on the click, which is what every scrollbar does and what
    makes dragging feel like dragging rather than nudging.
    """
    visible = viewport if viewport > 0 else track
    if track <= 0 or total <= visible:
        return 0
    _, size = thumb(track, total, 0, visible)
    usable = max(1, track - size)
    at = max(0, min(position - size // 2, usable))
    return int(round_half_up(at / usable * (total - visible)))
