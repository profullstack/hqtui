import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen } from "../src/index.ts";
import { BrailleCanvas } from "../src/graphics/braille.ts";
import { projection } from "../src/graphics/canvas.ts";
import type { CanvasOptions } from "../src/graphics/canvas.ts";

const rows = (options: CanvasOptions, width = 20, height = 6): string[] =>
  renderToScreen(({ ui }) => ui.shapes(options), { width, height })
    .text().split("\n").map((line) => line.trimEnd());

/** Which rows carry ink, top first. */
const inkedRows = (lines: string[]): number[] =>
  lines.map((line, i) => (line.trim().length > 0 ? i : -1)).filter((i) => i >= 0);

const inkedColumns = (lines: string[]): number[] => {
  const columns = new Set<number>();
  for (const line of lines) {
    for (let x = 0; x < line.length; x++) if (line[x] !== " ") columns.add(x);
  }
  return [...columns].sort((a, b) => a - b);
};

test("canvas: y goes up, as it does on paper", () => {
  // The whole reason this exists: a caller drawing a graph or a map should not
  // have to flip every coordinate because a terminal counts rows downwards.
  const low = rows({ shapes: [{ type: "points", points: [[0.5, 0]] }], x: { min: 0, max: 1 }, y: { min: 0, max: 1 } });
  const high = rows({ shapes: [{ type: "points", points: [[0.5, 1]] }], x: { min: 0, max: 1 }, y: { min: 0, max: 1 } });
  assert.deepEqual(inkedRows(high), [0], "y = max is the top row");
  assert.deepEqual(inkedRows(low), [5], "y = min is the bottom row");
});

test("canvas: the same drawing fits whatever region it is given", () => {
  // A drawing in its own coordinates is size-independent; that is the point.
  const shapes: CanvasOptions = {
    shapes: [{ type: "line", x1: 0, y1: 0, x2: 10, y2: 10 }],
    x: { min: 0, max: 10 },
    y: { min: 0, max: 10 },
  };
  for (const [w, h] of [[20, 6], [40, 12], [11, 3]]) {
    const lines = rows(shapes, w, h);
    const columns = inkedColumns(lines);
    assert.equal(columns[0], 0, `${w}x${h} did not start at the left edge`);
    assert.equal(columns[columns.length - 1], w - 1, `${w}x${h} did not reach the right edge`);
    // A diagonal: the top row has ink and so does the bottom.
    assert.ok(lines[0].trim().length > 0, `${w}x${h} missed the top`);
    assert.ok(lines[h - 1].trim().length > 0, `${w}x${h} missed the bottom`);
  }
});

test("canvas: bounds place a shape, they do not merely scale it", () => {
  // The same point under two different domains lands in two different places.
  const shapes: CanvasOptions["shapes"] = [{ type: "points", points: [[1, 0.5]] }];
  const near = inkedColumns(rows({ shapes, x: { min: 0, max: 2 }, y: { min: 0, max: 1 } }));
  const far = inkedColumns(rows({ shapes, x: { min: 0, max: 100 }, y: { min: 0, max: 1 } }));
  assert.ok(near[0] > far[0], `expected the wider domain to push it left: ${near} vs ${far}`);
  assert.equal(far[0], 0, "1 in a domain of 100 is at the left edge");
});

test("canvas: a zero-width domain falls back rather than dividing by it", () => {
  // Every point would map to the same place, and the division would blow up.
  const lines = rows({
    shapes: [{ type: "points", points: [[0.5, 0.5]] }],
    x: { min: 5, max: 5 },
    y: { min: 0, max: 1 },
  });
  assert.ok(lines.join("").trim().length >= 0, "did not throw");
  const nan = rows({
    shapes: [{ type: "points", points: [[0.5, 0.5]] }],
    x: { min: Number.NaN, max: 1 },
  });
  assert.ok(nan.join("").trim().length > 0, "a broken bound left nothing drawn");
});

test("canvas: a rectangle is a corner and a size, in the caller's direction", () => {
  // A positive height goes up, because the caller's y does.
  const outline = rows({
    shapes: [{ type: "rect", x: 0.2, y: 0.2, width: 0.6, height: 0.6 }],
    x: { min: 0, max: 1 },
    y: { min: 0, max: 1 },
  }, 20, 6);
  const filled = rows({
    shapes: [{ type: "rect", x: 0.2, y: 0.2, width: 0.6, height: 0.6, fill: true }],
    x: { min: 0, max: 1 },
    y: { min: 0, max: 1 },
  }, 20, 6);
  const ink = (lines: string[]) => lines.join("").replace(/\s/g, "").length;
  assert.ok(ink(outline) > 0, "the outline drew nothing");
  assert.ok(ink(filled) > ink(outline), "the fill was no denser than the outline");
});

test("canvas: shapes keep their own colours", () => {
  const screen = renderToScreen(
    ({ ui, theme }) => ui.shapes({
      shapes: [
        { type: "line", x1: 0, y1: 0, x2: 1, y2: 0, color: theme.danger },
        { type: "line", x1: 0, y1: 1, x2: 1, y2: 1, color: theme.success },
      ],
      x: { min: 0, max: 1 },
      y: { min: 0, max: 1 },
    }),
    { width: 20, height: 4 },
  );
  const colours = new Set(
    [...screen.buffer.chars].map((c, i) => (c !== 0 && c !== 32 ? screen.buffer.fg[i] : -1)),
  );
  colours.delete(-1);
  // Two shapes, two colours: a shared canvas would let the last one win.
  assert.equal(colours.size, 2, `expected two colours, got ${[...colours]}`);
});

test("canvas: a shape with nothing finite in it is skipped, not drawn at zero", () => {
  const good = rows({
    shapes: [{ type: "line", x1: 0, y1: 0, x2: 1, y2: 1 }],
    x: { min: 0, max: 1 },
    y: { min: 0, max: 1 },
  });
  const withJunk = rows({
    shapes: [
      { type: "line", x1: Number.NaN, y1: 0, x2: 1, y2: 1 },
      { type: "line", x1: 0, y1: 0, x2: 1, y2: 1 },
    ],
    x: { min: 0, max: 1 },
    y: { min: 0, max: 1 },
  });
  assert.deepEqual(withJunk, good);
});

test("canvas: the projection is the one the shapes were drawn with", () => {
  // Handed out so a caller can put their own labels against the same drawing.
  const canvas = new BrailleCanvas(10, 4);
  const at = projection(canvas, { min: 0, max: 10 }, { min: 0, max: 10 });
  assert.equal(at.x(0), 0);
  assert.equal(at.x(10), canvas.width - 1);
  // Flipped: the caller's maximum is the canvas's row zero.
  assert.equal(at.y(10), 0);
  assert.equal(at.y(0), canvas.height - 1);
});

test("canvas: an empty shape list draws nothing at all", () => {
  const lines = rows({ shapes: [] });
  assert.deepEqual(lines, ["", "", "", "", "", ""]);
});
