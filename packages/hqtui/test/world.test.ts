import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen } from "../src/index.ts";
import {
  WORLD_COUNTRIES, WORLD_X, WORLD_Y, countryAt, countryBounds, degreesAt, findCountry,
  worldShapes,
} from "../src/graphics/world.ts";
import { countryAtCell } from "../src/widgets/world.ts";

test("world: the data covers the countries a map is expected to have", () => {
  assert.ok(WORLD_COUNTRIES.length > 160, `only ${WORLD_COUNTRIES.length} countries`);
  // Sorted by name, which is what makes the overlap tie-break below stable.
  const names = WORLD_COUNTRIES.map((c) => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  for (const key of ["France", "Japan", "Brazil", "Kenya", "Australia"]) {
    assert.ok(findCountry(key), `${key} is missing`);
  }
  // ISO codes work as keys too, which is what an app is likely to have.
  assert.equal(findCountry("JP")?.name, "Japan");
  assert.equal(findCountry("jp")?.name, "Japan", "the lookup is case-insensitive");
});

test("world: every ring is a closed list of finite coordinate pairs", () => {
  for (const country of WORLD_COUNTRIES) {
    for (const ring of country.rings) {
      assert.equal(ring.length % 2, 0, `${country.name}: odd coordinate count`);
      assert.ok(ring.length >= 6, `${country.name}: a ring needs three points`);
      for (let i = 0; i + 1 < ring.length; i += 2) {
        assert.ok(Number.isFinite(ring[i]) && Number.isFinite(ring[i + 1]));
        assert.ok(ring[i] >= -180.5 && ring[i] <= 180.5, `${country.name}: longitude ${ring[i]}`);
        assert.ok(ring[i + 1] >= -90.5 && ring[i + 1] <= 90.5, `${country.name}: latitude ${ring[i + 1]}`);
      }
    }
  }
});

test("world: a point lands in the country that is actually there", () => {
  // Capitals, which is the least arguable way to check a polygon lookup.
  const cities: [string, number, number, string][] = [
    ["Paris", 2.35, 48.86, "France"],
    ["Tokyo", 139.7, 35.7, "Japan"],
    ["Cairo", 31.2, 30.0, "Egypt"],
    ["Brasilia", -47.9, -15.8, "Brazil"],
    ["Canberra", 149.1, -35.3, "Australia"],
    ["Denver", -105.0, 39.7, "United States of America"],
    ["Moscow", 37.6, 55.75, "Russia"],
    ["Delhi", 77.2, 28.6, "India"],
  ];
  for (const [city, lon, lat, expected] of cities) {
    assert.equal(countryAt(lon, lat)?.name, expected, `${city} (${lon}, ${lat})`);
  }
});

test("world: the open ocean is not a country", () => {
  // A bounding-box lookup would answer Russia or Chile for half of these.
  for (const [lon, lat] of [[-140, 0], [-30, 0], [-25, -40], [80, -40], [-150, 40]]) {
    assert.equal(countryAt(lon, lat), undefined, `(${lon}, ${lat}) claimed land`);
  }
});

test("world: nonsense coordinates are water, not a crash", () => {
  assert.equal(countryAt(Number.NaN, 0), undefined);
  assert.equal(countryAt(0, Number.POSITIVE_INFINITY), undefined);
});

test("world: a cell maps back to the degrees it was drawn from", () => {
  // If this is off by even half a cell, every click lands somewhere the user
  // did not point at, and nothing about the map would look wrong.
  const w = 100;
  const h = 26;
  for (let row = 0; row < h; row++) {
    for (let column = 0; column < w; column++) {
      const at = degreesAt(column, row, w, h);
      assert.ok(at, `no degrees for (${column}, ${row})`);
      const px = ((at.lon - WORLD_X.min) / 360) * (w * 2 - 1);
      const py = (1 - (at.lat - WORLD_Y.min) / 180) * (h * 4 - 1);
      assert.equal(Math.floor(px / 2), column, `column ${column} came back as ${px / 2}`);
      assert.equal(Math.floor(py / 4), row, `row ${row} came back as ${py / 4}`);
    }
  }
});

test("world: an empty map has no cells to click", () => {
  assert.equal(degreesAt(0, 0, 0, 10), undefined);
  assert.equal(degreesAt(0, 0, 10, 0), undefined);
});

test("world: clicking a cell over a country reports that country", () => {
  // Big enough that a country is more than one cell wide, which is the case
  // where the answer is unambiguous.
  const w = 200;
  const h = 50;
  const cellOf = (lon: number, lat: number): [number, number] => [
    Math.round((((lon + 180) / 360) * (w * 2 - 1) - 1) / 2),
    Math.round(((1 - (lat + 90) / 180) * (h * 4 - 1) - 2) / 4),
  ];
  const cases: [string, number, number][] = [
    ["Japan", 138.0, 36.5],
    ["Brazil", -50.0, -10.0],
    ["Australia", 134.0, -25.0],
    ["Egypt", 29.0, 26.0],
    ["India", 78.0, 22.0],
  ];
  for (const [expected, lon, lat] of cases) {
    const [column, row] = cellOf(lon, lat);
    assert.equal(countryAtCell(column, row, w, h)?.name, expected, `${expected} at (${lon}, ${lat})`);
  }
});

test("world: zooming changes which country a given cell holds", () => {
  // The same cell over two different windows is two different places, which is
  // the whole reason the lookup takes the bounds.
  const japan = countryBounds(findCountry("Japan")!);
  // A cell that is Honshu once the map is zoomed to Japan, and Russia when the
  // same map shows the whole globe.
  const cell = { column: 74, row: 2 };
  const whole = countryAtCell(cell.column, cell.row, 100, 26);
  const zoomed = countryAtCell(cell.column, cell.row, 100, 26, japan);
  assert.equal(zoomed?.name, "Japan");
  assert.equal(whole?.name, "Russia");
});

test("world: a country's window contains it, with room around it", () => {
  const japan = findCountry("Japan")!;
  const bounds = countryBounds(japan);
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const ring of japan.rings) {
    for (let i = 0; i + 1 < ring.length; i += 2) {
      minLon = Math.min(minLon, ring[i]);
      maxLon = Math.max(maxLon, ring[i]);
    }
  }
  assert.ok(bounds.x.min < minLon, "no margin on the left");
  assert.ok(bounds.x.max > maxLon, "no margin on the right");
});

