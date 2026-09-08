/**
 * A scrollbar, on its own.
 *
 * The renderer used to live inside the table and was reachable only by being a
 * table, list, tree or log. Anything else that scrolls -- a wrapped paragraph,
 * a canvas, a `draw()` somebody wrote themselves -- could not show one.
 *
 * This is the same drawing, lifted out and given the four edges plus state the
 * caller owns. The widgets that had `scrollbar: true` route through it, so
 * there is one implementation and one appearance.
 */
import type { Surface } from "../surface.ts";
import { mix } from "../color.ts";

/** Which edge the bar sits on, and therefore which way it runs. */
export type ScrollbarOrientation = "right" | "left" | "bottom" | "top";

export interface ScrollbarState {
  /** How much there is to scroll through. */
  total: number;
  /** How much of it is visible at once. */
  viewport: number;
  /** How far down (or across) we are. */
  offset: number;
}

export interface ScrollbarOptions extends ScrollbarState {
  orientation?: ScrollbarOrientation;
}

export function isVertical(orientation: ScrollbarOrientation): boolean {
  return orientation === "right" || orientation === "left";
}

/**
 * Where the thumb sits and how long it is, in cells along the track.
 *
 * Split out because it is the whole of the behaviour: everything else is
 * putting characters in a line. A thumb is never shorter than one cell, or it
 * would vanish on a long document, and never starts past the end of the track.
 *
 * The thumb is as long as the visible fraction, so it needs the viewport as
 * well as the track. For a table those are the same number -- the bar is
 * exactly as tall as the rows it describes -- which is why the old signature
 * did without it. A bar you place yourself has no such guarantee: twenty cells
 * of track can describe an eight-line window, and sizing the thumb from the
 * track would then report the wrong fraction. `viewport` defaults to the track
 * so the widgets that call the five-argument form are unaffected.
 */
export function thumb(
  track: number,
  total: number,
  offset: number,
  viewport: number = track,
): { start: number; size: number } {
  if (track <= 0 || total <= 0) return { start: 0, size: 0 };
  const visible = viewport > 0 ? viewport : track;
  if (total <= visible) return { start: 0, size: track };

  const size = Math.max(1, Math.min(track, Math.round((visible / total) * track)));
  const maxOffset = Math.max(1, total - visible);
  const clamped = Math.max(0, Math.min(offset, maxOffset));
  const start = Math.round((clamped / maxOffset) * (track - size));
  return { start: Math.max(0, Math.min(start, track - size)), size };
}

/**
 * The original signature, kept because the table, list, tree and log all call
 * it this way and their fixtures pin the result.
 */
export function drawScrollbar(
  surface: Surface,
  x: number,
  y: number,
  height: number,
  total: number,
  offset: number,
): void {
  const theme = surface.theme;
  const track = mix(theme.background, theme.border, 0.7);
  const { start, size } = thumb(height, total, offset);
  for (let i = 0; i < height; i++) {
    const inThumb = i >= start && i < start + size;
    surface.char(x, y + i, inThumb ? "█" : "│", { fg: inThumb ? theme.accent : track });
  }
}

/**
 * A scrollbar filling the surface it is given, on whichever edge.
 *
 * A horizontal bar uses the half-height glyphs rather than the full block: a
 * run of █ across a row reads as a solid rule, which is not what a thumb is
 * meant to look like.
 */
export function drawScrollbarWidget(surface: Surface, options: ScrollbarOptions): void {
  if (surface.empty) return;
  const orientation = options.orientation ?? "right";
  const vertical = isVertical(orientation);
  const theme = surface.theme;
  const trackColor = mix(theme.background, theme.border, 0.7);

  const length = vertical ? surface.height : surface.width;
  const viewport = options.viewport > 0 ? options.viewport : length;
  const { start, size } = thumb(length, options.total, options.offset, viewport);

  const line = vertical ? (orientation === "right" ? surface.width - 1 : 0)
    : (orientation === "bottom" ? surface.height - 1 : 0);

  for (let i = 0; i < length; i++) {
    const inThumb = i >= start && i < start + size;
    const glyph = vertical ? (inThumb ? "█" : "│") : (inThumb ? "━" : "─");
    const style = { fg: inThumb ? theme.accent : trackColor };
    if (vertical) surface.char(line, i, glyph, style);
    else surface.char(i, line, glyph, style);
  }
}

/**
 * Which offset a click at `position` along the track means.
 *
 * The thumb centres on the click, which is what every scrollbar does and what
 * makes dragging feel like dragging rather than nudging.
 */
export function offsetForPosition(
  position: number,
  track: number,
  total: number,
  viewport: number,
): number {
  const visible = viewport > 0 ? viewport : track;
  if (track <= 0 || total <= visible) return 0;
  const { size } = thumb(track, total, 0, visible);
  const usable = Math.max(1, track - size);
  const at = Math.max(0, Math.min(position - Math.floor(size / 2), usable));
  return Math.round((at / usable) * (total - visible));
}
