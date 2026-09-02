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

test("braille draws nothing for a NaN coordinate", () => {
  // NaN has no position and no direction, so there is nothing to draw.
  const canvas = new BrailleCanvas(20, 8);
  canvas.line(0, 0, 5, Number.NaN);
  canvas.line(Number.NaN, 0, 5, 5);
  canvas.pixel(Number.NaN, 0);
  canvas.pixel(0, Number.NaN);
  canvas.vline(0, 0, Number.NaN);
  canvas.circle(4, 4, Number.NaN);
  assert.equal(canvas.toLines().join("").trim(), "");
});

test("every braille primitive terminates on any coordinate", () => {
  // Each of these once ran forever. Endpoint finiteness was not enough: `dx` is
  // derived from the endpoints and overflows, and past 2^53 `x += 1` does not
  // advance, so an all-finite call could still never reach its endpoint.
  const canvas = new BrailleCanvas(20, 8);
  const M = Number.MAX_VALUE;
  const I = Number.POSITIVE_INFINITY;
  canvas.line(-M, 0, M, 0);
  canvas.line(1e17, 0, 2e17, 0);
  canvas.line(0, 0, I, 5);
  canvas.polyline([[0, 0], [1024 / 1e-300, 0]]);
  canvas.vline(0, 0, I);
  canvas.vline(0, 0, 1e17);
  canvas.hline(0, 0, I);
  canvas.rect(0, 0, 5, I);
  canvas.fillRect(0, 0, I, 5);
  canvas.fillUnder([[0, 0], [I, 0]], 3);
  canvas.circle(4, 4, I);
  canvas.circle(4, 4, 1e17);
  // Reaching here at all is the assertion; the canvas keeps its declared shape.
  assert.equal(canvas.toLines().length, 8);
  assert.ok(canvas.toLines().every((line) => [...line].length === 20));
});

test("a line crossing the canvas from far away still draws its visible part", () => {
  const canvas = new BrailleCanvas(20, 8);
  canvas.line(-1e9, 4, 1e9, 4);
  assert.ok(canvas.toLines().join("").trim().length > 0, "the visible span was lost");
});
