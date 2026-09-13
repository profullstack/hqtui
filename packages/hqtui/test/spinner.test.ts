import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToText, renderToScreen } from "../src/testing.ts";
import { SPINNER_FRAMES, spinnerFrame } from "../src/widgets/spinner.ts";

test("the frame follows the clock and wraps", () => {
  const frames = SPINNER_FRAMES.dots;
  assert.equal(spinnerFrame(0, frames), frames[0]);
  assert.equal(spinnerFrame(80, frames), frames[1]);
  assert.equal(spinnerFrame(79, frames), frames[0]);
  assert.equal(spinnerFrame(80 * frames.length, frames), frames[0]);
  assert.equal(spinnerFrame(1000, frames, 500), frames[2]);
  assert.equal(spinnerFrame(-5, frames), frames[0]);
  assert.equal(spinnerFrame(50, []), "");
});

test("a spinner draws the glyph, the label and the readout on one row", () => {
  const text = renderToText(({ ui }) => {
    ui.spinner({ label: "scanning last 7 days", text: "120/349", elapsed: 160 });
  }, { width: 40, height: 1 });
  assert.ok(text.startsWith(`${SPINNER_FRAMES.dots[2]} scanning last 7 days`), text);
  assert.ok(text.trimEnd().endsWith("120/349"), text);
});

test("an inactive spinner settles on a done mark and stops asking for frames", () => {
  let asked = 0;
  const done = renderToText(({ ui }) => {
    ui.spinner({ label: "loaded", active: false, elapsed: 160 });
  }, { width: 20, height: 1 });
  assert.ok(done.startsWith("✓ loaded"), done);

  // The container asks the app for another frame only while spinning.
  const screen = renderToScreen(({ ui }) => {
    const ctx = ui.ctx;
    const original = ctx.invalidate;
    ctx.invalidate = () => { asked += 1; original(); };
    ui.spinner({ label: "busy", elapsed: 0 });
    ui.spinner({ label: "idle", active: false, elapsed: 0 });
    ctx.invalidate = original;
  }, { width: 20, height: 2 });
  assert.equal(asked, 1);
  assert.ok(screen.text().includes("busy"));
});

test("frames can be named or supplied, and the line truncates instead of overflowing", () => {
  const ascii = renderToText(({ ui }) => ui.spinner({ frames: "ascii", elapsed: 80, label: "x" }), { width: 10, height: 1 });
  assert.ok(ascii.startsWith("/ x"), ascii);
  const own = renderToText(({ ui }) => ui.spinner({ frames: ["a", "b"], elapsed: 80 }), { width: 4, height: 1 });
  assert.ok(own.startsWith("b"), own);
  const narrow = renderToText(({ ui }) => ui.spinner({ label: "a label that is far too long for the row", text: "9/9", elapsed: 0 }), { width: 12, height: 1 });
  assert.ok(narrow.split("\n").every((line) => line.length <= 12), narrow);
});

test("a readout is drawn whole or not at all, and a one-column remainder stays blank", () => {
  const glyph = SPINNER_FRAMES.dots[0];
  // Width 10: "⠋ abcdef" is 8 wide, the readout needs 4 more, so it is dropped rather than shown as "…".
  const tight = renderToText(({ ui }) => ui.spinner({ label: "abcdef", text: "9/9", elapsed: 0 }), { width: 10, height: 1 });
  assert.equal(tight.trimEnd(), `${glyph} abcdef`);
  const fits = renderToText(({ ui }) => ui.spinner({ label: "abcdef", text: "9/9", elapsed: 0 }), { width: 12, height: 1 });
  assert.equal(fits, `${glyph} abcdef 9/9`);
  const wide = renderToText(({ ui }) => ui.spinner({ label: "abcdef", text: "9/9", elapsed: 0 }), { width: 16, height: 1 });
  assert.equal(wide, `${glyph} abcdef     9/9`);
  // Width 2 leaves one column after the glyph: no lone ellipsis.
  const two = renderToText(({ ui }) => ui.spinner({ label: "x", elapsed: 0 }), { width: 2, height: 1 });
  assert.equal(two.trimEnd(), glyph);
});

test("centre alignment keeps the readout with the label", () => {
  const glyph = SPINNER_FRAMES.dots[0];
  const centred = renderToText(({ ui }) => ui.spinner({ label: "load", text: "3/9", elapsed: 0, align: "center" }), { width: 24, height: 1 });
  assert.equal(centred.trimEnd(), `       ${glyph} load 3/9`);
  const right = renderToText(({ ui }) => ui.spinner({ label: "load", text: "3/9", elapsed: 0, align: "right" }), { width: 24, height: 1 });
  assert.equal(right, `              ${glyph} load 3/9`);
});

test("a terminal without Unicode gets the ascii set and a plain done mark", () => {
  const busy = renderToText(({ ui }) => ui.spinner({ label: "x", elapsed: 80 }), { width: 10, height: 1, capabilities: { unicode: false } });
  assert.ok(busy.startsWith("/ x"), busy);
  const done = renderToText(({ ui }) => ui.spinner({ label: "x", active: false, elapsed: 0 }), { width: 10, height: 1, capabilities: { unicode: false } });
  assert.ok(done.startsWith("* x"), done);
});

test("reducedMotion holds the first frame and asks for no redraw", () => {
  let asked = 0;
  const text = renderToScreen(({ ui }) => {
    const ctx = ui.ctx;
    const original = ctx.invalidate;
    ctx.invalidate = () => { asked += 1; original(); };
    ui.spinner({ label: "busy", elapsed: 800 });
    ctx.invalidate = original;
  }, { width: 20, height: 1, reducedMotion: true }).text();
  assert.equal(asked, 0);
  assert.ok(text.startsWith(`${SPINNER_FRAMES.dots[0]} busy`), text);
});
