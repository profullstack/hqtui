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
    const ctx = (ui as unknown as { ctx: { invalidate: () => void } }).ctx;
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
