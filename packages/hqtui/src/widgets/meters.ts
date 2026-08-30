import type { Surface, Align } from "../surface.ts";
import { Attr, type Style } from "../buffer.ts";
import { type Color, mix, gradient } from "../color.ts";
import { fit, stringWidth, truncate } from "../unicode.ts";
import { heatColor, seriesColor } from "../theme.ts";
import { bar as drawBar, plot, sparkline as drawSparkline, gauge as drawGauge, donut as drawDonut } from "../graphics/plot.ts";
import type { Series, PlotOptions } from "../graphics/plot.ts";
import { verticalGlyph } from "../graphics/blocks.ts";

export interface MeterOptions {
  /** 0-1, or supply `max` and pass an absolute value. */
  value: number;
  max?: number;
  label?: string;
  /** Right-hand readout. Defaults to a percentage. */
  text?: string;
  labelWidth?: number;
  valueWidth?: number;
  color?: Color;
  /** Green-to-red by fill level. Default true. */
  heat?: boolean;
  background?: Color;
  style?: "smooth" | "segmented" | "ascii";
  showValue?: boolean;
}

/** `label ████████░░░░ 42%` on a single row. The most-used widget here. */
export function drawMeter(surface: Surface, options: MeterOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const ratio = Math.max(0, Math.min(1, options.max ? options.value / options.max : options.value));
  const label = options.label ?? "";
  const labelWidth = label ? (options.labelWidth ?? stringWidth(label) + 1) : 0;
  const valueText = options.showValue === false ? "" : options.text ?? `${Math.round(ratio * 100)}%`;
  const valueWidth = valueText ? (options.valueWidth ?? stringWidth(valueText) + 1) : 0;
  const barWidth = Math.max(0, surface.width - labelWidth - valueWidth);

  if (labelWidth > 0) {
    surface.text(0, 0, fit(truncate(label, labelWidth), labelWidth), {
      fg: theme.muted,
      bg: options.background,
    });
  }
  if (barWidth > 0) {
    drawBar(surface.sub(labelWidth, 0, barWidth, 1), {
      value: ratio,
      color: options.color,
      heat: options.heat ?? options.color === undefined,
      background: options.background,
      style: options.style,
    });
  }
  if (valueWidth > 0) {
    surface.text(surface.width - valueWidth, 0, fit(valueText, valueWidth, "right"), {
      fg: options.color ?? (options.heat === false ? theme.foreground : heatColor(theme, ratio)),
      bg: options.background,
      attrs: Attr.Bold,
    });
  }
}

export interface MetersOptions {
  items: { label: string; value: number; max?: number; color?: Color; text?: string }[];
  labelWidth?: number;
  valueWidth?: number;
  heat?: boolean;
  background?: Color;
  style?: MeterOptions["style"];
  /** Lay out in N columns when there is room, like btop's core grid. */
  columns?: number;
  gap?: number;
}

/** A stack (or grid) of meters — per-core CPU, per-disk usage, and so on. */
export function drawMeters(surface: Surface, options: MetersOptions): void {
  if (surface.empty) return;
  const columns = Math.max(1, options.columns ?? 1);
  const gap = options.gap ?? 2;
  const colWidth = Math.floor((surface.width - gap * (columns - 1)) / columns);
  const perColumn = Math.ceil(options.items.length / columns);

  options.items.forEach((item, i) => {
    const col = Math.floor(i / perColumn);
    const row = i % perColumn;
    if (row >= surface.height || col >= columns) return;
    drawMeter(surface.sub(col * (colWidth + gap), row, colWidth, 1), {
      value: item.value,
      max: item.max,
      label: item.label,
      text: item.text,
      color: item.color,
      labelWidth: options.labelWidth,
      valueWidth: options.valueWidth,
      heat: options.heat,
      background: options.background,
      style: options.style,
    });
  });
}

export interface ProgressOptions {
  value: number;
  max?: number;
  label?: string;
  color?: Color;
  background?: Color;
  /** Show `37 / 120` instead of a percentage. */
  showCount?: boolean;
}

export function drawProgress(surface: Surface, options: ProgressOptions): void {
  const max = options.max ?? 1;
  drawMeter(surface, {
    value: options.value,
    max,
    label: options.label,
    color: options.color ?? surface.theme.primary,
    heat: false,
    background: options.background,
    text: options.showCount ? `${Math.round(options.value)}/${Math.round(max)}` : undefined,
  });
}

export interface GraphOptions extends PlotOptions {
  /** A single series, or several. */
  values?: number[];
  series?: Series[];
  /** Draw min/max labels down the left edge. */
  axis?: boolean;
  axisFormat?: (value: number) => string;
  axisColor?: Color;
  /** Time labels along the bottom, e.g. 60s 45s 30s. */
  timeAxis?: string[];
  legend?: boolean;
  legendAlign?: Align;
}

