import type { Surface } from "../surface.ts";
import type { Style } from "../buffer.ts";
import { type Color, gradient as makeGradient, mix } from "../color.ts";
import { BrailleCanvas } from "./braille.ts";
import { type FillMode, verticalGlyph, horizontalGlyph } from "./blocks.ts";
import { seriesColor } from "../theme.ts";

export interface Series {
  values: number[];
  color?: Color;
  label?: string;
  /** Shade the area beneath the line. */
  fill?: boolean;
}

export interface PlotOptions {
  /** braille is sharpest; block and ascii are the graceful degradations. */
  mode?: FillMode;
  min?: number;
  max?: number;
  color?: Color;
  /** Color the plot along a ramp by value rather than one flat color. */
  colors?: Color[];
  fill?: boolean;
  /** 0-1 opacity of the area fill against the background. */
  fillAlpha?: number;
  background?: Color;
  /** Draw a faint dotted grid behind the series. */
  grid?: boolean;
  gridColor?: Color;
  baseline?: number;
}

/** A finite number, or undefined — `sum / count` with no samples is NaN. */
function bound(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extent(seriesList: Series[], options: PlotOptions): [number, number] {
  // A caller's axis bound is data, and data can be NaN. Falling back to the
  // computed extent keeps every plotted coordinate finite.
  let min = bound(options.min);
  let max = bound(options.max);
  if (min === undefined || max === undefined) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of seriesList) {
      for (const v of s.values) {
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    min = min ?? Math.min(0, lo);
    max = max ?? hi;
  }
  if (max <= min) max = min + 1;
  return [min, max];
}

function drawGrid(surface: Surface, color: Color, bg?: Color): void {
  const { width: w, height: h } = surface;
  for (let y = 0; y < h; y += Math.max(2, Math.floor(h / 4))) {
    for (let x = 0; x < w; x += 2) surface.char(x, y, "·", { fg: color, bg });
  }
}

/**
 * Draw one or more series across the whole surface.
 * With `mode: "braille"` each cell carries a 2x4 pixel matrix, so a 40x10 panel
 * plots at 80x40 resolution.
 */
export function plot(surface: Surface, series: Series[], options: PlotOptions = {}): void {
  if (surface.empty || series.length === 0) return;
  const theme = surface.theme;
  const mode = options.mode ?? "braille";
  const bg = options.background;
  const w = surface.width;
  const h = surface.height;
  // Only the samples that will actually be drawn should set the scale, or an
  // old spike still sitting in the history buffer flattens the live line.
  const columns = mode === "braille" ? w * 2 : w;
  const visible = series.map((s) => ({ ...s, values: s.values.slice(-Math.max(1, columns)) }));
  const [min, max] = extent(visible, options);
  const span = max - min;
  series = visible;

  if (options.grid) drawGrid(surface, options.gridColor ?? mix(theme.border, theme.background, 0.4), bg);

  if (mode === "block" || mode === "ascii" || mode === "half") {
    // One column per cell, newest value on the right.
    series.forEach((s, si) => {
      const color = s.color ?? options.color ?? seriesColor(theme, si);
      const ramp = options.colors ? makeGradient(options.colors) : undefined;
      for (let x = 0; x < w; x++) {
        const idx = s.values.length - w + x;
        const v = idx >= 0 ? s.values[idx] : undefined;
        if (v === undefined || !Number.isFinite(v)) continue;
        const ratio = (v - min) / span;
        const filled = ratio * h;
        const full = Math.floor(filled);
        const cellColor = ramp ? ramp(ratio) : color;
        for (let k = 0; k < full && k < h; k++) {
          surface.char(x, h - 1 - k, "█", { fg: cellColor, bg });
        }
        if (full < h) {
          const glyph = verticalGlyph(filled - full, mode);
          if (glyph !== " ") surface.char(x, h - 1 - full, glyph, { fg: cellColor, bg });
        }
      }
    });
    return;
  }

  // Braille: build one canvas per series so colors stay separable.
  const canvas = new BrailleCanvas(w, h);
  const px = canvas.width;
  const py = canvas.height;

  series.forEach((s, si) => {
    canvas.clear();
    const color = s.color ?? options.color ?? seriesColor(theme, si);
    const values = s.values;
    if (values.length === 0) return;
    const count = Math.min(values.length, px);
    const start = values.length - count;
    const points: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      const v = values[start + i];
      if (!Number.isFinite(v)) continue;
      const ratio = (v - min) / span;
      const x = count === 1 ? px - 1 : Math.round((i / (count - 1)) * (px - 1));
      const y = Math.round((1 - Math.max(0, Math.min(1, ratio))) * (py - 1));
      points.push([x, y]);
    }
    if (points.length === 0) return;
    if (points.length === 1) canvas.pixel(points[0][0], points[0][1]);
    else canvas.polyline(points);

    const wantFill = s.fill ?? options.fill ?? false;
    const fillAlpha = options.fillAlpha ?? 0.5;
    if (wantFill) {
      // The area is drawn with block elements rather than Braille: eight
      // scattered dots per cell reads as noise, a block reads as an area. The
      // line stays Braille, so it keeps the sub-cell resolution.
      const base = bg ?? theme.background;
      const values = s.values;
      // The fill has to walk the same window as the line, averaging the samples
      // that land inside each cell — otherwise the area drifts out of step.
      const sampleCount = Math.min(values.length, px);
      const sampleStart = values.length - sampleCount;
      for (let x = 0; x < w; x++) {
        const from = sampleStart + Math.floor((x / w) * sampleCount);
        const to = Math.max(from + 1, sampleStart + Math.floor(((x + 1) / w) * sampleCount));
        let sum = 0;
        let seen = 0;
        for (let i = from; i < to && i < values.length; i++) {
          const sample = values[i];
          if (Number.isFinite(sample)) {
            sum += sample;
            seen++;
          }
        }
        if (seen === 0) continue;
        const value = sum / seen;
        const ratio = Math.max(0, Math.min(1, (value - min) / span));
        const filled = ratio * h;
        const full = Math.floor(filled);
        for (let k = 0; k < full && k < h; k++) {
          const row = h - 1 - k;
          const depth = h <= 1 ? 0 : row / (h - 1);
          surface.char(x, row, "█", { fg: mix(base, color, fillAlpha * (1 - depth * 0.3)), bg });
        }
        if (full < h) {
          const glyph = verticalGlyph(filled - full, "block");
          if (glyph !== " ") {
            const row = h - 1 - full;
            const depth = h <= 1 ? 0 : row / (h - 1);
            surface.char(x, row, glyph, { fg: mix(base, color, fillAlpha * (1 - depth * 0.3) + 0.12), bg });
          }
        }
      }
    }
    const ramp = options.colors ? makeGradient(options.colors) : undefined;
    blit(surface, canvas, (col, row) => {
      if (!ramp) return color;
      return ramp(1 - row / Math.max(1, h - 1));
    }, bg);
  });
}

