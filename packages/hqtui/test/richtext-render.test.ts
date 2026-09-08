import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen, renderToText } from "../src/testing.ts";
import { Attr } from "../src/buffer.ts";
import { hex } from "../src/color.ts";
import type { SpanLine } from "../src/richtext.ts";

const RED = hex("#ff0000");
const BLUE = hex("#0000ff");

test("a styled line paints each span in its own colour", () => {
  const screen = renderToScreen(
    ({ ui }) => {
      ui.text([
        { text: "ERR ", fg: RED, bold: true },
        { text: "ok", fg: BLUE },
      ]);
    },
    { width: 10, height: 1 },
  );
  assert.equal(screen.line(0), "ERR ok");
  assert.equal(screen.cell(0, 0).fg, RED);
  assert.ok((screen.cell(0, 0).attrs & Attr.Bold) !== 0, "first span is bold");
  assert.equal(screen.cell(4, 0).fg, BLUE);
  assert.ok((screen.cell(4, 0).attrs & Attr.Bold) === 0, "second span is not bold");
});

test("a one-span line renders the same cells as the equivalent string", () => {
  const draw = (rich: boolean) =>
    renderToScreen(
      ({ ui, theme }) => {
        if (rich) ui.text([{ text: "hello world", fg: theme.foreground }]);
        else ui.text("hello world");
      },
      { width: 20, height: 1 },
    );
  assert.deepEqual(draw(true).toJSON(), draw(false).toJSON());
});

test("styles survive wrapping across lines", () => {
  const line: SpanLine = [
    { text: "AAAA ", fg: RED },
    { text: "BBBB CCCC", fg: BLUE },
  ];
  const screen = renderToScreen(({ ui }) => ui.text(line, { wrap: true }), { width: 6, height: 4 });
  assert.equal(screen.line(0), "AAAA");
  assert.equal(screen.cell(0, 0).fg, RED);
  // The blue run continues onto the wrapped lines rather than resetting.
  assert.equal(screen.line(1), "BBBB");
  assert.equal(screen.cell(0, 1).fg, BLUE);
  assert.equal(screen.line(2), "CCCC");
  assert.equal(screen.cell(0, 2).fg, BLUE);
});

test("a styled paragraph reserves the rows it actually wraps to", () => {
  // If the intrinsic height were measured as one line, the divider below would
  // sit on top of the text instead of under it.
  const text = renderToText(
    ({ ui }) => {
      ui.text([{ text: "one two three four five six", fg: RED }], { wrap: true });
      ui.divider();
    },
    { width: 10, height: 6 },
  ).split("\n");
  const rule = text.findIndex((l) => l.startsWith("──"));
  assert.ok(rule >= 3, `divider landed on row ${rule}, above the wrapped text`);
});

test("a truncated styled line keeps its colours and the ellipsis", () => {
  const screen = renderToScreen(
    ({ ui }) => ui.text([{ text: "aaaa", fg: RED }, { text: "bbbbbbbb", fg: BLUE }]),
    { width: 6, height: 1 },
  );
  assert.equal(screen.line(0), "aaaab…");
  assert.equal(screen.cell(0, 0).fg, RED);
  assert.equal(screen.cell(5, 0).fg, BLUE, "the ellipsis takes the interrupted span's colour");
});

test("label and heading take spans too, and the span colour wins", () => {
  const screen = renderToScreen(
    ({ ui }) => {
      ui.label([{ text: "muted" }, { text: "red", fg: RED }]);
      ui.heading([{ text: "title" }]);
    },
    { width: 12, height: 2 },
  );
  assert.equal(screen.line(0), "mutedred");
  assert.equal(screen.cell(5, 0).fg, RED);
  // The unstyled span inherits what label chose.
  assert.notEqual(screen.cell(0, 0).fg, RED);
  assert.ok((screen.cell(0, 1).attrs & Attr.Bold) !== 0, "heading is still bold");
});

test("alignment applies to the whole styled line", () => {
  const screen = renderToScreen(
    ({ ui }) => ui.text([{ text: "ab", fg: RED }], { align: "right" }),
    { width: 6, height: 1 },
  );
  assert.equal(screen.line(0), "    ab");
  assert.equal(screen.cell(4, 0).fg, RED);
});

test("an empty span line renders a blank row without crashing", () => {
  const screen = renderToScreen(({ ui }) => ui.text([[], [{ text: "x" }]]), { width: 4, height: 2 });
  assert.equal(screen.line(0), "");
  assert.equal(screen.line(1), "x");
});