function niceLabel(value: number): string {
  if (Math.abs(value) >= 1000) return `${Math.round(value / 100) / 10}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

/** Line/area graph. Braille by default, so it reads at 2x4 the cell resolution. */
export function drawGraph(surface: Surface, options: GraphOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const seriesList: Series[] = options.series ?? [{ values: options.values ?? [] }];

  let plotSurface = surface;
  const axisColor = options.axisColor ?? theme.muted;

  if (options.axis) {
    // Match the window the plot itself will use, so the labels stay truthful.
    const columns = (options.mode ?? "braille") === "braille" ? surface.width * 2 : surface.width;
    const values = seriesList
      .flatMap((s) => s.values.slice(-Math.max(1, columns)))
      .filter(Number.isFinite);
    const max = options.max ?? (values.length ? Math.max(...values) : 1);
    const min = options.min ?? 0;
    const format = options.axisFormat ?? niceLabel;
    const labelWidth = Math.max(stringWidth(format(max)), stringWidth(format(min))) + 1;
    surface.text(0, 0, fit(format(max), labelWidth, "right"), { fg: axisColor });
    if (surface.height > 1) {
      surface.text(0, surface.height - 1, fit(format(min), labelWidth, "right"), { fg: axisColor });
    }
    plotSurface = surface.sub(labelWidth, 0, surface.width - labelWidth, surface.height);
  }

  let graphSurface = plotSurface;
  if (options.timeAxis && plotSurface.height > 1) {
    graphSurface = plotSurface.sub(0, 0, plotSurface.width, plotSurface.height - 1);
    const labels = options.timeAxis;
    const step = labels.length > 1 ? (plotSurface.width - 1) / (labels.length - 1) : 0;
    labels.forEach((label, i) => {
      const x = Math.min(plotSurface.width - stringWidth(label), Math.round(i * step));
      plotSurface.text(Math.max(0, x), plotSurface.height - 1, label, { fg: axisColor });
    });
  }

  plot(graphSurface, seriesList, options);

  if (options.legend) {
    const parts = seriesList
      .map((s, i) => ({ label: s.label, color: s.color ?? seriesColor(theme, i) }))
      .filter((p) => p.label);
    let x = options.legendAlign === "right"
      ? Math.max(0, graphSurface.width - parts.reduce((a, p) => a + stringWidth(p.label!) + 3, 0))
      : 0;
    // Sit the legend on the last row when there is one to spare, so it never
    // lands on top of the plot's busiest corner.
    const y = graphSurface.height > 3 ? graphSurface.height - 1 : 0;
    for (const part of parts) {
      x += graphSurface.text(x, y, "■ ", { fg: part.color });
      x += graphSurface.text(x, y, `${part.label} `, { fg: theme.muted });
    }
  }
}

export interface SparklineOptions {
  values: number[];
  color?: Color;
  colors?: Color[];
  min?: number;
  max?: number;
  label?: string;
  text?: string;
  background?: Color;
}

/** One-row trend, optionally with a label and a right-hand readout. */
export function drawSparklineWidget(surface: Surface, options: SparklineOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const labelWidth = options.label ? stringWidth(options.label) + 1 : 0;
  const valueWidth = options.text ? stringWidth(options.text) + 1 : 0;
  if (labelWidth) {
    surface.text(0, 0, options.label!, { fg: theme.muted, bg: options.background });
  }
  const width = surface.width - labelWidth - valueWidth;
  if (width > 0) {
    drawSparkline(surface.sub(labelWidth, 0, width, 1), options.values, {
      color: options.color,
      colors: options.colors,
      min: options.min,
      max: options.max,
      background: options.background,
    });
  }
  if (valueWidth) {
    surface.text(surface.width - valueWidth, 0, fit(options.text!, valueWidth, "right"), {
      fg: options.color ?? theme.accent,
      bg: options.background,
      attrs: Attr.Bold,
    });
  }
}

export interface HeatBarOptions {
  /** 0-1 per segment. Renders like btop's temperature bars. */
  value: number;
  width?: number;
  color?: Color;
  background?: Color;
  char?: string;
}

/** A segmented heat bar: discrete ticks colored along the theme ramp. */
export function drawHeatBar(surface: Surface, options: HeatBarOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const ratio = Math.max(0, Math.min(1, options.value));
  const width = Math.min(options.width ?? surface.width, surface.width);
  const filled = Math.round(ratio * width);
  const ramp = gradient(theme.heat);
  const ch = options.char ?? "▮";
  for (let x = 0; x < width; x++) {
    const on = x < filled;
    surface.char(x, 0, ch, {
      fg: on ? (options.color ?? ramp(width <= 1 ? ratio : x / (width - 1))) : mix(theme.background, theme.border, 0.75),
      bg: options.background,
    });
  }
}

export { drawGauge, drawDonut };
export type { GaugeOptions, DonutOptions } from "../graphics/plot.ts";

export interface ColumnsOptions {
  values: number[];
  color?: Color;
  colors?: Color[];
  max?: number;
  background?: Color;
}

/** Block-mode column chart. Cheaper than Braille and reads well when short. */
export function drawColumns(surface: Surface, options: ColumnsOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const max = options.max ?? Math.max(1, ...options.values);
  const ramp = options.colors ? gradient(options.colors) : undefined;
  const count = Math.min(options.values.length, surface.width);
  const start = options.values.length - count;
  for (let i = 0; i < count; i++) {
    const ratio = Math.max(0, Math.min(1, options.values[start + i] / max));
    const filled = ratio * surface.height;
    const full = Math.floor(filled);
    const color = ramp ? ramp(ratio) : options.color ?? theme.primary;
    for (let k = 0; k < full; k++) {
      surface.char(i, surface.height - 1 - k, "█", { fg: color, bg: options.background });
    }
    if (full < surface.height) {
      const glyph = verticalGlyph(filled - full);
      if (glyph !== " ") surface.char(i, surface.height - 1 - full, glyph, { fg: color, bg: options.background });
    }
  }
}
