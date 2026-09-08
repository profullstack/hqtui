import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen, resolveSides, type Sides } from "../src/index.ts";

/**
 * Draw a box with the given sides and read the frame back as lines.
 *
 * A panel pads its interior by one column, which is why the content reads as
 * " ab" here and in every existing frame.
 */
const draw = (sides: Sides | undefined, width = 10, height = 4): string[] => {
  const frame = renderToScreen(
    ({ ui }) => {
      ui.panel({ border: "single", ...(sides === undefined ? {} : { sides }) }, (p) => {
        p.text("ab");
      });
    },
    { width, height },
  );
  return frame.text().split("\n").map((line) => line.replace(/\s+$/, ""));
};

test("sides: none given is all four, exactly as before", () => {
  assert.deepEqual(resolveSides(undefined), { top: true, right: true, bottom: true, left: true });
  assert.deepEqual(resolveSides("all"), { top: true, right: true, bottom: true, left: true });

  assert.deepEqual(draw(undefined), [
    "┌────────┐",
    "│ ab     │",
    "│        │",
    "└────────┘",
  ]);
});

test("sides: a top rule is a rule, not a box missing three sides", () => {
  // No corners: the rule runs straight through the cells they would occupy.
  // And it costs one row, not two, so the content starts on row 1.
  assert.deepEqual(draw(["top"]), ["──────────", " ab", "", ""]);
});

test("sides: a bottom rule leaves the top free for content", () => {
  assert.deepEqual(draw(["bottom"]), [" ab", "", "", "──────────"]);
});

test("sides: left and right are rails with nothing joining them", () => {
  // No top rule, so the content sits on row 0 between the two rails.
  assert.deepEqual(draw(["left", "right"]), [
    "│ ab     │",
    "│        │",
    "│        │",
    "│        │",
  ]);
});

test("sides: two that meet get their corner, and only that one", () => {
  assert.deepEqual(draw(["top", "left"]), ["┌─────────", "│ ab", "│", "│"]);
});

test("sides: three leave the fourth open", () => {
  assert.deepEqual(draw(["top", "left", "right"]), [
    "┌────────┐",
    "│ ab     │",
    "│        │",
    "│        │",
  ]);
});

test("sides: none draws nothing and costs nothing", () => {
  assert.deepEqual(resolveSides("none"), { top: false, right: false, bottom: false, left: false });
  // The whole area is the caller's, exactly as a border style of "none".
  assert.deepEqual(draw("none"), [" ab", "", "", ""]);
});

test("sides: an empty list is the same as none", () => {
  assert.deepEqual(draw([]), draw("none"));
});

test("sides: the interior costs one cell per rule, and only per rule", () => {
  assert.equal(draw(["bottom"])[0], " ab");
  assert.equal(draw(["top"])[1], " ab");
  assert.equal(draw(["left"])[0], "│ ab");
  // Right-only still starts the content at column 0.
  assert.equal(draw(["right"])[0], " ab      │");
});

test("sides: a title needs the rule it sits on", () => {
  const withTop = renderToScreen(
    ({ ui }) => ui.panel({ border: "single", title: "Head", sides: ["top"] }, (p) => p.text("x")),
    { width: 14, height: 3 },
  ).text();
  assert.ok(withTop.includes("Head"));

  // Without a top rule there is nowhere for it to be, so it is not painted
  // over the first row of content.
  const withoutTop = renderToScreen(
    ({ ui }) => ui.panel({ border: "single", title: "Head", sides: ["bottom"] }, (p) => p.text("x")),
    { width: 14, height: 3 },
  ).text();
  assert.ok(!withoutTop.includes("Head"));
});

test("sides: every existing frame is untouched, whatever the border style", () => {
  for (const border of ["rounded", "single", "double", "thick", "ascii"] as const) {
    const before = renderToScreen(
      ({ ui }) => ui.panel({ border, title: "T" }, (p) => p.text("x")),
      { width: 12, height: 4 },
    ).text();
    const after = renderToScreen(
      ({ ui }) => ui.panel({ border, title: "T", sides: "all" }, (p) => p.text("x")),
      { width: 12, height: 4 },
    ).text();
    assert.equal(after, before, border);
  }
});