/** Copy a Braille canvas onto a surface, one glyph per cell. */
export function blit(
  surface: Surface,
  canvas: BrailleCanvas,
  colorAt: (col: number, row: number) => Color,
  bg?: Color,
): void {
  for (let row = 0; row < canvas.rows; row++) {
    for (let col = 0; col < canvas.cols; col++) {
      const value = canvas.cell(col, row);
      if (value === 0) continue;
      surface.char(col, row, value, { fg: colorAt(col, row), bg });
    }
  }
}

export interface SparklineOptions {
  color?: Color;
  colors?: Color[];
  min?: number;
  max?: number;
  background?: Color;
  mode?: FillMode;
}

/** A single-row trend line. Cheap enough to put in a table cell. */
export function sparkline(surface: Surface, values: number[], options: SparklineOptions = {}): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const w = surface.width;
  const windowed = values.slice(-Math.max(1, w));
  const [min, max] = extent([{ values: windowed }], options);
  const span = max - min;
  const ramp = options.colors ? makeGradient(options.colors) : undefined;
  const color = options.color ?? theme.accent;
  const count = Math.min(values.length, w);
  const start = values.length - count;
  const offset = w - count;
  for (let i = 0; i < count; i++) {
    const v = values[start + i];
    if (!Number.isFinite(v)) continue;
    const ratio = Math.max(0, Math.min(1, (v - min) / span));
    surface.char(offset + i, 0, verticalGlyph(ratio, options.mode ?? "block"), {
      fg: ramp ? ramp(ratio) : color,
      bg: options.background,
    });
  }
}

export interface BarOptions {
  /** 0-1. Values outside are clamped. */
  value: number;
  color?: Color;
  /** Color by fill level using the theme heat ramp. */
  heat?: boolean;
  track?: Color;
  background?: Color;
  /** Segmented gives the btop look; smooth uses eighth-blocks. */
  style?: "smooth" | "segmented" | "ascii";
  trackChar?: string;
}