test("world: shapes are closed rings, so a coastline has no seam", () => {
  const shapes = worldShapes();
  assert.ok(shapes.length > 200, `only ${shapes.length} shapes`);
  for (const shape of shapes) {
    assert.equal(shape.type, "polyline");
    if (shape.type !== "polyline") continue;
    const first = shape.points[0];
    const last = shape.points[shape.points.length - 1];
    assert.deepEqual(first, last, "a ring that does not close leaves a gap");
  }
});

test("world: highlighted countries are drawn in their own colour", () => {
  const shapes = worldShapes({ color: 0x111111, highlight: ["JP"], highlightColor: 0x222222 });
  const colours = new Set(shapes.map((s) => s.color));
  assert.deepEqual([...colours].sort(), [0x111111, 0x222222]);
});

test("world: the map draws, and draws differently when zoomed", () => {
  const whole = renderToScreen(({ ui }) => ui.worldMap({}), { width: 60, height: 16 }).text();
  assert.ok(whole.trim().length > 0, "nothing was drawn");
  const japan = countryBounds(findCountry("Japan")!);
  const zoomed = renderToScreen(({ ui }) => ui.worldMap(japan), { width: 60, height: 16 }).text();
  assert.notEqual(whole, zoomed);
});

test("world: a map with no handlers registers nothing to click", () => {
  const plain = renderToScreen(({ ui }) => ui.worldMap({}), { width: 40, height: 12 });
  assert.equal(plain.regions.length, 0);

  let picked: string | undefined;
  const live = renderToScreen(
    ({ ui }) => ui.worldMap({ onSelect: (c) => { picked = c?.name; } }),
    { width: 200, height: 50 },
  );
  assert.equal(live.regions.length, 1);
  // A click over Australia comes back as Australia.
  live.regions[0].onClick?.(173, 28, "left");
  assert.equal(picked, "Australia");

  // And a click on open water comes back as nothing, rather than the nearest
  // bounding box.
  live.regions[0].onClick?.(20, 25, "left");
  assert.equal(picked, undefined);
});
