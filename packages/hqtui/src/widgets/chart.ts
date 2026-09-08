/**
 * A chart with two real axes.
 *
 * `graph` plots a history buffer: one sample per column, x meaning "position
 * in the array". This plots data that has its own x values, with a labelled
 * domain on both axes, so two series of different lengths line up and a point
 * lands where its x says it does.
 */
import type { Align, Surface } from "../surface.ts";
import type { Color } from "../color.ts";
import { fit, stringWidth } from "../unicode.ts";
import { seriesColor } from "../theme.ts";
import {
  type AxisOptions, type ChartPlotOptions, type ChartSeries, domainOf, plotPoints,
} from "../graphics/chart.ts";

export interface ChartOptions extends ChartPlotOptions {
  series: ChartSeries[];
  /** Numbers down the left edge. */
  axis?: boolean;
  axisColor?: Color;
  legend?: boolean;
  legendAlign?: Align;
}

/** Readable at a glance: 1.2k rather than 1200, 3 rather than 3.0. */
export function niceLabel(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1000) return `${Math.round(value / 100) / 10}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

/**
 * Evenly spaced values across a domain, ends included.
 *
 * Two ticks means the ends and nothing else, which is what an axis wants when
 * there is no room to say more.
 */
function ticksFor(min: number, max: number, count: number): number[] {
  const n = Math.max(2, Math.floor(count));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(min + ((max - min) * i) / (n - 1));
  return out;
}

export function drawChart(surface: Surface, options: ChartOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const series = options.series ?? [];
  const axisColor = options.axisColor ?? theme.muted;

  const xd = domainOf(series, options.x, 0);
  const yd = domainOf(series, options.y, 1);
  const xFormat = options.x?.format ?? niceLabel;
  const yFormat = options.y?.format ?? niceLabel;

  // The x labels take a row, and they can only take one when there is a row to
  // spare -- a two-row chart is all plot.
  const xTicks = options.x?.ticks ?? (options.axis ? 2 : 0);
  const wantXAxis = Boolean(options.axis) && xTicks >= 2 && surface.height > 2;

  let plotSurface = surface;
  if (options.axis) {
    const width = Math.max(stringWidth(yFormat(yd.max)), stringWidth(yFormat(yd.min))) + 1;
    surface.text(0, 0, fit(yFormat(yd.max), width, "right"), { fg: axisColor });
    if (surface.height > 1) {
      // The minimum marks the bottom of the plot, which is a row higher when
      // the x labels have taken the last one.
      const bottom = wantXAxis ? surface.height - 2 : surface.height - 1;
      surface.text(0, bottom, fit(yFormat(yd.min), width, "right"), { fg: axisColor });
    }
    plotSurface = surface.sub(width, 0, surface.width - width, surface.height);
  }

  let area = plotSurface;
  if (wantXAxis && plotSurface.height > 1 && plotSurface.width > 0) {
    area = plotSurface.sub(0, 0, plotSurface.width, plotSurface.height - 1);
    const row = plotSurface.height - 1;
    const labels = ticksFor(xd.min, xd.max, xTicks).map(xFormat);
    const step = labels.length > 1 ? (plotSurface.width - 1) / (labels.length - 1) : 0;
    labels.forEach((label, i) => {
      // The last label is right-aligned to the edge, so it cannot run off it.
      const x = Math.min(plotSurface.width - stringWidth(label), Math.round(i * step));
      plotSurface.text(Math.max(0, x), row, label, { fg: axisColor });
    });
  }

  plotPoints(area, series, { ...options, x: { ...options.x, ...xd }, y: { ...options.y, ...yd } });

  if (options.legend) {
    const parts = series
      .map((s, i) => ({ label: s.label, color: s.color ?? seriesColor(theme, i) }))
      .filter((p) => p.label);
    let x = options.legendAlign === "right"
      ? Math.max(0, area.width - parts.reduce((a, p) => a + stringWidth(p.label!) + 3, 0))
      : 0;
    const y = area.height > 3 ? area.height - 1 : 0;
    for (const part of parts) {
      x += area.text(x, y, "■ ", { fg: part.color });
      x += area.text(x, y, `${part.label} `, { fg: theme.muted });
    }
  }
}

export type { AxisOptions, ChartSeries };
