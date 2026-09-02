import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameBuffer } from "../src/buffer.ts";
import { encodeFull } from "../src/diff.ts";
import {
  graphemes, internCluster, clusterText, cellText, isControl, isBidiControl,
  isUnsafeCodepoint, charWidth, stringWidth, cellWidth,
} from "../src/unicode.ts";
import { setTitle, stripAnsi } from "../src/ansi.ts";
import { renderToAnsi, renderToText, renderToHtml } from "../src/testing.ts";

/**
 * SECURITY.md promises that untrusted text passed to a widget is "measured and
 * clipped, never re-emitted as control sequences". These tests are that promise.
 *
 * Control characters are zero-width, so before this was fixed they were absorbed
 * into the preceding grapheme exactly like a combining mark and written straight
 * back out — an attacker who could get a byte into a log line, a process name or
 * an SSH username could drive the operator's terminal.
 */

const C = (n: number) => String.fromCharCode(n);
const ESC = C(0x1b);
const BEL = C(0x07);

/** Every C0 control, DEL, and every C1 control. */
const ALL_CONTROLS = [
  ...Array.from({ length: 0x20 }, (_, i) => i),
  0x7f,
  ...Array.from({ length: 0x20 }, (_, i) => 0x80 + i),
];

/** Anything the terminal would read as a command rather than a glyph. */
function hasControl(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true;
  }
  return false;
}

/** The escapes the encoder is itself entitled to emit: SGR and cursor moves. */
function encoderEscapes(output: string): string {
  return output.replace(new RegExp(ESC + "\\[[0-9;]*[A-Za-z]", "g"), "").replace(/\r/g, "");
}

test("no control character survives into a cell", () => {
  for (const cp of ALL_CONTROLS) {
    // After a printable, so it is offered to the cluster-absorption path.
    const buffer = new FrameBuffer(8, 1);
    buffer.write(0, 0, "a" + C(cp) + "b");
    assert.equal(hasControl(buffer.rowText(0)), false, `cell held control 0x${cp.toString(16)}`);
  }
});

test("a control character is dropped, not absorbed into its neighbour", () => {
  // "a" then ESC then "b" is two cells, and the ESC is gone from both.
  const cells = graphemes("a" + ESC + "b");
  assert.equal(cells.length, 2);
  assert.equal(hasControl(cells.map((c) => clusterText(c.value)).join("")), false);
});

test("controls never reach stdout through the encoder", () => {
  for (const cp of ALL_CONTROLS) {
    const buffer = new FrameBuffer(8, 1);
    buffer.write(0, 0, "a" + C(cp) + "b");
    const residue = encoderEscapes(encodeFull(buffer, { colors: "truecolor" }));
    assert.equal(hasControl(residue), false, `encoder emitted control 0x${cp.toString(16)}`);
  }
});

test("a hostile log line cannot inject an escape sequence", () => {
  // What an attacker controls: an SSH username, an HTTP path, a process name.
  const hostile = "root" + ESC + "]0;OWNED" + BEL + ESC + "[5;41;97m HACKED " + ESC + "[0m";
  const out = renderToAnsi(({ ui }) => ui.text("Failed password for " + hostile), {
    width: 78,
    height: 1,
    capabilities: { colors: "truecolor" },
  });
  assert.equal(hasControl(encoderEscapes(out)), false);
  // The payload is still shown, as inert literal text.
  assert.match(renderToText(({ ui }) => ui.text(hostile), { width: 78, height: 1 }), /OWNED/);
});

test("a control cannot ride in on a ZWJ sequence or a combining mark", () => {
  const zwj = "a" + C(0x200d) + ESC + "b";
  const combining = "a" + C(0x0301) + ESC;
  for (const payload of [zwj, combining]) {
    const buffer = new FrameBuffer(8, 1);
    buffer.write(0, 0, payload);
    assert.equal(hasControl(buffer.rowText(0)), false);
  }
});

