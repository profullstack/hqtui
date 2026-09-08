/**
 * A canvas you can draw on in your own coordinates.
 *
 * `BrailleCanvas` works in pixels: good primitives, but the caller does every
 * unit conversion, and a drawing written for one panel size is wrong in the
 * next. This wraps it with a domain per axis and a list of shapes placed in
 * that domain, so the same drawing fits whatever region it is given.
 *
 * Y increases upwards, as it does on paper and in every plot, rather than
 * downwards as it does in a terminal. A canvas is for drawing things that have
 * their own geometry; making the caller flip every y would be handing them back
 * the conversion this exists to take away.
 */
import type { Surface } from "../surface.ts";
import { type Color, mix } from "../color.ts";
import { BrailleCanvas } from "./braille.ts";
import { blit } from "./plot.ts";

export interface Bounds {
  min: number;
  max: number;
}

export type Shape =
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; color?: Color }
  | { type: "polyline"; points: [number, number][]; color?: Color }
  | { type: "points"; points: [number, number][]; color?: Color }
  | { type: "circle"; x: number; y: number; radius: number; color?: Color }
  | {
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      color?: Color;
      fill?: boolean;
    };

export interface CanvasOptions {
  shapes: Shape[];
  /** The span the drawing is in. Defaults to 0-1 on both axes. */
  x?: Bounds;
  y?: Bounds;
  /** Colour for shapes that do not name their own. */
  color?: Color;
  background?: Color;
  /** A faint dotted grid behind the shapes. */
  grid?: boolean;
  gridColor?: Color;
}

const UNIT: Bounds = { min: 0, max: 1 };

/** A usable span: a zero-width one cannot be mapped onto anything. */
function span(bounds: Bounds | undefined): Bounds {
  if (!bounds) return UNIT;
  const { min, max } = bounds;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return UNIT;
  return { min, max };
}

/**
 * A projection from the caller's coordinates onto the canvas's pixels.
 *
 * Handed out so a caller can place their own labels against the same drawing:
 * a chart axis or a map legend has to agree with the shapes, and re-deriving
 * the mapping by hand is exactly the arithmetic this is here to remove.
 */
export interface Projection {
  x(value: number): number;
  y(value: number): number;
}

export function projection(
  canvas: BrailleCanvas,
  xBounds: Bounds,
  yBounds: Bounds,
): Projection {
  const width = Math.max(1, canvas.width - 1);
  const height = Math.max(1, canvas.height - 1);
  return {
    x: (value) => ((value - xBounds.min) / (xBounds.max - xBounds.min)) * width,
    // Flipped: the caller's y goes up, the canvas's goes down.
    y: (value) => (1 - (value - yBounds.min) / (yBounds.max - yBounds.min)) * height,
  };
}

function drawGrid(surface: Surface, color: Color, bg?: Color): void {
  const { width: w, height: h } = surface;
  for (let y = 0; y < h; y += Math.max(2, Math.floor(h / 4))) {
    for (let x = 0; x < w; x += 2) surface.char(x, y, "·", { fg: color, bg });
  }
}

/** Whether a shape has anything finite to draw. */
function usable(shape: Shape): boolean {
  const finite = (...values: number[]) => values.every((v) => Number.isFinite(v));
  switch (shape.type) {
    case "line":
      return finite(shape.x1, shape.y1, shape.x2, shape.y2);
    case "circle":
      return finite(shape.x, shape.y, shape.radius);
    case "rect":
      return finite(shape.x, shape.y, shape.width, shape.height);
    default:
      return shape.points.some((p) => finite(p[0], p[1]));
  }
}

export function drawCanvas(surface: Surface, options: CanvasOptions): void {
  if (surface.empty || options.shapes.length === 0) return;
  const theme = surface.theme;
  const bg = options.background;
  const xb = span(options.x);
  const yb = span(options.y);

  if (options.grid) {
    drawGrid(surface, options.gridColor ?? mix(theme.border, theme.background, 0.4), bg);
  }

  const canvas = new BrailleCanvas(surface.width, surface.height);
  const at = projection(canvas, xb, yb);
  const base = options.color ?? theme.accent;

  // One shape at a time, blitted before the next is drawn, so each keeps its
  // own colour. A shared canvas would make the last colour win everywhere the
  // shapes overlap.
  for (const shape of options.shapes) {
    if (!usable(shape)) continue;
    canvas.clear();
    switch (shape.type) {
      case "line":
        canvas.line(at.x(shape.x1), at.y(shape.y1), at.x(shape.x2), at.y(shape.y2));
        break;
      case "polyline": {
        const points = shape.points
          .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .map((p) => [at.x(p[0]), at.y(p[1])] as [number, number]);
        if (points.length === 1) canvas.pixel(points[0][0], points[0][1]);
        else canvas.polyline(points);
        break;
      }
      case "points":
        for (const [px, py] of shape.points) {
          if (Number.isFinite(px) && Number.isFinite(py)) canvas.pixel(at.x(px), at.y(py));
        }
        break;
      case "circle": {
        // A radius is a distance, not a position, so it is scaled by the span
        // rather than projected. The two axes rarely scale alike in a terminal
        // cell, and the x one is what a circle is measured against.
        const scale = Math.max(1, canvas.width - 1) / (xb.max - xb.min);
        canvas.circle(at.x(shape.x), at.y(shape.y), Math.abs(shape.radius) * scale);
        break;
      }
      case "rect": {
        // Given as a corner and a size, in the caller's own direction: a
        // positive height goes up, because their y does.
        const x0 = at.x(shape.x);
        const x1 = at.x(shape.x + shape.width);
        const y0 = at.y(shape.y);
        const y1 = at.y(shape.y + shape.height);
        if (shape.fill) canvas.fillRect(x0, Math.min(y0, y1), x1, Math.max(y0, y1));
        else canvas.rect(x0, Math.min(y0, y1), x1, Math.max(y0, y1));
        break;
      }
    }
    const color = shape.color ?? base;
    blit(surface, canvas, () => color, bg);
  }
}
