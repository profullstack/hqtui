import { test } from "node:test";
import assert from "node:assert/strict";
import { stringWidth, truncate, fit, wrap, graphemes, charWidth } from "../src/unicode.ts";

test("ascii width is one column per character", () => {
  assert.equal(stringWidth("hello"), 5);
  assert.equal(charWidth(0x41), 1);
});

test("CJK characters occupy two columns", () => {
  assert.equal(stringWidth("日本語"), 6);
  assert.equal(charWidth("日".codePointAt(0)!), 2);
});

test("combining marks do not consume a column", () => {
  assert.equal(stringWidth("é"), 1);
  assert.equal(graphemes("é").length, 1);
});

test("zero-width and control characters are free", () => {
  assert.equal(charWidth(0x200b), 0);
  assert.equal(stringWidth("a​b"), 2);
});

test("emoji sequences stay one cluster", () => {
  const clusters = graphemes("👩‍💻");
  assert.equal(clusters.length, 1);
});

test("truncate never exceeds the budget", () => {
  assert.equal(truncate("hello world", 8), "hello w…");
  assert.ok(stringWidth(truncate("日本語テスト", 5)) <= 5);
  assert.equal(truncate("short", 20), "short");
  assert.equal(truncate("anything", 0), "");
});

test("fit pads to an exact width in every alignment", () => {
  assert.equal(fit("ab", 6), "ab    ");
  assert.equal(fit("ab", 6, "right"), "    ab");
  assert.equal(fit("ab", 6, "center"), "  ab  ");
  assert.equal(stringWidth(fit("日本語", 4)), 4);
});

test("wrap breaks on words and hard-splits long ones", () => {
  assert.deepEqual(wrap("the quick brown fox", 10), ["the quick", "brown fox"]);
  const long = wrap("supercalifragilistic", 8);
  assert.ok(long.every((l) => stringWidth(l) <= 8));
  assert.equal(long.join(""), "supercalifragilistic");
});
