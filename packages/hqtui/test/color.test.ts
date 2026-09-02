import { test } from "node:test";
import assert from "node:assert/strict";
import { rgb, hex, mix, gradient, to256, to16, from256, contrast, grayscale, DEFAULT_COLOR } from "../src/color.ts";
import { heatColor, themes } from "../src/theme.ts";
import { renderToText } from "../src/testing.ts";
import { detectCapabilities } from "../src/capabilities.ts";

test("hex and rgb produce the same packed value", () => {
  assert.equal(hex("#00d7ff"), rgb(0, 215, 255));
  assert.equal(hex("0df"), hex("#00ddff"));
  assert.equal(hex(0x00d7ff), rgb(0, 215, 255));
});

test("default color is distinguishable from black", () => {
  assert.notEqual(DEFAULT_COLOR, rgb(0, 0, 0));
  assert.equal(DEFAULT_COLOR, 0);
});

test("mix interpolates endpoints exactly", () => {
  const a = hex("#000000");
  const b = hex("#ffffff");
  assert.equal(mix(a, b, 0), a);
  assert.equal(mix(a, b, 1), b);
  assert.equal(mix(a, b, 0.5), rgb(128, 128, 128));
});

test("gradient samples all stops in order", () => {
  const g = gradient(["#000000", "#ff0000", "#ffffff"]);
  assert.equal(g(0), hex("#000000"));
  assert.equal(g(0.5), hex("#ff0000"));
  assert.equal(g(1), hex("#ffffff"));
  // Out of range is clamped, not wrapped.
  assert.equal(g(-1), hex("#000000"));
  assert.equal(g(2), hex("#ffffff"));
});

test("256 quantization round-trips through the cube", () => {
  assert.equal(to256(hex("#000000")), 16);
  assert.equal(to256(hex("#ffffff")), 231);
  // Grey ramp is preferred for desaturated colors.
  const grey = to256(hex("#808080"));
  assert.ok(grey >= 232 && grey <= 255, `expected grey ramp, got ${grey}`);
  assert.equal(from256(16), hex("#000000"));
});

test("16-color quantization picks a plausible neighbour", () => {
  assert.equal(to16(hex("#000000")), 0);
  assert.equal(to16(hex("#ffffff")), 15);
  // Pure red is nearer to palette 1 (205,49,49) than to bright red 9 (241,76,76).
  assert.ok([1, 9].includes(to16(hex("#ff0000"))));
});

test("contrast is symmetric and bounded", () => {
  const c = contrast(hex("#ffffff"), hex("#000000"));
  assert.ok(c > 20 && c <= 21);
  assert.equal(contrast(hex("#123456"), hex("#abcdef")), contrast(hex("#abcdef"), hex("#123456")));
});

test("grayscale keeps luminance ordering", () => {
  const dark = grayscale(hex("#102030"));
  const light = grayscale(hex("#e0e0e0"));
  assert.ok((dark & 255) < (light & 255));
});

test("a non-finite ratio does not become black", () => {
  // The clamp compared false against both bounds, so NaN reached cols[NaN] and
  // mix() coerced undefined to rgb(0,0,0) — black on black in a meter.
  const ramp = gradient(["#ffffff", "#000000"]);
  assert.equal(ramp(Number.NaN), ramp(0));
  assert.equal(ramp(Number.POSITIVE_INFINITY), ramp(1));
  assert.equal(ramp(Number.NEGATIVE_INFINITY), ramp(0));
  assert.equal(heatColor(themes.dark, Number.NaN), heatColor(themes.dark, 0));
});

test("a meter with a non-finite value renders a real percentage", () => {
  const out = renderToText(({ ui }) => ui.meter({ label: "CPU", value: Number.NaN }), {
    width: 28,
    height: 1,
  });
  assert.ok(!out.includes("NaN"), out);
  assert.ok(out.includes("0%"));
});

test("FORCE_COLOR raises the floor without lowering the ceiling", () => {
  const tty = { isTTY: true, columns: 80, rows: 24 } as unknown as NodeJS.WriteStream;
  const truecolor = { COLORTERM: "truecolor", TERM: "xterm-256color" };
  const depth = (env: Record<string, string>, out = tty) =>
    detectCapabilities({}, env as unknown as NodeJS.ProcessEnv, out).colors;

  // Asserting that color works must not cap a terminal that can do better.
  assert.equal(depth(truecolor), "truecolor");
  assert.equal(depth({ ...truecolor, FORCE_COLOR: "true" }), "truecolor");
  // It does waive the tty check, which is the point of the variable.
  assert.equal(depth({ ...truecolor, FORCE_COLOR: "true" }, { isTTY: false } as unknown as NodeJS.WriteStream), "truecolor");
  assert.equal(depth(truecolor, { isTTY: false } as unknown as NodeJS.WriteStream), "none");
  // Explicit levels still pin exactly, and the off switches still win.
  assert.equal(depth({ ...truecolor, FORCE_COLOR: "1" }), "ansi16");
  assert.equal(depth({ ...truecolor, FORCE_COLOR: "0" }), "none");
  assert.equal(depth({ ...truecolor, FORCE_COLOR: "false" }), "none");
  assert.equal(depth({ ...truecolor, NO_COLOR: "1", FORCE_COLOR: "true" }), "none");
});

test("the Linux console keeps unicode but not braille", () => {
  const tty = { isTTY: true, columns: 80, rows: 24 } as unknown as NodeJS.WriteStream;
  const caps = (term: string) =>
    detectCapabilities({}, { TERM: term, LANG: "en_US.UTF-8" } as unknown as NodeJS.ProcessEnv, tty);
  // Its default font draws box and block elements; only braille is missing.
  assert.equal(caps("linux").unicode, true);
  assert.equal(caps("linux").braille, false);
  // A dumb terminal has no glyph repertoire to speak of.
  assert.equal(caps("dumb").unicode, false);
  assert.equal(caps("dumb").braille, false);
});
