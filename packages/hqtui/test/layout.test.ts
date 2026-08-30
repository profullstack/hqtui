import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, stack, inset, intersect } from "../src/layout.ts";

test("fixed sizes are respected", () => {
  assert.deepEqual(solve(100, [{ size: 10 }, { size: 20 }]), [10, 20]);
});

test("percentages resolve against the container", () => {
  assert.deepEqual(solve(100, [{ size: "40%" }, { size: "60%" }]), [40, 60]);
});

test("fractions split what is left over", () => {
  assert.deepEqual(solve(100, [{ size: 20 }, { size: "1fr" }, { size: "3fr" }]), [20, 20, 60]);
});

test("gaps come out of the available space", () => {
  const out = solve(100, [{ size: "1fr" }, { size: "1fr" }], 2);
  assert.deepEqual(out, [49, 49]);
  assert.equal(out[0] + out[1] + 2, 100);
});

test("min and max clamp flexible items and redistribute the surplus", () => {
  const out = solve(100, [{ size: "1fr", max: 10 }, { size: "1fr" }]);
  assert.deepEqual(out, [10, 90]);
  const out2 = solve(100, [{ size: "1fr", min: 80 }, { size: "1fr" }]);
  assert.deepEqual(out2, [80, 20]);
});

test("auto uses the intrinsic size", () => {
  assert.deepEqual(solve(100, [{ size: "auto", intrinsic: 7 }, { size: "1fr" }]), [7, 93]);
});

test("overflow shrinks instead of drawing outside", () => {
  const out = solve(10, [{ size: 8 }, { size: 8 }]);
  assert.ok(out[0] + out[1] <= 10);
});

test("nothing is ever negative", () => {
  for (const total of [0, 1, 3]) {
    for (const v of solve(total, [{ size: 5 }, { size: "1fr" }, { size: "50%" }], 1)) {
      assert.ok(v >= 0, `got ${v} for total ${total}`);
    }
  }
});

test("stack lays rects end to end without overlap", () => {
  const rects = stack({ x: 0, y: 0, width: 30, height: 10 }, [{ size: 10 }, { size: "1fr" }], "row", 2);
  assert.deepEqual(rects[0], { x: 0, y: 0, width: 10, height: 10 });
  assert.equal(rects[1].x, 12);
  assert.equal(rects[1].x + rects[1].width, 30);
});

test("inset shrinks and never inverts", () => {
  assert.deepEqual(inset({ x: 0, y: 0, width: 10, height: 10 }, 2), { x: 2, y: 2, width: 6, height: 6 });
  const tiny = inset({ x: 0, y: 0, width: 2, height: 2 }, 5);
  assert.equal(tiny.width, 0);
  assert.equal(tiny.height, 0);
});

test("intersect clips to the overlap", () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  const b = { x: 5, y: 5, width: 10, height: 10 };
  assert.deepEqual(intersect(a, b), { x: 5, y: 5, width: 5, height: 5 });
});
