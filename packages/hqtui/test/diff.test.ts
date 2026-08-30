import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameBuffer } from "../src/buffer.ts";
import { Encoder } from "../src/diff.ts";
import { hex } from "../src/color.ts";
import { stripAnsi } from "../src/ansi.ts";

function pair(width = 20, height = 3): [FrameBuffer, FrameBuffer] {
  return [new FrameBuffer(width, height), new FrameBuffer(width, height)];
}

test("identical frames emit nothing", () => {
  const [prev, next] = pair();
  const result = new Encoder().encode(prev, next);
  assert.equal(result.output, "");
  assert.equal(result.changedCells, 0);
});

test("a one-cell change emits only that cell", () => {
  const [prev, next] = pair();
  next.write(5, 1, "X");
  const result = new Encoder().encode(prev, next);
  assert.equal(result.changedCells, 1);
  assert.equal(result.dirtyRows, 1);
  assert.equal(stripAnsi(result.output), "X");
  assert.ok(result.output.includes("\x1b[2;6H"), "should position the cursor exactly");
});

test("CPU 72% -> 73% rewrites two characters, not the screen", () => {
  const [prev, next] = pair(40, 1);
  prev.write(0, 0, "CPU 72%");
  next.write(0, 0, "CPU 73%");
  const result = new Encoder().encode(prev, next);
  assert.equal(result.changedCells, 1);
  assert.ok(result.output.length < 20, `expected a tiny write, got ${result.output.length} bytes`);
});

test("a full repaint covers every row", () => {
  const [prev, next] = pair(10, 4);
  next.write(0, 0, "abc");
  const result = new Encoder().encode(prev, next, true);
  assert.equal(result.dirtyRows, 4);
});

test("style state is not re-emitted for unchanged runs", () => {
  const [prev, next] = pair(20, 1);
  const red = hex("#ff0000");
  next.write(0, 0, "aaaaa", { fg: red });
  const output = new Encoder().encode(prev, next).output;
  const colorSequences = output.match(/\x1b\[38;2;255;0;0m/g) ?? [];
  assert.equal(colorSequences.length, 1, "the foreground should be set once for the run");
});

test("nearby changes merge into one run instead of many cursor jumps", () => {
  const [prev, next] = pair(40, 1);
  next.write(0, 0, "A");
  next.write(3, 0, "B");
  const output = new Encoder().encode(prev, next).output;
  const moves = output.match(/\x1b\[\d+;\d+H/g) ?? [];
  assert.equal(moves.length, 1, "a 2-cell gap is cheaper to overwrite than to skip");
});

test("distant changes do not merge", () => {
  const [prev, next] = pair(80, 1);
  next.write(0, 0, "A");
  next.write(60, 0, "B");
  const output = new Encoder().encode(prev, next).output;
  assert.ok(stripAnsi(output).length < 20, "should not repaint the whole row");
});

test("changed cell counts scale with the change, not the screen", () => {
  const [prev, next] = pair(100, 40);
  for (let y = 0; y < 40; y += 10) next.write(0, y, "hello");
  const result = new Encoder().encode(prev, next);
  assert.equal(result.changedCells, 20);
  assert.equal(result.dirtyRows, 4);
});

test("color depth downgrades to 256 and 16 colour escapes", () => {
  const [prev, next] = pair(10, 1);
  next.write(0, 0, "x", { fg: hex("#00d7ff") });
  assert.ok(new Encoder({ colors: "ansi256" }).encode(prev, next).output.includes("\x1b[38;5;"));
  assert.ok(new Encoder({ colors: "ansi16" }).encode(prev, next).output.match(/\x1b\[(3|9)\dm/));
  const none = new Encoder({ colors: "none" }).encode(prev, next).output;
  assert.equal(stripAnsi(none), "x");
});

test("wide characters are re-emitted with their lead cell", () => {
  const [prev, next] = pair(10, 1);
  prev.write(0, 0, "ab");
  next.write(0, 0, "日");
  const result = new Encoder().encode(prev, next);
  assert.ok(stripAnsi(result.output).includes("日"));
});