test("the escape hatch cannot write a control either", () => {
  // setCell takes a raw cell value, bypassing grapheme segmentation entirely.
  for (const cp of ALL_CONTROLS) {
    const buffer = new FrameBuffer(4, 1);
    buffer.setCell(0, 0, cp);
    assert.equal(hasControl(buffer.rowText(0)), false, `setCell stored 0x${cp.toString(16)}`);
  }
});

test("interning a cluster strips controls and never yields an empty cell", () => {
  assert.equal(hasControl(clusterText(internCluster("a" + ESC))), false);
  // A cluster of nothing but controls must still occupy its column.
  assert.equal(clusterText(internCluster(ESC + BEL)), " ");
});

/**
 * Everything below was found by red-teaming the fix above. Each one got a live
 * escape, a reordered line, or an unbounded paint past the first round of guards.
 */

test("setCell validates what the Uint32Array will really store", () => {
  // `chars` is a Uint32Array, so it applies ToUint32. 2**32 + 0x1b is not a
  // control by value, but truncates to one on the way into the grid.
  for (const poison of [2 ** 32 + 0x1b, 2 ** 33 + 0x1b, -1, 2 ** 32 - 1]) {
    const buffer = new FrameBuffer(4, 1);
    buffer.setCell(0, 0, poison);
    assert.equal(hasControl(buffer.rowText(0)), false, `stored ${poison}`);
    assert.equal(buffer.rowText(0).length, 4, `row lost a column for ${poison}`);
  }
  // Same via an object that only becomes dangerous once coerced.
  const buffer = new FrameBuffer(4, 1);
  buffer.setCell(0, 0, { valueOf: () => 2 ** 32 + 0x1b } as unknown as number);
  assert.equal(hasControl(buffer.rowText(0)), false);
});

test("bidi overrides cannot reorder what the operator reads", () => {
  // Trojan Source: "user<RLO>nimda" displays as "user admin".
  const RLO = C(0x202e);
  const hostile = "login: user" + RLO + "nimda";
  const buffer = new FrameBuffer(30, 1);
  buffer.write(0, 0, hostile);
  assert.equal(buffer.rowText(0).includes(RLO), false);
  assert.equal(encodeFull(buffer, { colors: "none" }).includes(RLO), false);
  for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
    assert.equal(isBidiControl(cp), true, `0x${cp.toString(16)}`);
    const b = new FrameBuffer(8, 1);
    b.write(0, 0, "a" + String.fromCodePoint(cp) + "b");
    assert.equal(b.rowText(0).includes(String.fromCodePoint(cp)), false);
  }
  // Real RTL script and the directional marks still render.
  assert.equal(isBidiControl(0x200e), false);
  assert.ok(stringWidth("\u05d0\u05d1") > 0);
});

test("one cell can never paint an unbounded number of columns", () => {
  // ZWJ joins emoji and nothing else; joining it to CJK made a single cell
  // claim one column while painting hundreds.
  const ZWJ = C(0x200d);
  const bomb = "a" + Array.from({ length: 400 }, () => ZWJ + "\u4e2d").join("");
  const cells = graphemes(bomb);
  assert.equal(cells.length, 401, "ZWJ still gluing arbitrary text into one cell");
  assert.equal(stringWidth(bomb), 801);
  // Declared width and painted width must agree, or the row desynchronises.
  for (const cell of cells) {
    assert.ok(clusterText(cell.value).length <= 16 || cell.value < 0x110000);
  }
  // A real emoji ZWJ sequence is still one cell.
  assert.equal(graphemes("\u{1f469}\u200d\u{1f4bb}").length, 1);
  assert.equal(graphemes("\u{1f468}\u200d\u{1f469}\u200d\u{1f467}").length, 1);
});

test("a cluster holds a bounded number of codepoints", () => {
  // Zalgo: thousands of combining marks on one base is byte amplification.
  const zalgo = "a" + C(0x0301).repeat(5000);
  const cells = graphemes(zalgo);
  assert.ok(clusterText(cells[0].value).length <= 17, "cluster was not capped");
  assert.equal(cellWidth(cells[0].value), 1);
});

