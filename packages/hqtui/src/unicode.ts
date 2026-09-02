/**
 * Terminal text is a grid of columns, not a string. Getting width wrong corrupts
 * every cell to the right of the mistake, so width lives behind this one module.
 */

/** Values at or above this are indices into the cluster table, not codepoints. */
export const CLUSTER_BASE = 0x110000;
/** Written into the cell after a double-width character. Never drawn. */
export const CONTINUATION = 0xffffffff;

const clusters: string[] = [];
const clusterIds = new Map<string, number>();

/**
 * C0, DEL and C1. A cell holding one of these would be written straight back
 * out by the encoder, so untrusted text could steer the terminal instead of
 * filling a cell — the one thing SECURITY.md promises cannot happen.
 */
export function isControl(cp: number): boolean {
  return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
}

/**
 * Bidi overrides, embeddings and isolates: the Trojan Source set (CVE-2021-42574).
 * They emit no glyph but reorder everything around them, so `user<RLO>nimda`
 * reads as `user admin` in a log pane. Directional *marks* (LRM/RLM) and real
 * RTL script are left alone — those render honestly.
 */
export function isBidiControl(cp: number): boolean {
  return (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

/**
 * An unpaired surrogate. It is not a character, and — critically — two of them
 * fuse into one astral codepoint when the encoder concatenates cell text. Two
 * cells would then claim two columns and paint one, walking the cursor out of
 * step with the screen for the rest of the row.
 */
export function isLoneSurrogate(cp: number): boolean {
  return cp >= 0xd800 && cp <= 0xdfff;
}

/** What an unpaired surrogate is shown as: one column, and it cannot fuse. */
export const REPLACEMENT = 0xfffd;

/**
 * Anything that must never occupy a cell: it steers rather than draws.
 *
 * This runs per cell on the write path and per codepoint on the measure path,
 * so it is written as one small branch ladder rather than two calls. Printable
 * ASCII — overwhelmingly the common case — exits on the second comparison.
 */
export function isUnsafeCodepoint(cp: number): boolean {
  if (cp < 0x20) return true;
  if (cp < 0x7f) return false;
  if (cp <= 0x9f) return true;
  if (cp < 0x202a || cp > 0x2069) return false;
  return cp <= 0x202e || cp >= 0x2066;
}

// eslint-disable-next-line no-control-regex -- matching controls is the point
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

/** Strip everything that steers the terminal rather than drawing. */
export function stripUnsafe(text: string): string {
  return text.replace(UNSAFE, "");
}

/**
 * A cell may hold at most this many codepoints. Real ZWJ emoji top out around
 * ten; anything longer is a byte-amplification bomb, because the cell still
 * claims one column while painting hundreds.
 */
const MAX_CLUSTER_CODEPOINTS = 16;

/**
 * Distinct clusters are interned for the life of the process — a cell holds an
 * index into this table, so entries can never be evicted while a framebuffer
 * might still reference them. Untrusted text must therefore not be able to grow
 * it without bound.
 *
 * Past this many, `internCluster` degrades to the base codepoint: the combining
 * marks or emoji joins are dropped, but the cell keeps the correct width, so the
 * grid stays in step with the screen. The cap is set far above any real UI —
 * 32768 distinct clusters is more than a multilingual dashboard will ever show —
 * so reaching it means someone is trying to, and the cost is bounded at a few MB.
 */
const MAX_CLUSTERS = 32768;

/**
 * Intern a multi-codepoint grapheme (emoji, combining sequence) into one cell
 * value. Unsafe codepoints are stripped here as well as in `graphemes`, so no
 * caller — including one outside this module — can smuggle one into a cell.
 */
export function internCluster(text: string): number {
  // A cell always occupies its column, so a cluster is never empty. Unpaired
  // surrogates become U+FFFD here too, so a cluster can never end in a half
  // that would fuse with whatever the next cell begins with.
  const safe = stripUnsafe(text).replace(/[\ud800-\udfff]/gu, "\ufffd") || " ";
  const existing = clusterIds.get(safe);
  if (existing !== undefined) return existing;
  if (clusters.length >= MAX_CLUSTERS) {
    // Degrade to the base character rather than grow the table for ever.
    const first = safe.codePointAt(0) ?? 32;
    return charWidth(first) > 0 ? first : 32;
  }
  const id = CLUSTER_BASE + clusters.length;
  clusters.push(safe);
  clusterIds.set(safe, id);
  return id;
}

export function clusterText(value: number): string {
  return clusters[value - CLUSTER_BASE] ?? " ";
}

/** Render a cell value back to the text the terminal should receive. */
export function cellText(value: number): string {
  if (value >= CLUSTER_BASE && value !== CONTINUATION) return clusterText(value);
  if (value === 0 || value === CONTINUATION) return " ";
  return String.fromCodePoint(value);
}

type Range = [number, number];

// Zero-width: combining marks, variation selectors, ZWJ, most format controls.
const ZERO_WIDTH: Range[] = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a],
  [0x064b, 0x065f], [0x0670, 0x0670], [0x06d6, 0x06dc], [0x0730, 0x074a],
  [0x07a6, 0x07b0], [0x0816, 0x0819], [0x08e3, 0x0903], [0x093a, 0x093c],
  [0x0951, 0x0957], [0x0e31, 0x0e31], [0x0e34, 0x0e3a], [0x0eb1, 0x0eb1],
  [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x2028, 0x202e],
  [0x2060, 0x2064], [0x2066, 0x2069], [0x20d0, 0x20f0], [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xfeff, 0xfeff], [0xe0100, 0xe01ef],
];

