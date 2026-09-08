import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen } from "../src/index.ts";
import { isVertical, offsetForPosition, thumb } from "../src/widgets/scrollbar.ts";

/** The bar as a string, read down a column or across a row. */
const bar = (
  options: { total: number; viewport: number; offset: number; orientation?: "right" | "left" | "bottom" | "top" },
  width = 3,
  height = 8,
): string => {
  const frame = renderToScreen(({ ui }) => ui.scrollbar(options), { width, height });
  const lines = frame.text().split("\n");
  const vertical = isVertical(options.orientation ?? "right");
  // A horizontal bar is a one-row container, so it draws on the first row
  // whichever edge of that row it was asked for.
  if (!vertical) return (lines[0] ?? "").trimEnd();
  const column = options.orientation === "left" ? 0 : width - 1;
  return lines.map((line) => line[column] ?? " ").join("");
};

test("scrollbar: the thumb is as long as the visible fraction", () => {
  // Half the content visible, so half the track.
  assert.deepEqual(thumb(10, 20, 0), { start: 0, size: 5 });
  // A quarter visible.
  assert.deepEqual(thumb(10, 40, 0), { start: 0, size: 3 });
});

test("scrollbar: a thumb never vanishes, however long the document", () => {
  // A million lines in ten cells still has to be grabbable.
  const { size } = thumb(10, 1_000_000, 0);
  assert.equal(size, 1);
});

test("scrollbar: content that fits fills the track", () => {
  // Nothing to scroll: a thumb over part of it would suggest otherwise.
  assert.deepEqual(thumb(10, 10, 0), { start: 0, size: 10 });
  assert.deepEqual(thumb(10, 4, 0), { start: 0, size: 10 });
});

test("scrollbar: the thumb reaches the bottom at the last offset, and no further", () => {
  const track = 10;
  const total = 30;
  const { size } = thumb(track, total, 0);
  const last = thumb(track, total, total - track);
  assert.equal(last.start + size, track);

  // Past the end is clamped rather than drawn off the track.
  const beyond = thumb(track, total, 9999);
  assert.deepEqual(beyond, last);
  // And before the start.
  assert.deepEqual(thumb(track, total, -5), thumb(track, total, 0));
});

test("scrollbar: nothing to draw is nothing, not a division by zero", () => {
  assert.deepEqual(thumb(0, 10, 0), { start: 0, size: 0 });
  assert.deepEqual(thumb(10, 0, 0), { start: 0, size: 0 });
});

test("scrollbar: it draws down the right edge by default", () => {
  // 8 cells, 32 lines, so a 2-cell thumb at the top.
  assert.equal(bar({ total: 32, viewport: 8, offset: 0 }), "██││││││");
  assert.equal(bar({ total: 32, viewport: 8, offset: 24 }), "││││││██");
});

test("scrollbar: and down the left when asked", () => {
  assert.equal(bar({ total: 32, viewport: 8, offset: 0, orientation: "left" }), "██││││││");
});

test("scrollbar: a horizontal bar uses a rule, not a wall of blocks", () => {
  // A run of █ across a row reads as a solid rule rather than a thumb.
  const top = bar({ total: 40, viewport: 10, offset: 0, orientation: "top" }, 10, 4);
  assert.match(top, /^━+─+$/);
  const bottom = bar({ total: 40, viewport: 10, offset: 30, orientation: "bottom" }, 10, 4);
  assert.match(bottom, /^─+━+$/);
});

test("scrollbar: a click centres the thumb on it", () => {
  const track = 10;
  const total = 100;
  const viewport = 10;
  // Clicking the top puts us at the top, the bottom at the bottom.
  assert.equal(offsetForPosition(0, track, total, viewport), 0);
  assert.equal(offsetForPosition(track - 1, track, total, viewport), total - viewport);
  // And the middle somewhere in the middle.
  const middle = offsetForPosition(5, track, total, viewport);
  assert.ok(middle > 0 && middle < total - viewport, `${middle}`);
});

test("scrollbar: nothing to scroll means every click is offset zero", () => {
  assert.equal(offsetForPosition(5, 10, 10, 10), 0);
  assert.equal(offsetForPosition(5, 10, 3, 10), 0);
  assert.equal(offsetForPosition(5, 0, 100, 10), 0);
});

test("scrollbar: the extracted renderer still draws what the table drew", () => {
  // The table, list, tree and log route through the same code, so their
  // appearance is pinned by their own fixtures; this checks the shape directly.
  const withList = renderToScreen(
    ({ ui }) => ui.list({ items: Array.from({ length: 40 }, (_, i) => `row ${i}`), scrollbar: true }),
    { width: 12, height: 6 },
  ).text().split("\n");
  const column = withList.map((line) => line[11] ?? " ").join("");
  assert.match(column, /^█+│+$/);
});

test("scrollbar: clicking the track moves you there", () => {
  // 100 lines, 10 visible, 20 cells of track.
  let offset = 0;
  const screen = renderToScreen(
    ({ ui }) => ui.scrollbar({ total: 100, viewport: 10, offset, onScroll: (d) => { offset += d; } }),
    { width: 2, height: 20 },
  );
  const region = screen.regions[0];
  assert.ok(region, "the bar registers a hit region");

  // The wheel is a plain delta, as it is for every other scrollable widget.
  region.onScroll?.(1);
  assert.equal(offset, 1);

  // A click reports the delta that lands the thumb where you clicked, so one
  // handler serves both.
  offset = 0;
  region.onClick?.(0, 19, "left");
  assert.equal(offset, 90);
  offset = 0;
  region.onClick?.(0, 0, "left");
  assert.equal(offset, 0);
});

test("scrollbar: a decorative bar registers nothing to click", () => {
  // No handlers means no hit region, so it cannot eat a click meant for what
  // is underneath it.
  const screen = renderToScreen(({ ui }) => ui.scrollbar({ total: 100, viewport: 10, offset: 0 }), {
    width: 2,
    height: 20,
  });
  assert.equal(screen.regions.length, 0);
});
