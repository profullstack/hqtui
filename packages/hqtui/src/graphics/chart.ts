/**
 * Charts of arbitrary (x, y) data.
 *
 * `plot` takes `number[]` and puts one sample per column: the x axis is the
 * array index. That is the right model for a history buffer and the wrong one
 * for everything else -- two series of different lengths silently render at
 * different horizontal scales, a gap in the data is indistinguishable from a
 * shorter series, and there is no way at all to say where on the x axis a
 * point belongs.
 *
 * This takes points and a domain for each axis, so a series is placed rather
 * than appended. `plot` is untouched and still means what it meant.
 */
import type { Surface } from "../surface.ts";
import { type Color, mix } from "../color.ts";
import { BrailleCanvas } from "./braille.ts";
import { type FillMode, verticalGlyph } from "./blocks.ts";
import { blit } from "./plot.ts";
import { seriesColor } from "../theme.ts";

export type Point = [number, number];

/** How a series is marked: joined, dotted, or dropped to the baseline. */
export type MarkType = "line" | "scatter" | "bar";

export interface ChartSeries {
  points: Point[];
  color?: Color;
  label?: string;
  type?: MarkType;
  /** Shade between the line and the baseline. Ignored for scatter. */
  fill?: boolean;
}

/** One axis: what it spans and how its numbers read. */
export interface AxisOptions {
  min?: number;
  max?: number;
  format?: (value: number) => string;
  /** How many labels to place. Default 2 -- the ends. */
  ticks?: number;
}

export interface ChartPlotOptions {
  /** braille is sharpest; block and ascii are the graceful degradations. */
  mode?: FillMode;
  x?: AxisOptions;
  y?: AxisOptions;
  background?: Color;
  grid?: boolean;
  gridColor?: Color;
  /** 0-1 opacity of the area fill against the background. */
  fillAlpha?: number;
  /** Where a bar or an area is measured from. Defaults to the y minimum. */
  baseline?: number;
}

export interface Domain {
  min: number;
  max: number;
}

/** A finite number, or undefined: a caller's bound is data, and data can be NaN. */
function bound(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * The span an axis covers, from the caller where they said and from the data
 * where they did not.
 *
 * A domain of zero width cannot be mapped -- every point would land in the same
 * place and a division would blow up -- so a flat series is given a unit of
 * room around itself rather than being collapsed onto one line.
 */
export function domainOf(
  series: ChartSeries[],
  axis: AxisOptions | undefined,
  which: 0 | 1,
): Domain {
  let min = bound(axis?.min);
  let max = bound(axis?.max);
  if (min === undefined || max === undefined) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        const v = p?.[which];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    min = min ?? lo;
    max = max ?? hi;
  }
  if (!(max > min)) {
    // A flat series still has to be drawn somewhere sensible.
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 0.5;
    return { min: min - pad, max: min + pad };
  }
  return { min, max };
}

/** Where a value sits in its domain, 0 at the minimum and 1 at the maximum. */
function ratio(value: number, domain: Domain): number {
  return (value - domain.min) / (domain.max - domain.min);
}

function drawGrid(surface: Surface, color: Color, bg?: Color): void {
  const { width: w, height: h } = surface;
  for (let y = 0; y < h; y += Math.max(2, Math.floor(h / 4))) {
    for (let x = 0; x < w; x += 2) surface.char(x, y, "·", { fg: color, bg });
  }
}

/**
 * Draw point series across the whole surface.
 *
 * Points are drawn in the order they are given: a line joins them as they come,
 * which is what lets a chart draw a loop or a path that doubles back. Sorting
 * them would quietly make that impossible.
 */
