/**
 * Prints what the country lookup answers for a fixed set of points.
 *
 * The same probe exists for every port, so "the ports agree about the world" is
 * a diff rather than a hope. The reference output is this one, because the
 * TypeScript implementation is the reference for everything else too.
 *
 *   bun packages/hqtui/scripts/world-probe.ts
 */
import { WORLD_X, WORLD_Y, countryAt, degreesAt } from "../src/graphics/world.ts";
import { countryAtCell } from "../src/widgets/world.ts";

const places: [string, number, number][] = [
  ["Paris", 2.35, 48.86],
  ["Tokyo", 139.7, 35.7],
  ["Cairo", 31.2, 30.0],
  ["Brasilia", -47.9, -15.8],
  ["Canberra", 149.1, -35.3],
  ["Denver", -105.0, 39.7],
  ["Moscow", 37.6, 55.75],
  ["Delhi", 77.2, 28.6],
  ["Nairobi", 36.8, -1.3],
  ["Pacific", -140.0, 0.0],
  ["Atlantic", -30.0, 0.0],
  ["SouthernOcean", 80.0, -40.0],
  ["NorthPacific", -150.0, 40.0],
];
for (const [name, lon, lat] of places) {
  console.log(`${name} ${countryAt(lon, lat)?.name ?? "-"}`);
}

// The cell path, which has to agree with what the canvas drew.
for (const [column, row] of [[173, 28], [74, 2], [20, 25], [88, 7]]) {
  console.log(`cell:${column},${row} ${countryAtCell(column, row, 200, 50)?.name ?? "-"}`);
}

// And the projection itself, so a drift shows up as a number rather than as a
// country that happens to still be right.
for (const [column, row] of [[0, 0], [99, 25], [50, 13]]) {
  const at = degreesAt(column, row, 100, 26, WORLD_X, WORLD_Y);
  console.log(`degrees:${column},${row} ${at!.lon.toFixed(4)} ${at!.lat.toFixed(4)}`);
}
