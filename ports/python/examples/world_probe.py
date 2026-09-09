"""Prints what the country lookup answers for a fixed set of points.

The same probe exists for every port, so "the ports agree about the world" is a
diff rather than a hope.
"""

from __future__ import annotations

from hqtui.graphics.world import WORLD_X, WORLD_Y, country_at, degrees_at
from hqtui.widgets.world import WorldMapOptions, country_at_cell

PLACES = [
    ("Paris", 2.35, 48.86),
    ("Tokyo", 139.7, 35.7),
    ("Cairo", 31.2, 30.0),
    ("Brasilia", -47.9, -15.8),
    ("Canberra", 149.1, -35.3),
    ("Denver", -105.0, 39.7),
    ("Moscow", 37.6, 55.75),
    ("Delhi", 77.2, 28.6),
    ("Nairobi", 36.8, -1.3),
    ("Pacific", -140.0, 0.0),
    ("Atlantic", -30.0, 0.0),
    ("SouthernOcean", 80.0, -40.0),
    ("NorthPacific", -150.0, 40.0),
]

for name, lon, lat in PLACES:
    found = country_at(lon, lat)
    print(f"{name} {found.name if found else '-'}")

# The cell path, which has to agree with what the canvas drew.
for column, row in [(173, 28), (74, 2), (20, 25), (88, 7)]:
    found = country_at_cell(column, row, 200, 50, WorldMapOptions())
    print(f"cell:{column},{row} {found.name if found else '-'}")

# And the projection itself, so a drift shows up as a number rather than as a
# country that happens to still be right.
for column, row in [(0, 0), (99, 25), (50, 13)]:
    lon, lat = degrees_at(column, row, 100, 26, WORLD_X, WORLD_Y)
    print(f"degrees:{column},{row} {lon:.4f} {lat:.4f}")
