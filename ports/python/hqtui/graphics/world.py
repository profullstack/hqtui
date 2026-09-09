"""The world, as shapes for the canvas, and the lookup that makes it clickable.

The canvas already draws in the caller's own coordinates, and longitude and
latitude are just another pair of axes — so a map is a list of polylines in
degrees, and nothing here needs a projection of its own beyond deciding which
window on the globe to show.

The interesting half is the other direction. A click arrives as a terminal cell,
and a country is a polygon, so answering "what did they click" means turning the
cell back into degrees and testing it against the outlines. Doing it that way
rather than with bounding boxes is what makes the answer right: Russia's
bounding box covers most of the northern hemisphere, and Chile's covers
Argentina.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Sequence

from ..color import Color
from .canvas import Bounds, Shape
from .world_data import CountryOutline, WORLD_COUNTRIES

__all__ = [
    "WORLD_COUNTRIES",
    "WORLD_X",
    "WORLD_Y",
    "CountryOutline",
    "WorldShapeOptions",
    "country_at",
    "country_bounds",
    "degrees_at",
    "find_country",
    "world_shapes",
]

#: The whole globe, which is what a map shows unless told otherwise.
WORLD_X = Bounds(-180.0, 180.0)
WORLD_Y = Bounds(-90.0, 90.0)


@dataclass(frozen=True, slots=True)
class WorldShapeOptions:
    #: Colour for countries with nothing special about them.
    color: Color | None = None
    #: Countries to pick out, by name or ISO code.
    highlight: Sequence[str] = ()
    highlight_color: Color | None = None


def _matches(country: CountryOutline, keys: Sequence[str]) -> bool:
    """Match on either the name or the ISO code, case-insensitively."""
    for key in keys:
        if not key:
            continue
        if country.name.lower() == key.lower():
            return True
        if country.iso and country.iso.lower() == key.lower():
            return True
    return False


def world_shapes(options: WorldShapeOptions = WorldShapeOptions()) -> list[Shape]:
    """The world as canvas shapes, one polyline per landmass.

    Polylines rather than scattered points: the outlines are closed rings, so
    joining them draws a coastline instead of a dotted suggestion of one, and it
    reads at a fraction of the resolution dots would need.
    """
    shapes: list[Shape] = []
    for country in WORLD_COUNTRIES:
        picked = bool(options.highlight) and _matches(country, options.highlight)
        color = options.highlight_color if picked else options.color
        if picked and color is None:
            color = options.color
        for ring in country.rings:
            points = [(ring[i], ring[i + 1]) for i in range(0, len(ring) - 1, 2)]
            # Closed: the last point joins the first, or every country has a gap
            # in its coastline where the ring started.
            if points:
                points.append(points[0])
            shapes.append(Shape(kind="polyline", points=tuple(points), color=color))
    return shapes


def _inside_ring(ring: Sequence[float], lon: float, lat: float) -> bool:
    """Whether a point is inside a ring, by ray casting.

    The ring is a flat list of interleaved coordinates, so this walks it two at
    a time rather than allocating a pair per vertex — it runs once per country
    per click, and there are a couple of thousand vertices.
    """
    inside = False
    n = len(ring) // 2
    if n == 0:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i * 2], ring[i * 2 + 1]
        xj, yj = ring[j * 2], ring[j * 2 + 1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def country_at(lon: float, lat: float) -> CountryOutline | None:
    """The country containing a point, or None for open water.

    Where outlines overlap — and at this resolution simplified borders do
    overlap — the first match wins, which is stable because the data is sorted
    by name.
    """
    if not math.isfinite(lon) or not math.isfinite(lat):
        return None
    for country in WORLD_COUNTRIES:
        for ring in country.rings:
            if _inside_ring(ring, lon, lat):
                return country
    return None


def find_country(key: str) -> CountryOutline | None:
    """Look a country up by name or ISO code."""
    for country in WORLD_COUNTRIES:
        if _matches(country, (key,)):
            return country
    return None


def country_bounds(country: CountryOutline, margin: float = 0.08) -> tuple[Bounds, Bounds]:
    """The window a country fills, with a little room around it.

    For zooming a map to a country: the bounding box alone puts the coastline
    flat against the edge of the panel, which reads as though the country has
    been cut off rather than framed.
    """
    min_lon = min_lat = math.inf
    max_lon = max_lat = -math.inf
    for ring in country.rings:
        for i in range(0, len(ring) - 1, 2):
            min_lon = min(min_lon, ring[i])
            max_lon = max(max_lon, ring[i])
            min_lat = min(min_lat, ring[i + 1])
            max_lat = max(max_lat, ring[i + 1])
    if not math.isfinite(min_lon):
        return WORLD_X, WORLD_Y
    # A single-point country would give a zero-width window, which cannot be
    # mapped onto anything.
    pad_x = max((max_lon - min_lon) * margin, 1.0)
    pad_y = max((max_lat - min_lat) * margin, 1.0)
    return (
        Bounds(min_lon - pad_x, max_lon + pad_x),
        Bounds(min_lat - pad_y, max_lat + pad_y),
    )


def degrees_at(
    column: int,
    row: int,
    width: int,
    height: int,
    x: Bounds = WORLD_X,
    y: Bounds = WORLD_Y,
) -> tuple[float, float] | None:
    """The degrees under a terminal cell, given the window the map was drawn with.

    The inverse of what the canvas does on the way in, taken at the centre of
    the cell: a click lands on a whole cell, and the centre is the only point in
    it that is not arbitrarily nearer one neighbour than the other.
    """
    if width <= 0 or height <= 0:
        return None
    # The canvas is 2x4 Braille pixels per cell, and it spans its bounds across
    # ``pixels - 1``, so the inverse has to use the same denominators or a click
    # drifts from what was drawn.
    px = max(1, width * 2 - 1)
    py = max(1, height * 4 - 1)
    lon = x.min + ((column * 2 + 1) / px) * (x.max - x.min)
    lat = y.min + (1 - (row * 4 + 2) / py) * (y.max - y.min)
    return lon, lat
