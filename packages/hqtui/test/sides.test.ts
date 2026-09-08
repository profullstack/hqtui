import { describe, expect, test } from "bun:test";
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

describe("partial borders", () => {
  test("no sides given is all four, exactly as before", () => {
    expect(resolveSides(undefined)).toEqual({ top: true, right: true, bottom: true, left: true });
    expect(resolveSides("all")).toEqual({ top: true, right: true, bottom: true, left: true });

    expect(draw(undefined)).toEqual([
      "┌────────┐",
      "│ ab     │",
      "│        │",
      "└────────┘",
    ]);
  });

  test("a top rule is a rule, not a box missing three sides", () => {
    // No corners: the rule runs straight through the cells they would occupy.
    // And it costs one row, not two, so the content starts on row 1.
    expect(draw(["top"])).toEqual(["──────────", " ab", "", ""]);
  });

  test("a bottom rule leaves the top free for content", () => {
    expect(draw(["bottom"])).toEqual([" ab", "", "", "──────────"]);
  });

  test("left and right are rails with nothing joining them", () => {
    // No top rule, so the content sits on row 0 between the two rails.
    expect(draw(["left", "right"])).toEqual([
      "│ ab     │",
      "│        │",
      "│        │",
      "│        │",
    ]);
  });

  test("two sides that meet get their corner, and only that one", () => {
    expect(draw(["top", "left"])).toEqual(["┌─────────", "│ ab", "│", "│"]);
  });

  test("three sides leave the fourth open", () => {
    expect(draw(["top", "left", "right"])).toEqual([
      "┌────────┐",
      "│ ab     │",
      "│        │",
      "│        │",
    ]);
  });

  test("none draws nothing and costs nothing", () => {
    expect(resolveSides("none")).toEqual({ top: false, right: false, bottom: false, left: false });
    // The whole area is the caller's, exactly as a border style of "none".
    expect(draw("none")).toEqual([" ab", "", "", ""]);
  });

  test("an empty list is the same as none", () => {
    expect(draw([])).toEqual(draw("none"));
  });

  test("the interior costs one cell per rule, and only per rule", () => {
    expect(draw(["bottom"])[0]).toBe(" ab");
    expect(draw(["top"])[1]).toBe(" ab");
    expect(draw(["left"])[0]).toBe("│ ab");
    // Right-only still starts the content at column 0.
    expect(draw(["right"])[0]).toBe(" ab      │");
  });

  test("a title needs the rule it sits on", () => {
    const withTop = renderToScreen(
      ({ ui }) => ui.panel({ border: "single", title: "Head", sides: ["top"] }, (p) => p.text("x")),
      { width: 14, height: 3 },
    ).text();
    expect(withTop).toContain("Head");

    // Without a top rule there is nowhere for it to be, so it is not painted
    // over the first row of content.
    const withoutTop = renderToScreen(
      ({ ui }) => ui.panel({ border: "single", title: "Head", sides: ["bottom"] }, (p) => p.text("x")),
      { width: 14, height: 3 },
    ).text();
    expect(withoutTop).not.toContain("Head");
  });

  test("every existing frame is untouched, whatever the border style", () => {
    for (const border of ["rounded", "single", "double", "thick", "ascii"] as const) {
      const before = renderToScreen(
        ({ ui }) => ui.panel({ border, title: "T" }, (p) => p.text("x")),
        { width: 12, height: 4 },
      ).text();
      const after = renderToScreen(
        ({ ui }) => ui.panel({ border, title: "T", sides: "all" }, (p) => p.text("x")),
        { width: 12, height: 4 },
      ).text();
      expect(after).toBe(before);
    }
  });
});
