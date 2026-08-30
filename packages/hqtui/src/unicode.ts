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

/** Intern a multi-codepoint grapheme (emoji, combining sequence) into one cell value. */
export function internCluster(text: string): number {
  const existing = clusterIds.get(text);
  if (existing !== undefined) return existing;
  const id = CLUSTER_BASE + clusters.length;
  clusters.push(text);
  clusterIds.set(text, id);
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
  [0x2060, 0x2064], [0x20d0, 0x20f0], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f],
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
    let width = charWidth(cp);
    let cluster = "";
    // Absorb any trailing zero-width codepoints and ZWJ-joined parts.
    for (;;) {
      const next = text.codePointAt(i + size);
      if (next === undefined) break;
      const nsize = next > 0xffff ? 2 : 1;
      if (next === ZWJ) {
        const after = text.codePointAt(i + size + nsize);
        if (after === undefined) break;
        cluster = cluster || text.slice(i, i + size);
        cluster += text.slice(i + size, i + size + nsize + (after > 0xffff ? 2 : 1));
        size += nsize + (after > 0xffff ? 2 : 1);
        continue;
      }
      if (charWidth(next) !== 0) break;
      cluster = cluster || text.slice(i, i + size);
      cluster += text.slice(i + size, i + size + nsize);
      size += nsize;
    }
    if (cluster) {
      out.push({ value: internCluster(cluster), width: width === 0 ? 1 : width });
    } else if (width === 0) {
      // A lone combining mark with nothing to combine with; drop it.
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
