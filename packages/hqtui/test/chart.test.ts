import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen } from "../src/index.ts";
import { domainOf } from "../src/graphics/chart.ts";
import type { ChartSeries, Point } from "../src/graphics/chart.ts";

import type { ChartOptions } from "../src/widgets/chart.ts";

const draw = (options: ChartOptions, width = 40, height = 8): string[] =>
  renderToScreen(({ ui }) => ui.chart(options), { width, height }).text().split("\n");

/** Which columns of a rendered chart have any ink in them. */
const inked = (lines: string[]): number[] => {
  const columns = new Set<number>();
  for (const line of lines) {
    for (let x = 0; x < line.length; x++) if (line[x] !== " ") columns.add(x);
  }
  return [...columns].sort((a, b) => a - b);
};

const series = (points: Point[], extra: Partial<ChartSeries> = {}): ChartSeries => ({
  points,
  ...extra,
});

test("chart: a domain comes from the data when nobody says otherwise", () => {
  const s = [series([[0, 5], [10, 15]])];
  assert.deepEqual(domainOf(s, undefined, 0), { min: 0, max: 10 });
  assert.deepEqual(domainOf(s, undefined, 1), { min: 5, max: 15 });
});

test("chart: a stated bound wins, and a broken one does not", () => {
  const s = [series([[0, 5], [10, 15]])];
  assert.deepEqual(domainOf(s, { min: -5, max: 20 }, 0), { min: -5, max: 20 });
  // A caller's bound is data too, and data can be NaN. Falling back to the
  // extent keeps every plotted coordinate finite.
  assert.deepEqual(domainOf(s, { min: Number.NaN, max: 20 }, 0), { min: 0, max: 20 });
});

test("chart: a flat series is given room rather than collapsed onto a line", () => {
  // Every point at the same y would otherwise divide by a zero-width domain.
  const flat = domainOf([series([[0, 7], [1, 7]])], undefined, 1);
  assert.ok(flat.max > flat.min, `${JSON.stringify(flat)}`);
  assert.ok(flat.min < 7 && flat.max > 7);
  // And at zero, where a proportional pad would itself be zero.
  const zero = domainOf([series([[0, 0], [1, 0]])], undefined, 1);
  assert.ok(zero.max > zero.min, `${JSON.stringify(zero)}`);
});

test("chart: no points at all is a unit domain, not an infinity", () => {
  assert.deepEqual(domainOf([series([])], undefined, 0), { min: 0, max: 1 });
  assert.deepEqual(domainOf([], undefined, 1), { min: 0, max: 1 });
});

test("chart: a point lands where its x says, not where its index does", () => {
  // Three points bunched at the left of a domain that runs to 100. Indexed
  // plotting would spread them across the whole width; this must not.
  const lines = draw({
    series: [series([[0, 1], [1, 1], [2, 1]], { type: "scatter" })],
    x: { min: 0, max: 100 },
    y: { min: 0, max: 2 },
  });
  const columns = inked(lines);
  assert.ok(columns.length > 0, "something was drawn");
  assert.ok(columns[columns.length - 1] < 5, `ink reached column ${columns[columns.length - 1]}`);
});

test("chart: two series of different lengths share one horizontal scale", () => {
  // The bug this widget exists to fix: with index-based plotting these two
  // would end at different places despite covering the same x range.
  const dense: Point[] = [];
  for (let i = 0; i <= 20; i++) dense.push([i / 2, 5]);
  const sparse: Point[] = [[0, 5], [10, 5]];

  const a = inked(draw({ series: [series(dense)], x: { min: 0, max: 10 }, y: { min: 0, max: 10 } }));
  const b = inked(draw({ series: [series(sparse)], x: { min: 0, max: 10 }, y: { min: 0, max: 10 } }));
  assert.deepEqual([a[0], a[a.length - 1]], [b[0], b[b.length - 1]]);
});

