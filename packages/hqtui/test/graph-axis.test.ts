import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToText } from "../src/testing.ts";

/**
 * The y-axis minimum marks the bottom of the plot. When a time axis is present
 * it takes the last row, so the minimum belongs one row above it — otherwise
 * the two labels sit side by side on the same row and read as one number.
 */
const VALUES = [0, 20, 45, 30, 80, 65, 90, 40, 55, 70];
const TIME = ["08-10", "08-14", "08-18", "08-22", "08-26"];

function frame(options: Record<string, unknown>, width = 60, height = 10): string[] {
  return renderToText(({ ui }) => ui.graph({ values: VALUES, ...options }), { width, height })
    .split("\n");
}

test("the y-axis minimum sits on the plot's bottom row, not the time axis", () => {
  const lines = frame({ axis: true, min: 0, max: 100, timeAxis: TIME });
  const axisRow = lines[lines.length - 2] ?? "";
  const timeRow = lines[lines.length - 1] ?? "";

  assert.match(axisRow, /^\s*0/, "the minimum is one row above the time axis");
  assert.match(timeRow, /08-10/, "the time axis has the bottom row to itself");
  // The bug: the minimum written immediately left of the first time label, so
  // the row read "008-10". A digit directly against the label is the signature;
  // `0*` would have matched the correct output too, since it allows none.
  assert.doesNotMatch(timeRow, /\d08-10/, "no y-axis label fused onto the time axis");
});

test("without a time axis the minimum keeps the bottom row", () => {
  const lines = frame({ axis: true, min: 0, max: 100 });
  assert.match(lines[lines.length - 1] ?? "", /^\s*0/);
});

test("the maximum stays on the top row either way", () => {
  assert.match(frame({ axis: true, min: 0, max: 100 })[0] ?? "", /100/);
  assert.match(frame({ axis: true, min: 0, max: 100, timeAxis: TIME })[0] ?? "", /100/);
});

test("a formatted axis does not fuse either", () => {
  const lines = frame({
    axis: true,
    min: 0,
    max: 6000,
    timeAxis: TIME,
    axisFormat: (v: number) => `$${Math.round(v / 1000)}K`,
  });
  const timeRow = lines[lines.length - 1] ?? "";
  assert.match(lines[lines.length - 2] ?? "", /\$0K/);
  // This is the exact shape seen on hqtui.com/apps: "$008-10".
  assert.doesNotMatch(timeRow, /\$0K?08-10/);
  assert.match(timeRow, /08-10/);
});

test("a two-row graph with a time axis does not lose the minimum off-surface", () => {
  // Too short to give the time axis its own row above the minimum; the point is
  // that it renders rather than writing outside the surface.
  assert.doesNotThrow(() => frame({ axis: true, min: 0, max: 100, timeAxis: TIME }, 40, 2));
  assert.doesNotThrow(() => frame({ axis: true, min: 0, max: 100, timeAxis: TIME }, 40, 3));
});

test("the time axis alone still owns the bottom row", () => {
  const lines = frame({ timeAxis: TIME });
  assert.match(lines[lines.length - 1] ?? "", /08-10/);
});
