import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen } from "../src/index.ts";
import { dropColumns } from "../src/unicode.ts";
import { dropSpanColumns } from "../src/richtext.ts";
import { drawClear } from "../src/widgets/surface.ts";

const lines = (view: Parameters<typeof renderToScreen>[0], width = 20, height = 4): string[] =>
  renderToScreen(view, { width, height }).text().split("\n").map((l) => l.trimEnd());

const PROSE = "one two three four five six seven eight nine ten eleven twelve";

test("paragraph: scroll counts wrapped lines, not source lines", () => {
  // The whole point: the caller does not know how many lines their text became,
  // so an offset that meant "source lines" would be unusable on wrapped text.
  const top = lines(({ ui }) => ui.text(PROSE, { wrap: true }));
  const down = lines(({ ui }) => ui.text(PROSE, { wrap: true, scroll: 1 }));
  assert.notDeepEqual(top, down);
  assert.deepEqual(down.slice(0, 3), top.slice(1, 4));
});

test("paragraph: scrolling past the end leaves the surface blank, not broken", () => {
  const past = lines(({ ui }) => ui.text(PROSE, { wrap: true, scroll: 999 }));
  assert.deepEqual(past, ["", "", "", ""]);
});

test("paragraph: a negative scroll is not a scroll backwards past the start", () => {
  const top = lines(({ ui }) => ui.text(PROSE, { wrap: true }));
  const negative = lines(({ ui }) => ui.text(PROSE, { wrap: true, scroll: -3 }));
  assert.deepEqual(negative, top);
});

test("paragraph: horizontal scroll shifts a line that is wider than the surface", () => {
  const at0 = lines(({ ui }) => ui.text("abcdefghijklmnopqrstuvwxyz"), 10, 1);
  const at5 = lines(({ ui }) => ui.text("abcdefghijklmnopqrstuvwxyz", { scrollX: 5 }), 10, 1);
  assert.equal(at0[0], "abcdefghi…");
  assert.equal(at5[0], "fghijklmn…");
});

test("paragraph: horizontal scroll works on styled text too", () => {
  const at3 = renderToScreen(
    ({ ui, theme }) => ui.text([{ text: "abc", fg: theme.primary }, { text: "defgh" }], { scrollX: 3 }),
    { width: 8, height: 1 },
  ).text().trimEnd();
  assert.equal(at3, "defgh");
});

test("dropColumns: a wide character cut in half leaves a space, not half a glyph", () => {
  // Two columns each. Cutting between them cannot draw half of one.
  assert.equal(dropColumns("日本語", 2), "本語");
  assert.equal(dropColumns("日本語", 1), " 本語");
  assert.equal(dropColumns("日本語", 0), "日本語");
  assert.equal(dropColumns("日本語", 99), "");
});

test("dropColumns: never slices inside a grapheme", () => {
  // A family emoji is one cell made of several codepoints; a code-unit slice
  // would leave fragments of it behind.
  const family = "👨‍👩‍👧";
  assert.equal(dropColumns(`${family}ab`, 2), "ab");
});

test("dropSpanColumns: the runs that survive keep their styles", () => {
  const line = [{ text: "red", fg: 0xff0000 }, { text: "blue", fg: 0x0000ff }];
  assert.deepEqual(dropSpanColumns(line, 3), [{ text: "blue", fg: 0x0000ff }]);
  // A cut inside a run keeps that run's style for what is left of it.
  assert.deepEqual(dropSpanColumns(line, 1), [
    { text: "ed", fg: 0xff0000 },
    { text: "blue", fg: 0x0000ff },
  ]);
  assert.deepEqual(dropSpanColumns(line, 0), line);
});

test("clear: an overlay stops showing what was underneath", () => {
  const before = lines(({ ui }) => {
    ui.text("aaaaaaaaaaaaaaaaaaaa");
    ui.text("bbbbbbbbbbbbbbbbbbbb");
  });
  assert.equal(before[0], "aaaaaaaaaaaaaaaaaaaa");

  const after = renderToScreen(({ ui }) => {
    ui.text("aaaaaaaaaaaaaaaaaaaa");
    ui.text("bbbbbbbbbbbbbbbbbbbb");
    // An overlay lands on top of a finished frame, which is exactly the case
    // that needs a region reset before it draws.
    ui.ctx.overlay((root) => drawClear(root.sub(2, 0, 6, 1)));
  }, { width: 20, height: 4 }).text().split("\n");
  assert.equal(after[0], "aa      aaaaaaaaaaaa");
});

test("fill: a region floods with the symbol it is given", () => {
  const out = lines(({ ui }) => ui.fill({ symbol: "·" }), 6, 2);
  assert.deepEqual(out, ["······", "······"]);
});

test("fill: a wide symbol tiles without leaving its other half behind", () => {
  // A double-width glyph occupies two cells; the second is its continuation,
  // so the fill steps over both rather than writing one glyph per column.
  const out = lines(({ ui }) => ui.fill({ symbol: "日" }), 4, 1);
  assert.equal(out[0], "日日");
  // An odd width cannot fit a third glyph, and half of one is damage.
  const odd = lines(({ ui }) => ui.fill({ symbol: "日" }), 5, 1);
  assert.equal(odd[0], "日日");
});

test("fill: an empty region is not an error", () => {
  const out = lines(({ ui }) => ui.fill({ symbol: "x", height: 0 }), 6, 2);
  assert.deepEqual(out, ["", ""]);
});
