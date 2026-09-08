/**
 * A drop shadow cast by a region onto whatever is behind it.
 *
 * The point is that it dims what it covers rather than painting over it: a
 * shadow that filled its band with a flat colour would erase the dashboard
 * underneath, which is the opposite of what a shadow is for. Every covered cell
 * keeps its own character and its own hue, and only loses some of its light.
 */
import type { Surface } from "../surface.ts";
import type { Rect } from "../layout.ts";
import { type Color, mix, rgb } from "../color.ts";

export interface ShadowOptions {
  /** How far the shadow falls. Default one cell right and one down. */
  offsetX?: number;
  offsetY?: number;
  /** 0-1: how much light the covered cells lose. Default 0.55. */
  amount?: number;
  /**
   * Paint this colour instead of dimming what is underneath.
   *
   * For a shadow falling on empty background, where there is nothing to dim
   * and a flat colour is cheaper and reads the same.
   */
  color?: Color;
}

/**
 * Darken every cell in a region, keeping its character and its hue.
 *
 * Towards black rather than towards the theme's background: on a light theme
 * the background *is* the light, so dimming towards it would make the shadow
 * brighter than the page it falls on.
 */
export function dimRect(
  surface: Surface,
  x: number,
  y: number,
  width: number,
  height: number,
  amount: number,
): void {
  const buffer = surface.buffer;
  const t = amount < 0 ? 0 : amount > 1 ? 1 : amount;
  // `rgb(0, 0, 0)`, not the literal 0: zero is the sentinel for "the terminal's
  // own colour", so mixing towards it drains a cell's colour rather than
  // darkening it.
  const black = rgb(0, 0, 0);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const ax = surface.rect.x + x + col;
      const ay = surface.rect.y + y + row;
      if (
        ax < surface.clip.x || ay < surface.clip.y ||
        ax >= surface.clip.x + surface.clip.width ||
        ay >= surface.clip.y + surface.clip.height
      ) continue;
      const i = buffer.index(ax, ay);
      buffer.fg[i] = mix(buffer.fg[i], black, t);
      buffer.bg[i] = mix(buffer.bg[i], black, t);
    }
  }
}

/**
 * Cast a shadow from `rect` onto `surface`.
 *
 * The shadow is the band the region would cover if it were moved by the offset,
 * minus the region itself -- an L along the two trailing edges. Drawn before the
 * region is, so it never falls on top of it.
 */
export function drawShadow(surface: Surface, rect: Rect, options: ShadowOptions = {}): void {
  if (surface.empty) return;
  const dx = Math.trunc(options.offsetX ?? 1);
  const dy = Math.trunc(options.offsetY ?? 1);
  if (dx === 0 && dy === 0) return;
  const amount = options.amount ?? 0.55;

  const paint = (x: number, y: number, w: number, h: number): void => {
    if (w <= 0 || h <= 0) return;
    if (options.color !== undefined) surface.fillRect(x, y, w, h, { bg: options.color }, 32);
    else dimRect(surface, x, y, w, h, amount);
  };

  // The shadow is the moved region minus the original, which splits into two
  // rectangles that do not touch: the rows the move added, at the moved
  // region's full width, and then the columns it added over the rows the two
  // still share. Cutting it any other way overlaps at the corner, and a corner
  // dimmed twice reads as a smudge rather than an edge.
  const tx = rect.x + dx;
  const ty = rect.y + dy;
  if (dy > 0) paint(tx, rect.y + rect.height, rect.width, dy);
  else if (dy < 0) paint(tx, ty, rect.width, -dy);

  const y0 = Math.max(rect.y, ty);
  const shared = Math.min(rect.y + rect.height, ty + rect.height) - y0;
  if (shared > 0) {
    if (dx > 0) paint(rect.x + rect.width, y0, dx, shared);
    else if (dx < 0) paint(tx, y0, -dx, shared);
  }
}