test("the intern table cannot be grown without bound", () => {
  // Every distinct cluster used to be interned for ever, so untrusted text
  // could grow the heap indefinitely. The cap is deliberately far above any
  // real UI, so only a deliberate attempt reaches it.
  const before = internCluster("\u{1f469}\u200d\u{1f4bb}");
  for (let i = 0; i < 40000; i++) internCluster("x" + C(0x0301) + String.fromCodePoint(0x4e00 + i));
  const after = internCluster("\u{1f469}\u200d\u{1f4bb}");
  assert.equal(before, after, "existing clusters must stay valid");

  // Past the cap a new cluster degrades to its base character. That loses the
  // combining marks, but it must never lose the *column*: a cell that lies
  // about its width desynchronises the cursor from the screen, which is the
  // corruption this whole file exists to prevent.
  const overflow = internCluster("z" + C(0x0301) + C(0x0302));
  assert.equal(hasControl(cellText(overflow)), false);
  assert.equal(cellText(overflow), "z", "degrades to the base character");
  assert.equal(cellWidth(overflow), 1, "and keeps its width");
  const wide = internCluster("\u4e2d" + C(0x0301));
  assert.equal(cellWidth(wide), 2, "a wide base still reports two columns");
});

test("ZWJ outside emoji is dropped — a deliberate trade-off", () => {
  // ZWJ legitimately requests conjunct forms in Devanagari, Sinhala and Arabic.
  // Honouring it would mean letting a cell hold arbitrary joined text, which is
  // exactly the primitive that let one cell paint hundreds of columns. The old
  // behaviour was not correct either: it packed the whole run into a cell that
  // claimed a single column. Each codepoint now gets its own cell instead, so
  // the grid stays in step even though the conjunct ligature is lost.
  const ZWJ = C(0x200d);
  const devanagari = "\u0915\u094d" + ZWJ + "\u0937";
  const cells = graphemes(devanagari);
  assert.equal(cells.length, 3);
  assert.equal(stringWidth(devanagari), 3, "declared width matches the cells drawn");
  assert.equal(cells.map((c) => cellText(c.value)).join("").includes(ZWJ), false);
  // Emoji, which is what ZWJ is for in a terminal, is untouched.
  assert.equal(graphemes("\u{1f469}\u200d\u{1f4bb}").length, 1);
});

test("setTitle cannot be escaped by C1 or DEL", () => {
  // The title is interpolated into an OSC sequence. 8-bit ST/CSI would end it.
  const title = setTitle("session " + C(0x9c) + C(0x9b) + "31m" + C(0x7f) + ESC + "]0;evil");
  assert.equal(hasControl(title.slice(5, -1)), false);
});

test("stripAnsi leaves nothing that can steer a terminal", () => {
  const cases = [
    C(0x9b) + "31mRED",              // 8-bit CSI
    ESC + "[0 qHELLO",               // CSI with an intermediate byte
    ESC + "]0;title" + BEL + "X",    // OSC
    ESC + "P q" + ESC + "\\Y",        // DCS
    ESC + "[X",
  ];
  for (const input of cases) {
    assert.equal(hasControl(stripAnsi(input)), false, JSON.stringify(input));
  }
  assert.equal(stripAnsi("plain"), "plain");
});

test("stripAnsi keeps tab, newline and carriage return", () => {
  // It sanitises text, not cells. Multi-line callers depend on these.
  assert.equal(stripAnsi("line1\nline2"), "line1\nline2");
  assert.equal(stripAnsi("col1\tcol2"), "col1\tcol2");
  assert.equal(stripAnsi("a\r\nb"), "a\r\nb");
  // But the cursor-moving whitespace controls still go.
  assert.equal(hasControl(stripAnsi("a" + C(0x0b) + C(0x0c) + "b")), false);
});

