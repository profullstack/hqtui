"""A world map you can click.

The drawing is the canvas doing what it already does — polylines in the caller's
own coordinates, which for a map are degrees. What this adds is the other
direction: turning a click back into a country.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from ..color import Color
from ..graphics.canvas import Bounds, CanvasOptions, draw_canvas
from ..graphics.world import (
    WORLD_X,
    WORLD_Y,
    CountryOutline,
    WorldShapeOptions,
    country_at,
    degrees_at,
    world_shapes,
)
from ..surface import Surface

__all__ = ["WorldMapOptions", "country_at_cell", "draw_world_map"]


@dataclass(frozen=True, slots=True)
class WorldMapOptions:
    #: The window on the globe. None means all of it.
    x: Bounds | None = None
    y: Bounds | None = None
    #: Coastline colour.
    color: Color | None = None
    #: Countries to pick out, by name or ISO code.
    highlight: Sequence[str] = ()
    highlight_color: Color | None = None
    background: Color | None = None
    grid: bool = False

    @property
    def window(self) -> tuple[Bounds, Bounds]:
        return (self.x or WORLD_X, self.y or WORLD_Y)


def draw_world_map(surface: Surface, options: WorldMapOptions = WorldMapOptions()) -> None:
    if surface.empty:
        return
    theme = surface.theme
    x, y = options.window
    draw_canvas(
        surface,
        CanvasOptions(
            shapes=world_shapes(
                WorldShapeOptions(
                    color=options.color if options.color is not None else theme.border,
                    highlight=options.highlight,
                    highlight_color=(
                        options.highlight_color
                        if options.highlight_color is not None
                        else theme.accent
                    ),
                )
            ),
            x=x,
            y=y,
            background=options.background,
            grid=options.grid,
        ),
    )


def country_at_cell(
    column: int,
    row: int,
    width: int,
    height: int,
    options: WorldMapOptions = WorldMapOptions(),
) -> CountryOutline | None:
    """The country under a cell of a map drawn with these bounds.

    Exposed so a caller can answer a hover as well as a click, and so the
    arithmetic that has to agree with the drawing lives in one place.
    """
    x, y = options.window
    at = degrees_at(column, row, width, height, x, y)
    if at is None:
        return None
    return country_at(at[0], at[1])
