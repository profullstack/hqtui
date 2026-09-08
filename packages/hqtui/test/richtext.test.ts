import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitSpans, isRich, spanStyle, spanText, spanWidth, toSpanLines,
  truncateSpans, wrapRich, wrapSpans, type SpanLine,
} from "../src/richtext.ts";
import { fit, stringWidth, truncate, wrap } from "../src/unicode.ts";
import { Attr } from "../src/buffer.ts";

/**
 * The corpus every parity test runs against. Two text layout engines that
 * disagree by one column is a bug you find in a screenshot months later, so
 * the span versions are held to the exact output of the string versions.
 */
const CORPUS = [
  "",
  "hello",
  "hello world",
  "the quick brown fox jumps over the lazy dog",
  "supercalifragilisticexpialidocious",
  "a bb ccc dddd eeeee ffffff",
  "  leading and trailing  ",
  "tabs\tand\tthings",
  "CJK 日本語のテキスト wide",
  "日本語日本語日本語日本語",
  "emoji 👍 and 👨‍👩‍👧‍👦 family",
  "combining é and é marks",
  "line one\nline two\nline three",
  "trailing newline\n",
  "\nleading newline",
  "double\n\nblank",
  "one-very-long-unbroken-token-that-exceeds-any-sane-width",
  "mixed 日本語 with ascii and 👍 emoji together",
];

const WIDTHS = [1, 2, 3, 5, 8, 13, 20, 40];

function one(text: string): SpanLine {
  return text === "" ? [] : [{ text }];
}

test("spanWidth matches stringWidth", () => {
  for (const text of CORPUS) {
    assert.equal(spanWidth(one(text)), stringWidth(text), text);
  }
});

test("truncateSpans cuts at the same column as truncate", () => {
  for (const text of CORPUS) {
    if (text.includes("\n")) continue; // truncate() has no newline semantics
    for (const width of WIDTHS) {
      assert.equal(
        spanText(truncateSpans(one(text), width)),
        truncate(text, width),
        `${JSON.stringify(text)} @${width}`,
      );
    }
  }
});

test("fitSpans pads to the same columns as fit", () => {
  for (const text of CORPUS) {
    if (text.includes("\n")) continue;
    for (const width of WIDTHS) {
      for (const align of ["left", "right", "center"] as const) {
        assert.equal(
          spanText(fitSpans(one(text), width, align)),
          fit(text, width, align),
          `${JSON.stringify(text)} @${width} ${align}`,
        );
      }
    }
  }
});

test("wrapSpans breaks in the same places as wrap", () => {
  for (const text of CORPUS) {
    if (text.includes("\n")) continue; // wrap() splits paragraphs itself
    for (const width of WIDTHS) {
      assert.deepEqual(
        wrapSpans(one(text), width).map(spanText),
        wrap(text, width),
        `${JSON.stringify(text)} @${width}`,
      );
    }
  }
});

test("wrapRich on a plain string matches wrap, newlines included", () => {
  for (const text of CORPUS) {
    for (const width of WIDTHS) {
      assert.deepEqual(
        wrapRich(text, width).map(spanText),
        wrap(text, width),
        `${JSON.stringify(text)} @${width}`,
      );
    }
  }
});

// ---------------------------------------------------------------- styling

test("a string is the one-span case", () => {
  assert.equal(isRich("plain"), false);
  assert.deepEqual(toSpanLines("plain"), [[{ text: "plain" }]]);
});

test("newlines inside a span split it into lines", () => {
  const lines = toSpanLines([{ text: "a\nb", fg: 3 }]);
  assert.deepEqual(lines, [[{ fg: 3, text: "a" }], [{ fg: 3, text: "b" }]]);
});

test("a blank line survives as a blank line", () => {
  assert.deepEqual(toSpanLines("a\n\nb").map(spanText), ["a", "", "b"]);
  assert.deepEqual(wrapRich("a\n\nb", 10).map(spanText), ["a", "", "b"]);
});

test("styles survive a wrap", () => {
  const line: SpanLine = [
    { text: "ERROR ", fg: 1, bold: true },
    { text: "connection refused by the upstream host" },
  ];
  const wrapped = wrapSpans(line, 16);
  assert.ok(wrapped.length > 1);
  const first = wrapped[0] as SpanLine;
  assert.equal(first[0]?.fg, 1);
  assert.equal(first[0]?.bold, true);
  // Every line's columns still fit.
  for (const l of wrapped) assert.ok(spanWidth(l) <= 16, spanText(l));
  // No text is lost or duplicated.
  assert.equal(
    wrapped.map(spanText).join(" ").replace(/\s+/g, " ").trim(),
    "ERROR connection refused by the upstream host",
  );
});

test("styles survive a truncation, and the ellipsis takes the cut span's style", () => {
  const line: SpanLine = [
    { text: "ok ", fg: 2 },
    { text: "then a long red tail", fg: 1 },
  ];
  const cut = truncateSpans(line, 10);
  assert.equal(spanWidth(cut), 10);
  assert.equal(cut[cut.length - 1]?.text, "…");
  assert.equal(cut[cut.length - 1]?.fg, 1, "ellipsis inherits the interrupted span");
});

test("truncating inside the first span keeps that span's style on the ellipsis", () => {
  const cut = truncateSpans([{ text: "aaaaaaaaaa", fg: 5 }, { text: "bbb", fg: 6 }], 4);
  assert.equal(spanText(cut), "aaa…");
  assert.equal(cut[cut.length - 1]?.fg, 5);
});

test("padding carries no style, so it picks up the widget's", () => {
  const padded = fitSpans([{ text: "hi", fg: 4, bg: 7 }], 6);
  const pad = padded[padded.length - 1];
  assert.equal(pad?.text, "    ");
  assert.equal(pad?.fg, undefined);
  assert.equal(pad?.bg, undefined);
});

test("spanStyle folds the boolean shorthands into attrs over a base", () => {
  assert.deepEqual(
    spanStyle({ text: "x", bold: true, underline: true }, { fg: 9, attrs: Attr.Dim }),
    { fg: 9, bg: undefined, attrs: Attr.Dim | Attr.Bold | Attr.Underline },
  );
  // An explicit span colour wins over the base.
  assert.equal(spanStyle({ text: "x", fg: 2 }, { fg: 9 }).fg, 2);
  // And an absent one inherits it.
  assert.equal(spanStyle({ text: "x" }, { fg: 9 }).fg, 9);
});

test("adjacent runs sharing a style are coalesced by wrapping", () => {
  const wrapped = wrapSpans([{ text: "a", fg: 1 }, { text: "b", fg: 1 }, { text: "c", fg: 2 }], 40);
  assert.deepEqual(wrapped, [[{ fg: 1, text: "ab" }, { fg: 2, text: "c" }]]);
});

test("empty spans are dropped rather than rendered", () => {
  assert.deepEqual(toSpanLines([{ text: "" }, { text: "x" }]), [[{ text: "x" }]]);
});

test("a zero or negative width yields nothing, as the string path does", () => {
  assert.deepEqual(wrapSpans(one("anything"), 0), []);
  assert.deepEqual(wrapSpans(one("anything"), 0), wrap("anything", 0).map(one));
  assert.deepEqual(truncateSpans(one("anything"), 0), []);
  assert.equal(spanText(truncateSpans(one("anything"), 0)), truncate("anything", 0));
});
