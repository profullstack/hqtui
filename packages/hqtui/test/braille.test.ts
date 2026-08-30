import { test } from "node:test";
import assert from "node:assert/strict";
import { BrailleCanvas } from "../src/graphics/braille.ts";
import { verticalGlyph, horizontalGlyph } from "../src/graphics/blocks.ts";

test("a canvas exposes 2x4 pixels per cell", () => {
  const c = new BrailleCanvas(10, 5);
  assert.equal(c.width, 20);
  assert.equal(c.height, 20);
});

test("setting a pixel produces the right braille codepoint", () => {
  const c = new BrailleCanvas(1, 1);
  c.pixel(0, 0);
  assert.equal(c.cell(0, 0), 0x2801);
  c.pixel(1, 3);
  assert.equal(c.cell(0, 0), 0x2881);
});

test("out of range pixels are ignored, not wrapped", () => {
  const c = new BrailleCanvas(2, 1);
  c.pixel(-1, 0);
  c.pixel(100, 0);
  c.pixel(0, 100);
  assert.equal(c.cell(0, 0), 0);
  assert.equal(c.cell(1, 0), 0);
});

test("a horizontal line fills every cell it crosses", () => {
  const c = new BrailleCanvas(4, 1);
  c.line(0, 0, 7, 0);
  for (let col = 0; col < 4; col++) assert.notEqual(c.cell(col, 0), 0);
});

test("a diagonal line is continuous", () => {
  const c = new BrailleCanvas(8, 4);
  c.line(0, 0, 15, 15);
  const lines = c.toLines();
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => l.trim().length > 0));
});

test("clear resets every cell", () => {
  const c = new BrailleCanvas(3, 2);
  c.fillRect(0, 0, 5, 7);
  c.clear();
  assert.equal(c.toLines().join("").trim(), "");
});

test("fillUnder shades down to the baseline", () => {
  const c = new BrailleCanvas(4, 2);
  c.fillUnder([[0, 0], [7, 0]], 7);
  assert.notEqual(c.cell(0, 1), 0, "the bottom row should be filled");
});

test("block glyph ramps are monotonic", () => {
  assert.equal(verticalGlyph(0), " ");
  assert.equal(verticalGlyph(1), "█");
  assert.equal(horizontalGlyph(0), " ");
  assert.equal(horizontalGlyph(1), "█");
  assert.notEqual(verticalGlyph(0.5), verticalGlyph(0.9));
});