// Double-width: East Asian Wide/Fullwidth plus the emoji blocks terminals widen.
const WIDE: Range[] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a], [0x1f200, 0x1f320], [0x1f32d, 0x1f335], [0x1f337, 0x1f37c],
  [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3], [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440], [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567], [0x1f57a, 0x1f57a],
  [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4], [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2], [0x1f6eb, 0x1f6ec], [0x1f910, 0x1f9ff],
  [0x20000, 0x2fffd], [0x30000, 0x3fffd],
];

// Extended_Pictographic, approximated to the ranges terminals actually join.
// ZWJ only glues emoji together; joining it to arbitrary text is how one cell
// ends up painting hundreds of columns.
const PICTOGRAPHIC: Range[] = [
  [0x00a9, 0x00a9], [0x00ae, 0x00ae], [0x203c, 0x203c], [0x2049, 0x2049],
  [0x2122, 0x2122], [0x2139, 0x2139], [0x2194, 0x21aa], [0x231a, 0x23fa],
  [0x24c2, 0x24c2], [0x25aa, 0x25fe], [0x2600, 0x27bf], [0x2934, 0x2935],
  [0x2b00, 0x2bff], [0x3030, 0x3030], [0x303d, 0x303d], [0x3297, 0x3299],
  [0x1f000, 0x1faff], [0x1fc00, 0x1fffd],
];

function inRanges(cp: number, ranges: Range[]): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Columns a single codepoint occupies: 0, 1, or 2. */
export function charWidth(cp: number): 0 | 1 | 2 {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp < 0x300) return 1;
  if (inRanges(cp, ZERO_WIDTH)) return 0;
  if (inRanges(cp, WIDE)) return 2;
  return 1;
}

/** Columns a cell value occupies (handles interned clusters). */
export function cellWidth(value: number): 0 | 1 | 2 {
  if (value === CONTINUATION) return 0;
  if (value >= CLUSTER_BASE) {
    const t = clusterText(value);
    const first = t.codePointAt(0) ?? 32;
    return charWidth(first) === 2 ? 2 : 1;
  }
  return charWidth(value);
}

const ZWJ = 0x200d;

export interface Grapheme {
  /** Cell value: a bare codepoint, or an interned cluster id. */
  value: number;
  width: 0 | 1 | 2;
}

/**
 * Split text into terminal cells. Combining marks, variation selectors and
 * ZWJ sequences attach to the base character instead of stealing a column.
 */