/** A horizontal bar filling the surface's first row. */
export function bar(surface: Surface, options: BarOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const w = surface.width;
  const ratio = Math.max(0, Math.min(1, options.value));
  const style = options.style ?? "smooth";
  const trackColor = options.track ?? mix(theme.background, theme.border, 0.8);
  const heat = options.heat ? makeGradient(theme.heat) : undefined;
  const color = options.color ?? theme.primary;
  const trackChar = options.trackChar ?? (style === "ascii" ? "-" : style === "segmented" ? "▮" : "─");

  const filled = ratio * w;
  const full = Math.floor(filled);
  // Segmented draws discrete ticks with gaps, so stacked bars stay separable
  // instead of merging into one block of colour. This is the btop look.
  const fillChar = style === "ascii" ? "#" : style === "segmented" ? "▮" : "█";
  for (let x = 0; x < w; x++) {
    if (x < full) {
      surface.char(x, 0, fillChar, {
        fg: heat ? heat(w <= 1 ? ratio : x / (w - 1)) : color,
        bg: options.background,
      });
    } else if (x === full && style !== "segmented") {
      const glyph = horizontalGlyph(filled - full, style === "ascii" ? "ascii" : "block");
      surface.char(x, 0, glyph === " " ? trackChar : glyph, {
        fg: glyph === " " ? trackColor : heat ? heat(ratio) : color,
        bg: options.background,
      });
    } else {
      surface.char(x, 0, trackChar, { fg: trackColor, bg: options.background });
    }
  }
}

export interface GaugeOptions {
  value: number;
  color?: Color;
  background?: Color;
  label?: string;
  heat?: boolean;
}

/**
 * A semicircular dial drawn with Braille. Needs about 9x5 cells to look right.
 */
export function gauge(surface: Surface, options: GaugeOptions): void {
  if (surface.empty || surface.height < 3) {
    bar(surface, { value: options.value, color: options.color, heat: options.heat });
    return;
  }
  const theme = surface.theme;
  const ratio = Math.max(0, Math.min(1, options.value));
  const canvas = new BrailleCanvas(surface.width, surface.height);
  const cx = canvas.width / 2;
  const cy = canvas.height - 2;
  const radius = Math.min(canvas.width / 2 - 1, canvas.height - 3);
  const heat = makeGradient(theme.heat);

  const arcColors: number[] = [];
  const steps = Math.max(24, Math.round(radius * 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = Math.PI * (1 - t);
    const x = cx + Math.cos(angle) * radius;
    const y = cy - Math.sin(angle) * radius * 0.85;
    if (t <= ratio) {
      canvas.pixel(x, y);
      canvas.pixel(x, y - 1);
      arcColors.push(t);
    }
  }
  const color = options.color ?? (options.heat === false ? theme.primary : heat(ratio));
  blit(surface, canvas, () => color, options.background);

  // Unfilled remainder of the dial, dimmed.
  const rest = new BrailleCanvas(surface.width, surface.height);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (t <= ratio) continue;
    const angle = Math.PI * (1 - t);
    rest.pixel(cx + Math.cos(angle) * radius, cy - Math.sin(angle) * radius * 0.85);
  }
  blit(surface, rest, () => mix(theme.background, theme.border, 0.9), options.background);

  if (options.label) {
    const y = surface.height - 1;
    surface.textAligned(y, options.label, "center", { fg: color, attrs: 1 });
  }
}

export interface DonutOptions {
  segments: { value: number; color?: Color; label?: string }[];
  background?: Color;
}

/** A ring chart. Reads well from about 12x6 cells. */
export function donut(surface: Surface, options: DonutOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const total = options.segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  const canvas = new BrailleCanvas(surface.width, surface.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const outer = Math.min(canvas.width / 2, canvas.height / 2) - 1;
  const inner = outer * 0.55;
  const colorFor = new Map<string, Color>();

  let angle = -Math.PI / 2;
  options.segments.forEach((seg, i) => {
    const sweep = (Math.max(0, seg.value) / total) * Math.PI * 2;
    const color = seg.color ?? seriesColor(theme, i);
    const steps = Math.max(8, Math.round(sweep * outer * 3));
    for (let s = 0; s <= steps; s++) {
      const a = angle + (sweep * s) / steps;
      for (let r = inner; r <= outer; r += 0.4) {
        const x = Math.round(cx + Math.cos(a) * r);
        const y = Math.round(cy + Math.sin(a) * r * 0.9);
        canvas.pixel(x, y);
        colorFor.set(`${x >> 1},${y >> 2}`, color);
      }
    }
    angle += sweep;
  });

  blit(surface, canvas, (col, row) => colorFor.get(`${col},${row}`) ?? theme.muted, options.background);
}

export interface HistogramOptions {
  values: number[];
  color?: Color;
  colors?: Color[];
  background?: Color;
  max?: number;
}

/** Vertical column chart, one column per value, newest on the right. */
export function histogram(surface: Surface, options: HistogramOptions): void {
  plot(surface, [{ values: options.values }], {
    mode: "block",
    color: options.color,
    colors: options.colors,
    background: options.background,
    max: options.max,
    min: 0,
  });
}