test("renderToHtml escapes attribute values, not just cell text", () => {
  const html = renderToHtml(({ ui }) => ui.text("hi"), {
    width: 8,
    height: 1,
    className: 'x" onload="alert(1)',
    fontFamily: 'y;}</style><script>alert(2)</script>',
  } as Parameters<typeof renderToHtml>[1]);
  assert.equal(/onload="alert\(1\)"/.test(html), false);
  assert.equal(html.includes("<script>"), false);

  // Every interpolated option, not just the two that are obviously strings.
  const hostile = renderToHtml(({ ui }) => ui.text("hi"), {
    width: 6,
    height: 1,
    padding: '0px"><script>alert(1)</script><pre y="',
    fontSize: "14px;}</style>",
    // Escaping alone is not enough here: `;` opens a new CSS property.
    fontFamily: "monospace;position:fixed;width:100vw;background:url(https://evil.example/x)",
  } as unknown as Parameters<typeof renderToHtml>[1]);
  assert.equal(hostile.includes("<script>"), false);
  assert.equal(hostile.includes("</style>"), false);
  // The font stack is reduced to characters a font stack can contain, so no
  // new CSS property or URL can be opened from inside it.
  const stack = /font-family:([^;]*)/.exec(hostile)?.[1] ?? "";
  assert.equal(/[;:()/\\{}<>"]/.test(stack), false, `font stack kept syntax: ${stack}`);
  assert.equal(/position:fixed/.test(hostile), false);
  assert.equal(/url\(/.test(hostile), false);
  // A non-numeric size falls back rather than emitting NaN or breaking out.
  assert.match(hostile, /padding:16px/);
  assert.match(hostile, /font-size:14px/);
});

test("dropping a codepoint cannot fuse its neighbours", () => {
  // Two unpaired surrogates either side of a dropped control used to end up
  // adjacent, and `parts.join("")` fused them into one astral glyph: two cells
  // claiming two columns painted one, and the row desynchronised from there on.
  const HI = C(0xd800), LO = C(0xdc00);
  for (const separator of [C(0x00), ESC, C(0x202e)]) {
    const buffer = new FrameBuffer(10, 1);
    buffer.write(0, 0, HI + separator + LO);
    assert.equal([...buffer.rowText(0)].length, 10, `fused across ${separator.codePointAt(0)}`);
  }
  // And with no separator at all.
  const buffer = new FrameBuffer(30, 1);
  buffer.write(0, 0, (HI + LO).repeat(5) + "|END");
  assert.equal([...buffer.rowText(0)].length, 30);
  // A real surrogate pair is still one astral character, not two replacements.
  assert.equal(graphemes("\u{1f600}").length, 1);
  assert.equal(stringWidth("\u{1f600}"), 2);
  // setCell takes raw values, so it has to refuse a bare half too.
  const raw = new FrameBuffer(4, 1);
  raw.setCell(0, 0, 0xd800);
  raw.setCell(1, 0, 0xdc00);
  assert.equal([...raw.rowText(0)].length, 4);
});

test("every unsafe codepoint is zero-width", () => {
  // `graphemes` tests the width first and only then asks whether the codepoint
  // is safe, so printable text never pays for the check. That reordering is
  // only sound while this holds — across the whole of Unicode.
  let violations = 0;
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (isUnsafeCodepoint(cp) && charWidth(cp) !== 0) violations++;
  }
  assert.equal(violations, 0, "an unsafe codepoint with a width would slip past graphemes()");
});

test("isControl covers C0, DEL and C1 exactly", () => {
  for (const cp of ALL_CONTROLS) assert.equal(isControl(cp), true, `0x${cp.toString(16)}`);
  for (const cp of [0x20, 0x41, 0x7e, 0xa0, 0x300, 0x4e00, 0x1f600]) {
    assert.equal(isControl(cp), false, `0x${cp.toString(16)}`);
  }
});
