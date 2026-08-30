import { test } from "node:test";
import assert from "node:assert/strict";
import { rgb, hex, mix, gradient, to256, to16, from256, contrast, grayscale, DEFAULT_COLOR } from "../src/color.ts";

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
