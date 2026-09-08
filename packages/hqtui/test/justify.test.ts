import { test } from "node:test";
import assert from "node:assert/strict";
import { distribute, stack, type Justify } from "../src/index.ts";

const rect = (width: number) => ({ x: 0, y: 0, width, height: 1 });
const xs = (widths: number[], justify: Justify, total = 20, gap = 0) =>
  stack(rect(total), widths.map((size) => ({ size })), "row", gap, justify).map((r) => r.x);

/** Every mode has to place exactly the slack it was given: no cell invented, none lost. */
function placesExactly(slack: number, count: number, justify: Justify): boolean {
  const { lead, seams } = distribute(slack, count, justify);
  const placed = lead + seams.reduce((a, b) => a + b, 0);
  return placed >= 0 && placed <= slack && lead >= 0 && seams.every((s) => s >= 0);
}

const MODES: Justify[] = ["start", "end", "center", "space-between", "space-around", "space-evenly"];

test("justify: start is what every layout did before, so nothing moves", () => {
  assert.deepEqual(xs([4, 4, 4], "start"), [0, 4, 8]);
  assert.deepEqual(distribute(8, 3, "start"), { lead: 0, seams: [0, 0] });
});

test("justify: end pushes everything against the far edge", () => {
  // 20 wide, 12 used, 8 spare: the first child starts at 8.
  assert.deepEqual(xs([4, 4, 4], "end"), [8, 12, 16]);
});

test("justify: center splits the slack, and the odd cell falls after the content", () => {
  assert.deepEqual(xs([4, 4, 4], "center"), [4, 8, 12]);
  // 20 - 9 = 11 spare, so 5 before and 6 after, which is what reads as centred.
  assert.deepEqual(xs([3, 3, 3], "center"), [5, 8, 11]);
});

test("justify: space-between puts it all between, never at the ends", () => {
  const at = xs([4, 4, 4], "space-between");
  assert.deepEqual(at, [0, 8, 16]);
  // The last child ends exactly on the far edge.
  assert.equal((at[2] as number) + 4, 20);
});

test("justify: space-between with one child leaves it where it started", () => {
  // There is nothing to sit between.
  assert.deepEqual(xs([4], "space-between"), [0]);
  assert.deepEqual(distribute(16, 1, "space-between"), { lead: 0, seams: [] });
});

test("justify: space-evenly makes every gap the same, ends included", () => {
  // 20 - 12 = 8 across 4 gaps: 2 each.
  assert.deepEqual(xs([4, 4, 4], "space-evenly"), [2, 8, 14]);
});

test("justify: space-around gives each child equal room, so the ends are half gaps", () => {
  // 9 spare over 3 children is 3 each: 1.5 at the ends, 3 between.
  const at = xs([4, 4, 3], "space-around", 20);
  assert.equal(at[0], 2);
  assert.equal((at[1] as number) - ((at[0] as number) + 4), 3);
});

test("justify: an existing gap is kept and the slack is added to it", () => {
  // 12 of content and 2 of gap leaves 6, so each seam becomes 1 + 3 and the
  // last child still ends exactly on the far edge.
  assert.deepEqual(xs([4, 4, 4], "space-between", 20, 1), [0, 8, 16]);
  assert.deepEqual(xs([4, 4, 4], "start", 20, 1), [0, 5, 10]);
});

test("justify: no slack means every mode agrees with start", () => {
  for (const justify of MODES) {
    // Exactly full: there is nothing to distribute.
    assert.deepEqual(xs([5, 5, 5, 5], justify), [0, 5, 10, 15]);
  }
});

test("justify: a flexible child leaves no slack, so it is inert beside one", () => {
  const at = stack(rect(20), [{ size: 4 }, { size: "fill" }], "row", 0, "center").map((r) => r.x);
  // "fill" already absorbed everything; centring has nothing left to move.
  assert.deepEqual(at, [0, 4]);
});

test("justify: nothing is invented or lost, for any slack, count or mode", () => {
  for (const justify of MODES) {
    for (let count = 1; count <= 6; count++) {
      for (let slack = 0; slack <= 17; slack++) {
        assert.equal(placesExactly(slack, count, justify), true, `${justify} ${count} ${slack}`);
      }
    }
  }
});

test("justify: children never overlap and never leave the rect", () => {
  for (const justify of MODES) {
    for (let total = 6; total <= 24; total++) {
      const rects = stack(rect(total), [{ size: 3 }, { size: 4 }, { size: 2 }], "row", 1, justify);
      let edge = 0;
      for (const r of rects) {
        assert.ok(r.x >= edge, `${justify} ${total}: ${r.x} < ${edge}`);
        edge = r.x + r.width;
      }
      assert.ok(edge <= total, `${justify} ${total}: ${edge} > ${total}`);
    }
  }
});

test("justify: columns justify down the same way rows justify across", () => {
  const ys = stack({ x: 0, y: 0, width: 10, height: 20 }, [{ size: 4 }, { size: 4 }], "column", 0, "end")
    .map((r) => r.y);
  assert.deepEqual(ys, [12, 16]);
});
