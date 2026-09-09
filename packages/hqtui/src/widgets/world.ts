/**
 * A world map you can click.
 *
 * The drawing is the canvas doing what it already does -- polylines in the
 * caller's own coordinates, which for a map are degrees. What this adds is the
 * other direction: turning a click back into a country.
 */
import type { Surface } from "../surface.ts";
import type { Color } from "../color.ts";
import type { Bounds } from "../graphics/canvas.ts";
import { drawCanvas } from "../graphics/canvas.ts";
import {
  type CountryOutline, WORLD_X, WORLD_Y, countryAt, degreesAt, worldShapes,
} from "../graphics/world.ts";

export interface WorldMapOptions {
  /** The window on the globe. Defaults to all of it. */
  x?: Bounds;
  y?: Bounds;
  /** Coastline colour. */
  color?: Color;
  /** Countries to pick out, by name or ISO code. */
  highlight?: readonly string[];
  highlightColor?: Color;
  background?: Color;
  grid?: boolean;
}

export function drawWorldMap(surface: Surface, options: WorldMapOptions = {}): void {
  if (surface.empty) return;
  const theme = surface.theme;
  drawCanvas(surface, {
    shapes: worldShapes({
      color: options.color ?? theme.border,
      highlight: options.highlight,
      highlightColor: options.highlightColor ?? theme.accent,
    }),
    x: options.x ?? WORLD_X,
    y: options.y ?? WORLD_Y,
    background: options.background,
    grid: options.grid,
  });
}

/**
 * The country under a cell of a map drawn with these bounds.
 *
 * Exposed so a caller can answer a hover as well as a click, and so the
 * arithmetic that has to agree with the drawing lives in one place.
 */
export function countryAtCell(
  column: number,
  row: number,
  width: number,
  height: number,
  options: WorldMapOptions = {},
): CountryOutline | undefined {
  const at = degreesAt(column, row, width, height, options.x ?? WORLD_X, options.y ?? WORLD_Y);
  if (!at) return undefined;
  return countryAt(at.lon, at.lat);
}