test("chart: the three marks are actually different", () => {
  const points: Point[] = [[0, 1], [5, 8], [10, 3]];
  const common = { x: { min: 0, max: 10 }, y: { min: 0, max: 10 } };
  const line = draw({ series: [series(points, { type: "line" })], ...common }).join("\n");
  const scatter = draw({ series: [series(points, { type: "scatter" })], ...common }).join("\n");
  const bar = draw({ series: [series(points, { type: "bar" })], ...common }).join("\n");

  const ink = (s: string) => s.replace(/[\s\n]/g, "").length;
  // A scatter is three marks; a line joins them; bars drop to the baseline.
  assert.ok(ink(scatter) < ink(line), `scatter ${ink(scatter)} vs line ${ink(line)}`);
  assert.ok(ink(bar) > ink(scatter), `bar ${ink(bar)} vs scatter ${ink(scatter)}`);
  assert.notEqual(line, bar);
});

test("chart: bars stand on the baseline, wherever it is put", () => {
  const points: Point[] = [[5, 8]];
  const common = { series: [series(points, { type: "bar" })], x: { min: 0, max: 10 }, y: { min: 0, max: 10 } };
  const fromZero = draw({ ...common }).filter((l) => l.trim()).length;
  // A baseline at the top means the bar hangs down from it instead.
  const fromTop = draw({ ...common, baseline: 10 }).filter((l) => l.trim()).length;
  assert.ok(fromZero > 1 && fromTop > 1);
  assert.notEqual(
    draw({ ...common }).join("\n"),
    draw({ ...common, baseline: 10 }).join("\n"),
  );
});

test("chart: a filled area has no gaps between the points", () => {
  // Sampling the points per column leaves a stripe wherever a column has no
  // point of its own, which with arbitrary x values is most of them.
  const points: Point[] = [[0, 2], [5, 8], [10, 2]];
  const lines = draw({
    series: [series(points, { fill: true })],
    x: { min: 0, max: 10 },
    y: { min: 0, max: 10 },
  }, 40, 8);
  const bottom = lines[lines.length - 1];
  const filled = [...bottom].map((c) => c !== " ");
  const first = filled.indexOf(true);
  const last = filled.lastIndexOf(true);
  assert.ok(first >= 0 && last > first, "the area reached the bottom row");
  for (let x = first; x <= last; x++) {
    assert.ok(filled[x], `column ${x} of the area is a gap: ${JSON.stringify(bottom)}`);
  }
});

test("chart: both axes get labels, and the x row is not stolen from the plot", () => {
  const lines = draw({
    series: [series([[0, 0], [10, 100]])],
    axis: true,
    x: { min: 0, max: 10, ticks: 3, format: (v) => `${v}s` },
    y: { min: 0, max: 100 },
  }, 40, 8);
  assert.ok(lines[0].trimStart().startsWith("100"), `y max: ${JSON.stringify(lines[0])}`);
  const last = lines[lines.length - 1];
  assert.ok(last.includes("0s") && last.includes("10s"), `x labels: ${JSON.stringify(last)}`);
  // The y minimum belongs to the bottom of the plot, which is a row above the
  // x labels rather than on them.
  assert.ok(lines[lines.length - 2].trimStart().startsWith("0"), JSON.stringify(lines[lines.length - 2]));
});

test("chart: a chart with no room for an x axis still draws", () => {
  const lines = draw({ series: [series([[0, 1], [1, 2]])], axis: true }, 20, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines.join("").trim().length > 0);
});

test("chart: points that are not numbers are skipped, not drawn at zero", () => {
  const good = draw({
    series: [series([[0, 5], [10, 5]])],
    x: { min: 0, max: 10 },
    y: { min: 0, max: 10 },
  });
  const withJunk = draw({
    series: [series([[0, 5], [Number.NaN, 1], [10, 5]] as Point[])],
    x: { min: 0, max: 10 },
    y: { min: 0, max: 10 },
  });
  assert.deepEqual(withJunk, good);
});
