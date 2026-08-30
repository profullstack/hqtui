import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameBuffer, Attr } from "../src/buffer.ts";
import { hex } from "../src/color.ts";
import { CONTINUATION } from "../src/unicode.ts";

test("a new buffer is blank", () => {
  const b = new FrameBuffer(10, 3);
  assert.equal(b.width, 10);
  assert.equal(b.height, 3);
  assert.equal(b.toText(), "\n\n");
});

test("write places text and reports columns used", () => {
  const b = new FrameBuffer(10, 1);
  assert.equal(b.write(2, 0, "hi"), 2);
  assert.equal(b.rowText(0), "  hi      ");
});

test("write clips at the right edge instead of wrapping", () => {
  const b = new FrameBuffer(5, 1);
  b.write(3, 0, "abcdef");
  assert.equal(b.rowText(0), "   ab");
});

test("wide characters claim a continuation cell", () => {
  const b = new FrameBuffer(6, 1);
  b.write(0, 0, "日x");
  assert.equal(b.chars[1], CONTINUATION);
  assert.equal(b.rowText(0), "日x   ");
});

test("a wide char that does not fit degrades to a space", () => {
  const b = new FrameBuffer(3, 1);
  b.write(2, 0, "日");
  assert.equal(b.rowText(0), "   ");
});

test("styles are stored per cell", () => {
  const b = new FrameBuffer(4, 1);
  const fg = hex("#ff0000");
  b.write(0, 0, "x", { fg, attrs: Attr.Bold });
  assert.equal(b.fg[0], fg);
  assert.equal(b.attrs[0], Attr.Bold);
});

test("resize reuses the allocation when it can", () => {
  const b = new FrameBuffer(20, 10);
  const before = b.chars;
  b.resize(10, 5);
  assert.equal(b.width, 10);
  assert.equal(b.chars, before, "should not reallocate when shrinking");
  b.resize(40, 40);
  assert.notEqual(b.chars, before, "should grow the allocation");
});

test("copyFrom clones contents", () => {
  const a = new FrameBuffer(6, 2);
  a.write(0, 0, "abc");
  const b = new FrameBuffer(6, 2);
  b.copyFrom(a);
  assert.equal(b.toText(), a.toText());
});
