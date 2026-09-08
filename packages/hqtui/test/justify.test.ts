import { describe, expect, test } from "bun:test";
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

describe("justify", () => {
  test("start is what every layout did before, so nothing moves", () => {
    expect(xs([4, 4, 4], "start")).toEqual([0, 4, 8]);
    expect(distribute(8, 3, "start")).toEqual({ lead: 0, seams: [0, 0] });
  });

  test("end pushes everything against the far edge", () => {
    // 20 wide, 12 used, 8 spare: the first child starts at 8.
    expect(xs([4, 4, 4], "end")).toEqual([8, 12, 16]);
  });

  test("center splits the slack, and the odd cell falls after the content", () => {
    expect(xs([4, 4, 4], "center")).toEqual([4, 8, 12]);
    // 20 - 9 = 11 spare, so 5 before and 6 after: the odd cell falls after the
    // content, which is what reads as centred.
    expect(xs([3, 3, 3], "center")).toEqual([5, 8, 11]);
  });

  test("space-between puts it all between, never at the ends", () => {
    const at = xs([4, 4, 4], "space-between");
    expect(at[0]).toBe(0);
    // 8 spare across 2 seams.
    expect(at).toEqual([0, 8, 16]);
    // The last child ends exactly on the far edge.
    expect((at[2] as number) + 4).toBe(20);
  });

  test("space-between with one child leaves it where it started", () => {
    // There is nothing to sit between.
    expect(xs([4], "space-between")).toEqual([0]);
    expect(distribute(16, 1, "space-between")).toEqual({ lead: 0, seams: [] });
  });

  test("space-evenly makes every gap the same, ends included", () => {
    // 20 - 12 = 8 across 4 gaps: 2 each.
    expect(xs([4, 4, 4], "space-evenly")).toEqual([2, 8, 14]);
  });

  test("space-around gives each child equal room, so the ends are half gaps", () => {
    // 9 spare over 3 children is 3 each: 1.5 at the ends, 3 between.
    const at = xs([4, 4, 3], "space-around", 20);
    expect(at[0]).toBe(2);
    expect((at[1] as number) - ((at[0] as number) + 4)).toBe(3);
  });

  test("an existing gap is kept and the slack is added to it", () => {
    // 12 of content and 2 of gap leaves 6, so each seam becomes 1 + 3 and the
    // last child still ends exactly on the far edge.
    expect(xs([4, 4, 4], "space-between", 20, 1)).toEqual([0, 8, 16]);
    expect(xs([4, 4, 4], "start", 20, 1)).toEqual([0, 5, 10]);
  });

  test("no slack means every mode agrees with start", () => {
    for (const justify of ["end", "center", "space-between", "space-around", "space-evenly"] as const) {
      // Exactly full: there is nothing to distribute.
      expect(xs([5, 5, 5, 5], justify)).toEqual([0, 5, 10, 15]);
    }
  });

  test("a flexible child leaves no slack, so justify is inert beside it", () => {
    const at = stack(rect(20), [{ size: 4 }, { size: "fill" }], "row", 0, "center").map((r) => r.x);
    // "fill" already absorbed everything; centring has nothing left to move.
    expect(at).toEqual([0, 4]);
  });

  test("nothing is invented or lost, for any slack, count or mode", () => {
    const modes: Justify[] = ["start", "end", "center", "space-between", "space-around", "space-evenly"];
    for (const justify of modes) {
      for (let count = 1; count <= 6; count++) {
        for (let slack = 0; slack <= 17; slack++) {
          expect(placesExactly(slack, count, justify)).toBe(true);
        }
      }
    }
  });

  test("children never overlap and never leave the rect", () => {
    const modes: Justify[] = ["start", "end", "center", "space-between", "space-around", "space-evenly"];
    for (const justify of modes) {
      for (let total = 6; total <= 24; total++) {
        const rects = stack(rect(total), [{ size: 3 }, { size: 4 }, { size: 2 }], "row", 1, justify);
        let edge = 0;
        for (const r of rects) {
          expect(r.x).toBeGreaterThanOrEqual(edge);
          edge = r.x + r.width;
        }
        expect(edge).toBeLessThanOrEqual(total);
      }
    }
  });

  test("columns justify down the same way rows justify across", () => {
    const ys = stack({ x: 0, y: 0, width: 10, height: 20 }, [{ size: 4 }, { size: 4 }], "column", 0, "end")
      .map((r) => r.y);
    expect(ys).toEqual([12, 16]);
  });
});
