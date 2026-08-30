import { DEFAULT_COLOR, type Color } from "./color.ts";
import { CONTINUATION, cellWidth, graphemes, cellText } from "./unicode.ts";

/** Style attribute bits packed into the cell's 16-bit attribute slot. */
export const Attr = {
  None: 0,
  Bold: 1 << 0,
  Dim: 1 << 1,
  Italic: 1 << 2,
  Underline: 1 << 3,
  Blink: 1 << 4,
  Reverse: 1 << 5,
  Strike: 1 << 6,
} as const;

export type Attributes = number;

export interface Style {
  fg?: Color;
  bg?: Color;
  attrs?: Attributes;
}

/**
 * The screen is one grid of cells, not a tree of widgets. Four parallel typed
 * arrays keep a frame allocation-free: no object is created per cell, ever.
 */
export class FrameBuffer {
  width: number;
  height: number;
  chars: Uint32Array;
  fg: Uint32Array;
  bg: Uint32Array;
  attrs: Uint16Array;

  constructor(width: number, height: number) {
    this.width = Math.max(0, width | 0);
    this.height = Math.max(0, height | 0);
    const n = this.width * this.height;
    this.chars = new Uint32Array(n);
    this.fg = new Uint32Array(n);
    this.bg = new Uint32Array(n);
    this.attrs = new Uint16Array(n);
    this.clear();
  }

  /** Resize in place, reusing the existing allocation when it is large enough. */
  resize(width: number, height: number): void {
    const w = Math.max(0, width | 0);
    const h = Math.max(0, height | 0);
    if (w === this.width && h === this.height) return;
    const n = w * h;
    if (n > this.chars.length) {
      this.chars = new Uint32Array(n);
      this.fg = new Uint32Array(n);
      this.bg = new Uint32Array(n);
      this.attrs = new Uint16Array(n);
    }
    this.width = w;
    this.height = h;
    this.clear();
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  clear(fill: Color = DEFAULT_COLOR, fg: Color = DEFAULT_COLOR): void {
    const n = this.width * this.height;
    this.chars.fill(32, 0, n);
    this.fg.fill(fg, 0, n);
    this.bg.fill(fill, 0, n);
    this.attrs.fill(0, 0, n);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Write one already-decoded cell value. Returns columns consumed. */
  setCell(x: number, y: number, value: number, style?: Style): number {
    if (!this.inBounds(x, y)) return 0;
    const w = cellWidth(value);
    const i = this.index(x, y);
    // Overwriting the tail of a wide char to our left would orphan it; blank it.
    if (this.chars[i] === CONTINUATION && x > 0) this.chars[i - 1] = 32;
    this.chars[i] = value;
    if (style) {
      if (style.fg !== undefined) this.fg[i] = style.fg;
      if (style.bg !== undefined) this.bg[i] = style.bg;
      if (style.attrs !== undefined) this.attrs[i] = style.attrs;
    }
    if (w === 2) {
      if (x + 1 < this.width) {
        const j = i + 1;
        this.chars[j] = CONTINUATION;
        if (style) {
          if (style.fg !== undefined) this.fg[j] = style.fg;
          if (style.bg !== undefined) this.bg[j] = style.bg;
          if (style.attrs !== undefined) this.attrs[j] = style.attrs;
        }
      } else {
        // No room for the second half: draw a space rather than corrupt the row.
        this.chars[i] = 32;
        return 1;
      }
    }
    return Math.max(1, w);
  }

  /** Write text left to right. Returns the number of columns written. */
  write(x: number, y: number, text: string, style?: Style, maxWidth = Infinity): number {
    if (y < 0 || y >= this.height) return 0;
    let cx = x;
    let used = 0;
    for (const g of graphemes(text)) {
      if (used + g.width > maxWidth) break;
      if (cx >= this.width) break;
      if (cx + g.width > this.width) break;
      if (cx >= 0) {
        this.setCell(cx, y, g.value, style);
      }
      cx += g.width;
      used += g.width;
    }
    return used;
  }

  fillRect(x: number, y: number, w: number, h: number, ch = 32, style?: Style): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) this.setCell(cx, cy, ch, style);
    }
  }

  /** Restyle a region without touching its characters. */
  styleRect(x: number, y: number, w: number, h: number, style: Style): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        const i = this.index(cx, cy);
        if (style.fg !== undefined) this.fg[i] = style.fg;
        if (style.bg !== undefined) this.bg[i] = style.bg;
        if (style.attrs !== undefined) this.attrs[i] = style.attrs;
      }
    }
  }

  /** Copy another buffer's contents into this one (same dimensions assumed). */
  copyFrom(other: FrameBuffer): void {
    const n = Math.min(this.width * this.height, other.width * other.height);
    this.chars.set(other.chars.subarray(0, n));
    this.fg.set(other.fg.subarray(0, n));
    this.bg.set(other.bg.subarray(0, n));
    this.attrs.set(other.attrs.subarray(0, n));
  }

  /** Plain text of one row, for tests and headless rendering. */
  rowText(y: number): string {
    if (y < 0 || y >= this.height) return "";
    let out = "";
    for (let x = 0; x < this.width; x++) {
      const v = this.chars[this.index(x, y)];
      if (v === CONTINUATION) continue;
      out += v === 0 ? " " : cellText(v);
    }
    return out;
  }

  /** Whole buffer as plain text. */
  toText(trimEnd = true): string {
    const rows: string[] = [];
    for (let y = 0; y < this.height; y++) {
      const r = this.rowText(y);
      rows.push(trimEnd ? r.replace(/\s+$/, "") : r);
    }
    return rows.join("\n");
  }
}
