/**
 * The world, as shapes for the canvas, and the lookup that makes it clickable.
 *
 * The canvas already draws in the caller's own coordinates, and longitude and
 * latitude are just another pair of axes -- so a map is a list of polylines in
 * degrees, and nothing here needs a projection of its own beyond deciding which
 * window on the globe to show.
 *
 * The interesting half is the other direction. A click arrives as a terminal
 * cell, and a country is a polygon, so answering "what did they click" means
 * turning the cell back into degrees and testing it against the outlines. Doing
 * it that way rather than with bounding boxes is what makes the answer right:
 * Russia's bounding box covers most of the northern hemisphere, and Chile's
 * covers Argentina.
 */
import type { Color } from "../color.ts";
import type { Bounds, Shape } from "./canvas.ts";
import { type CountryOutline, WORLD_COUNTRIES } from "./world-data.ts";

export { type CountryOutline, WORLD_COUNTRIES };

/** The whole globe, which is what a map shows unless told otherwise. */
export const WORLD_X: Bounds = { min: -180, max: 180 };
export const WORLD_Y: Bounds = { min: -90, max: 90 };

export interface WorldShapeOptions {
  /** Colour for countries with nothing special about them. */
  color?: Color;
  /** Countries to pick out, by name or ISO code. */
  highlight?: readonly string[];
  highlightColor?: Color;
}

/** Match on either the name or the ISO code, case-insensitively. */
function matches(country: CountryOutline, keys: readonly string[]): boolean {
  for (const key of keys) {
    if (key.length === 0) continue;
    if (country.name.toLowerCase() === key.toLowerCase()) return true;
    if (country.iso.length > 0 && country.iso.toLowerCase() === key.toLowerCase()) return true;
  }
  return false;
}

/**
 * The world as canvas shapes, one polyline per landmass.
 *
 * Polylines rather than scattered points: the outlines are closed rings, so
 * joining them draws a coastline instead of a dotted suggestion of one, and it
 * reads at a fraction of the resolution dots would need.
 */
export function worldShapes(options: WorldShapeOptions = {}): Shape[] {
  const shapes: Shape[] = [];
  const highlight = options.highlight ?? [];
  for (const country of WORLD_COUNTRIES) {
    const picked = highlight.length > 0 && matches(country, highlight);
    const color = picked ? options.highlightColor ?? options.color : options.color;
    for (const ring of country.rings) {
      const points: [number, number][] = [];
      for (let i = 0; i + 1 < ring.length; i += 2) points.push([ring[i], ring[i + 1]]);
      // Closed: the last point joins the first, or every country has a gap in
      // its coastline where the ring started.
      if (points.length > 0) points.push(points[0]);
      shapes.push({ type: "polyline", points, color });
    }
  }
  return shapes;
}

/**
 * Whether a point is inside a ring, by ray casting.
 *
 * The ring is a flat list of interleaved coordinates, so this walks it two at a
 * time rather than allocating a pair per vertex -- it runs once per country per
 * click, and there are a couple of thousand vertices.
 */
function insideRing(ring: number[], lon: number, lat: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const yi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const yj = ring[j * 2 + 1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The country containing a point, or undefined for open water.
 *
 * Where outlines overlap -- and at this resolution simplified borders do
 * overlap -- the first match wins, which is stable because the data is sorted
 * by name.
 */
export function countryAt(lon: number, lat: number): CountryOutline | undefined {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
  for (const country of WORLD_COUNTRIES) {
    for (const ring of country.rings) {
      if (insideRing(ring, lon, lat)) return country;
    }
  }
  return undefined;
}

/** Look a country up by name or ISO code. */
export function findCountry(key: string): CountryOutline | undefined {
  return WORLD_COUNTRIES.find((c) => matches(c, [key]));
}

/**
 * The window a country fills, with a little room around it.
 *
 * For zooming a map to a country: the bounding box alone puts the coastline
 * flat against the edge of the panel, which reads as though the country has
 * been cut off rather than framed.
 */
export function countryBounds(
  country: CountryOutline,
  margin = 0.08,
): { x: Bounds; y: Bounds } {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of country.rings) {
    for (let i = 0; i + 1 < ring.length; i += 2) {
      minLon = Math.min(minLon, ring[i]);
      maxLon = Math.max(maxLon, ring[i]);
      minLat = Math.min(minLat, ring[i + 1]);
      maxLat = Math.max(maxLat, ring[i + 1]);
    }
  }
  if (!Number.isFinite(minLon)) return { x: WORLD_X, y: WORLD_Y };
  // A single-point country would give a zero-width window, which cannot be
  // mapped onto anything.
  const padX = Math.max((maxLon - minLon) * margin, 1);
  const padY = Math.max((maxLat - minLat) * margin, 1);
  return {
    x: { min: minLon - padX, max: maxLon + padX },
    y: { min: minLat - padY, max: maxLat + padY },
  };
}

/**
 * The degrees under a terminal cell, given the window the map was drawn with.
 *
 * The inverse of what the canvas does on the way in, taken at the centre of the
 * cell: a click lands on a whole cell, and the centre is the only point in it
 * that is not arbitrarily nearer one neighbour than the other.
 */
export function degreesAt(
  column: number,
  row: number,
  width: number,
  height: number,
  x: Bounds = WORLD_X,
  y: Bounds = WORLD_Y,
): { lon: number; lat: number } | undefined {
  if (width <= 0 || height <= 0) return undefined;
  // The canvas is 2x4 Braille pixels per cell, and it spans its bounds across
  // `pixels - 1`, so the inverse has to use the same denominators or a click
  // drifts from what was drawn.
  const px = Math.max(1, width * 2 - 1);
  const py = Math.max(1, height * 4 - 1);
  const lon = x.min + ((column * 2 + 1) / px) * (x.max - x.min);
  const lat = y.min + (1 - (row * 4 + 2) / py) * (y.max - y.min);
  return { lon, lat };
}
