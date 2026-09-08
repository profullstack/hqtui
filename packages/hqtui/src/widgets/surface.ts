/**
 * Two primitives for the space behind a widget rather than the widget itself.
 *
 * `modal` already blanks the region it is about to draw into, but it does it
 * privately, so anything else that floats -- a custom overlay, a popover, a
 * tooltip somebody wrote themselves -- has no way to say "this region is mine
 * now". These make that sayable.
 */
import type { Surface } from "../surface.ts";
import type { Style } from "../buffer.ts";
import type { Color } from "../color.ts";
import { stringWidth } from "../unicode.ts";

export interface ClearOptions {
  /** What to leave behind. Defaults to the theme's background. */
  background?: Color;
}

/**
 * Reset a region to empty, so an overlay can draw over what was there.
 *
 * Without this an overlay is drawn *into* whatever it lands on: the cells it
 * does not touch keep the widget underneath, and a dialog ends up with someone
 * else's table showing through the gaps between its words.
 */
export function drawClear(surface: Surface, options: ClearOptions = {}): void {
  if (surface.empty) return;
  const theme = surface.theme;
  surface.fill({ bg: options.background ?? theme.background, fg: theme.foreground, attrs: 0 });
}

export interface FillOptions extends Style {
  /**
   * The symbol to repeat. One cell's worth: anything wider is cut to its first
   * grapheme, because a fill has to tile the region exactly.
   */
  symbol?: string;
}

/** Flood a region with one repeated symbol and style. */
export function drawFill(surface: Surface, options: FillOptions = {}): void {
  if (surface.empty) return;
  const symbol = options.symbol ?? " ";
  const style: Style = { fg: options.fg, bg: options.bg, attrs: options.attrs };
  const width = Math.max(1, stringWidth(symbol));
  // A one-cell symbol is what `fill` is for. Anything wider has to be stepped
  // over rather than written per column: each glyph owns a continuation cell,
  // and writing the next one on top of it leaves a row of half-characters.
  if (width === 1 && [...symbol].length === 1) {
    surface.fill(style, symbol.codePointAt(0) ?? 32);
    return;
  }
  for (let y = 0; y < surface.height; y++) {
    // The last glyph is dropped rather than clipped when the region does not
    // divide evenly: half a wide character is not a fill, it is damage.
    for (let x = 0; x + width <= surface.width; x += width) {
      surface.char(x, y, symbol, style);
    }
  }
}