export function plotPoints(
  surface: Surface,
  series: ChartSeries[],
  options: ChartPlotOptions = {},
): void {
  if (surface.empty || series.length === 0) return;
  const theme = surface.theme;
  const mode = options.mode ?? "braille";
  const bg = options.background;
  const w = surface.width;
  const h = surface.height;

  const xd = domainOf(series, options.x, 0);
  const yd = domainOf(series, options.y, 1);
  const baseline = bound(options.baseline) ?? yd.min;

  if (options.grid) {
    drawGrid(surface, options.gridColor ?? mix(theme.border, theme.background, 0.4), bg);
  }

  if (mode === "block" || mode === "ascii" || mode === "half") {
    plotCells(surface, series, { mode, xd, yd, baseline, bg, theme });
    return;
  }

  const canvas = new BrailleCanvas(w, h);
  const px = canvas.width;
  const py = canvas.height;
  const at = (p: Point): Point => [
    Math.round(Math.max(0, Math.min(1, ratio(p[0], xd))) * (px - 1)),
    Math.round((1 - Math.max(0, Math.min(1, ratio(p[1], yd)))) * (py - 1)),
  ];

  series.forEach((s, si) => {
    canvas.clear();
    const color = s.color ?? seriesColor(theme, si);
    const type = s.type ?? "line";
    const finite = s.points.filter(
      (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    );
    if (finite.length === 0) return;
    const pixels = finite.map(at);

    if (type === "scatter") {
      for (const [x, y] of pixels) canvas.pixel(x, y);
    } else if (type === "bar") {
      const floor = Math.round((1 - Math.max(0, Math.min(1, ratio(baseline, yd)))) * (py - 1));
      for (const [x, y] of pixels) canvas.vline(x, Math.min(y, floor), Math.max(y, floor));
    } else if (pixels.length === 1) {
      canvas.pixel(pixels[0][0], pixels[0][1]);
    } else {
      canvas.polyline(pixels);
    }

    if (s.fill && type !== "scatter") {
      fillUnder(surface, finite, { xd, yd, baseline, color, bg, alpha: options.fillAlpha ?? 0.5 });
    }
    blit(surface, canvas, () => color, bg);
  });
}

/**
 * The area between a series and its baseline, in block elements.
 *
 * Braille would give eight scattered dots per cell, which reads as noise where
 * an area should read as an area. The line itself stays Braille, so it keeps
 * the sub-cell resolution.
 *
 * The height of each column is interpolated along the line rather than sampled
 * from the points that happen to land in it. Sampling leaves a gap wherever a
 * column has no point of its own, which with arbitrary x values is most of
 * them -- the area comes out striped instead of solid.
 */
function fillUnder(
  surface: Surface,
  points: Point[],
  o: { xd: Domain; yd: Domain; baseline: number; color: Color; bg?: Color; alpha: number },
): void {
  const w = surface.width;
  const h = surface.height;
  if (w <= 0 || h <= 0 || points.length === 0) return;
  const base = o.bg ?? surface.theme.background;
  const floor = Math.max(0, Math.min(1, ratio(o.baseline, o.yd)));

  // Column index of a domain x, as a fraction, so a segment can be walked
  // across the columns it actually spans.
  const column = (x: number): number => ratio(x, o.xd) * (w - 1);

  const tops = new Array<number>(w).fill(Number.NaN);
  const record = (col: number, value: number): void => {
    if (col < 0 || col >= w) return;
    // A path that doubles back covers a column twice; the outer edge is the
    // one that bounds the area.
    const previous = tops[col];
    const away = Math.abs(value - floor);
    if (Number.isNaN(previous) || away > Math.abs(previous - floor)) tops[col] = value;
  };

  if (points.length === 1) {
    record(Math.round(column(points[0][0])), Math.max(0, Math.min(1, ratio(points[0][1], o.yd))));
  }
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const c0 = column(x0);
    const c1 = column(x1);
    const from = Math.max(0, Math.floor(Math.min(c0, c1)));
    const to = Math.min(w - 1, Math.ceil(Math.max(c0, c1)));
    for (let col = from; col <= to; col++) {
      const t = c1 === c0 ? 0 : (col - c0) / (c1 - c0);
      if (t < -0.5 || t > 1.5) continue;
      const y = y0 + (y1 - y0) * Math.max(0, Math.min(1, t));
      record(col, Math.max(0, Math.min(1, ratio(y, o.yd))));
    }
  }

  for (let x = 0; x < w; x++) {
    const top = tops[x];
    if (Number.isNaN(top)) continue;
    const from01 = Math.min(floor, top);
    const filled = (Math.max(floor, top) - from01) * h;
    const bottom = Math.floor(from01 * h);
    const full = Math.floor(filled);
    for (let k = 0; k < full && k < h; k++) {
      const row = h - 1 - bottom - k;
      if (row < 0 || row >= h) continue;
      const depth = h <= 1 ? 0 : row / (h - 1);
      surface.char(x, row, "█", { fg: mix(base, o.color, o.alpha * (1 - depth * 0.3)), bg: o.bg });
    }
    if (full < h) {
      const glyph = verticalGlyph(filled - full, "block");
      const row = h - 1 - bottom - full;
      if (glyph !== " " && row >= 0 && row < h) {
        const depth = h <= 1 ? 0 : row / (h - 1);
        surface.char(x, row, glyph, {
          fg: mix(base, o.color, o.alpha * (1 - depth * 0.3) + 0.12),
          bg: o.bg,
        });
      }
    }
  }
}

/**
 * The block and ascii degradations: one column per cell, tallest point wins.
 *
 * A scatter keeps its dots rather than growing columns, because a scatter that
 * fills to the baseline is a bar chart wearing the wrong name.
 */
function plotCells(
  surface: Surface,
  series: ChartSeries[],
  o: {
    mode: FillMode;
    xd: Domain;
    yd: Domain;
    baseline: number;
    bg?: Color;
    theme: Surface["theme"];
  },
): void {
  const w = surface.width;
  const h = surface.height;
  const floorRatio = Math.max(0, Math.min(1, ratio(o.baseline, o.yd)));

  series.forEach((s, si) => {
    const color = s.color ?? seriesColor(o.theme, si);
    const type = s.type ?? "line";
    // Highest value per column, so a column shows the peak that fell in it
    // rather than whichever point happened to be last.
    const tops = new Array<number>(w).fill(Number.NaN);
    for (const p of s.points) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const col = Math.min(w - 1, Math.max(0, Math.round(ratio(p[0], o.xd) * (w - 1))));
      const value = Math.max(0, Math.min(1, ratio(p[1], o.yd)));
      if (Number.isNaN(tops[col]) || value > tops[col]) tops[col] = value;
    }

    for (let x = 0; x < w; x++) {
      const top = tops[x];
      if (Number.isNaN(top)) continue;
      if (type === "scatter") {
        const row = h - 1 - Math.min(h - 1, Math.floor(top * h));
        surface.char(x, row, o.mode === "ascii" ? "*" : "•", { fg: color, bg: o.bg });
        continue;
      }
      const from = Math.min(floorRatio, top) * h;
      const filled = (Math.max(floorRatio, top) - Math.min(floorRatio, top)) * h;
      const full = Math.floor(filled);
      for (let k = 0; k < full; k++) {
        const row = h - 1 - Math.floor(from) - k;
        if (row >= 0 && row < h) surface.char(x, row, "█", { fg: color, bg: o.bg });
      }
      const glyph = verticalGlyph(filled - full, o.mode);
      const row = h - 1 - Math.floor(from) - full;
      if (glyph !== " " && row >= 0 && row < h) {
        surface.char(x, row, glyph, { fg: color, bg: o.bg });
      }
    }
  });
}