export function graphemes(text: string): Grapheme[] {
  const out: Grapheme[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) as number;
    let size = cp > 0xffff ? 2 : 1;
    // `codePointAt` only yields a surrogate value when it is unpaired. Show it
    // rather than dropping it: dropping would make its neighbours adjacent, and
    // two lone halves side by side fuse into one glyph spanning two cells.
    if (isLoneSurrogate(cp)) {
      out.push({ value: REPLACEMENT, width: 1 });
      i += 1;
      continue;
    }
    // An unsafe codepoint never reaches a cell: it would otherwise be absorbed
    // into the previous grapheme exactly like a combining mark and re-emitted
    // verbatim — escape injection. Every unsafe codepoint is zero-width, so
    // testing the width first means printable text never pays for this check.
    let width = charWidth(cp);
    if (width === 0 && isUnsafeCodepoint(cp)) {
      i += size;
      continue;
    }
    let cluster = "";
    // A cell paints one column but may hold several codepoints; cap how many,
    // so no input makes a single cell emit an unbounded run of glyphs.
    let parts = 1;
    // Absorb any trailing zero-width codepoints and ZWJ-joined parts.
    for (;;) {
      if (parts >= MAX_CLUSTER_CODEPOINTS) break;
      const next = text.codePointAt(i + size);
      if (next === undefined) break;
      const nsize = next > 0xffff ? 2 : 1;
      if (next === ZWJ) {
        const after = text.codePointAt(i + size + nsize);
        if (after === undefined) break;
        // ZWJ joins emoji, and nothing else. Joining it to arbitrary text lets
        // one cell claim a single column while painting hundreds of them.
        if (!inRanges(cp, PICTOGRAPHIC) || !inRanges(after, PICTOGRAPHIC)) break;
        cluster = cluster || text.slice(i, i + size);
        cluster += text.slice(i + size, i + size + nsize + (after > 0xffff ? 2 : 1));
        size += nsize + (after > 0xffff ? 2 : 1);
        parts += 2;
        continue;
      }
      if (charWidth(next) !== 0) break;
      // Leave anything unsafe to the outer loop, which drops it. Only zero-width
      // codepoints reach here, so this costs nothing on ordinary text.
      if (isUnsafeCodepoint(next)) break;
      cluster = cluster || text.slice(i, i + size);
      cluster += text.slice(i + size, i + size + nsize);
      size += nsize;
      parts += 1;
    }
    if (width === 0) {
      // A zero-width base: a combining mark with nothing to combine with, or a
      // stray ZWJ. It paints no column, so handing it one would walk the cursor
      // ahead of the screen. Drop it, along with anything it absorbed.
    } else if (cluster) {
      out.push({ value: internCluster(cluster), width });
    } else {
      out.push({ value: cp, width });
    }
    i += size;
  }
  return out;
}

/** Display width of a string in terminal columns. */
export function stringWidth(text: string): number {
  let w = 0;
  for (const g of graphemes(text)) w += g.width;
  return w;
}

/** Truncate to `max` columns, appending `ellipsis` when it does not fit. */
export function truncate(text: string, max: number, ellipsis = "…"): string {
  if (max <= 0) return "";
  if (stringWidth(text) <= max) return text;
  const ew = stringWidth(ellipsis);
  const limit = Math.max(0, max - ew);
  let out = "";
  let w = 0;
  for (const g of graphemes(text)) {
    if (w + g.width > limit) break;
    out += cellText(g.value);
    w += g.width;
  }
  return out + ellipsis;
}

/** Pad or truncate to exactly `width` columns. */
export function fit(text: string, width: number, align: "left" | "right" | "center" = "left"): string {
  const t = truncate(text, width);
  const pad = width - stringWidth(t);
  if (pad <= 0) return t;
  if (align === "right") return " ".repeat(pad) + t;
  if (align === "center") {
    const l = Math.floor(pad / 2);
    return " ".repeat(l) + t + " ".repeat(pad - l);
  }
  return t + " ".repeat(pad);
}

/** Greedy word wrap at `width` columns. */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    let lineW = 0;
    for (const word of paragraph.split(/(\s+)/)) {
      if (word === "") continue;
      const w = stringWidth(word);
      if (lineW + w > width && lineW > 0) {
        lines.push(line.trimEnd());
        line = "";
        lineW = 0;
        if (/^\s+$/.test(word)) continue;
      }
      if (w > width) {
        // A single word longer than the line: hard-split it.
        for (const g of graphemes(word)) {
          if (lineW + g.width > width) {
            lines.push(line);
            line = "";
            lineW = 0;
          }
          line += cellText(g.value);
          lineW += g.width;
        }
        continue;
      }
      line += word;
      lineW += w;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
