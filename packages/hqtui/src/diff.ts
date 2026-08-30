import type { FrameBuffer } from "./buffer.ts";
import { Attr } from "./buffer.ts";
import type { Capabilities } from "./capabilities.ts";
import { DEFAULT_COLOR, type Color, blue, green, grayscale, red, to16, to256 } from "./color.ts";
import {
  CSI, bg16, bg256, bgDefault, bgTrue, fg16, fg256, fgDefault, fgTrue, moveTo, moveToColumn, moveRight,
} from "./ansi.ts";
import { CONTINUATION, cellText, cellWidth } from "./unicode.ts";

/**
 * Rewriting up to this many unchanged cells is cheaper than the escape sequence
 * needed to jump over them, so neighbouring dirty spans get merged.
 */
const GAP_MERGE = 5;

interface TerminalState {
  x: number;
  y: number;
  /** False after anything that makes the cursor position unknowable. */
  known: boolean;
  fg: Color;
  bg: Color;
  attrs: number;
}

export interface EncodeResult {
  /** The bytes to hand to stdout. */
  output: string;
  changedCells: number;
  /** Rows that contained at least one change. */
  dirtyRows: number;
}

export interface EncoderOptions {
  colors?: Capabilities["colors"];
  /** Drain all color, keeping attributes. */
  monochrome?: boolean;
}

/**
 * Turns two framebuffers into the smallest practical stream of escape sequences.
 * It keeps a model of the terminal's current pen so no redundant SGR is emitted.
 */
export class Encoder {
  private state: TerminalState = { x: -1, y: -1, known: false, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, attrs: 0 };
  private parts: string[] = [];
  colors: Capabilities["colors"];
  monochrome: boolean;

  constructor(options: EncoderOptions = {}) {
    this.colors = options.colors ?? "truecolor";
    this.monochrome = options.monochrome ?? false;
  }

  /** Forget what we believe about the terminal; the next write re-states everything. */
  invalidateState(): void {
    this.state = { x: -1, y: -1, known: false, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, attrs: 0 };
    this.parts.push(`${CSI}0m`);
  }

  private fgSeq(c: Color): string {
    if (this.colors === "none") return "";
    if (c === DEFAULT_COLOR) return fgDefault;
    const col = this.monochrome ? grayscale(c) : c;
    if (this.colors === "truecolor") return fgTrue(red(col), green(col), blue(col));
    if (this.colors === "ansi256") return fg256(to256(col));
    return fg16(to16(col));
  }

  private bgSeq(c: Color): string {
    if (this.colors === "none") return "";
    if (c === DEFAULT_COLOR) return bgDefault;
    const col = this.monochrome ? grayscale(c) : c;
    if (this.colors === "truecolor") return bgTrue(red(col), green(col), blue(col));
    if (this.colors === "ansi256") return bg256(to256(col));
    return bg16(to16(col));
  }

  private applyStyle(fg: Color, bg: Color, attrs: number): void {
    const s = this.state;
    if (s.fg === fg && s.bg === bg && s.attrs === attrs) return;

    // Attributes can only be added cheaply; removing one means a full reset.
    const removed = s.attrs & ~attrs;
    if (removed !== 0) {
      this.parts.push(`${CSI}0m`);
      s.attrs = 0;
      s.fg = DEFAULT_COLOR;
      s.bg = DEFAULT_COLOR;
    }

    const added = attrs & ~s.attrs;
    if (added !== 0) {
      const codes: number[] = [];
      if (added & Attr.Bold) codes.push(1);
      if (added & Attr.Dim) codes.push(2);
      if (added & Attr.Italic) codes.push(3);
      if (added & Attr.Underline) codes.push(4);
      if (added & Attr.Blink) codes.push(5);
      if (added & Attr.Reverse) codes.push(7);
      if (added & Attr.Strike) codes.push(9);
      if (codes.length) this.parts.push(`${CSI}${codes.join(";")}m`);
      s.attrs = attrs;
    }

    if (s.fg !== fg) {
      this.parts.push(this.fgSeq(fg));
      s.fg = fg;
    }
    if (s.bg !== bg) {
      this.parts.push(this.bgSeq(bg));
      s.bg = bg;
    }
  }

  private moveCursor(x: number, y: number): void {
    const s = this.state;
    if (s.known && s.y === y) {
      if (s.x === x) return;
      if (x > s.x && x - s.x <= 3) {
        // Short hop: cheaper than a full CUP, and never repaints cells.
        this.parts.push(moveRight(x - s.x));
      } else if (x === 0) {
        this.parts.push("\r");
      } else {
        this.parts.push(moveToColumn(x));
      }
    } else {
      this.parts.push(moveTo(x, y));
    }
    s.x = x;
    s.y = y;
    s.known = true;
  }

  /**
   * Encode the difference between `prev` and `next`.
   * Pass `full` to repaint every cell (first frame, resize, or after a redraw request).
   */
  encode(prev: FrameBuffer, next: FrameBuffer, full = false): EncodeResult {
    this.parts.length = 0;
    let changed = 0;
    let dirtyRows = 0;

    const w = next.width;
    const h = next.height;
    const sameSize = prev.width === w && prev.height === h;
    const repaint = full || !sameSize;
    if (repaint) this.invalidateState();

    const nc = next.chars;
    const nf = next.fg;
    const nb = next.bg;
    const na = next.attrs;
    const pc = prev.chars;
    const pf = prev.fg;
    const pb = prev.bg;
    const pa = prev.attrs;

    for (let y = 0; y < h; y++) {
      const rowStart = y * w;
      let x = 0;
      let rowDirty = false;

      while (x < w) {
        const i = rowStart + x;
        const dirty =
          repaint || nc[i] !== pc[i] || nf[i] !== pf[i] || nb[i] !== pb[i] || na[i] !== pa[i];
        if (!dirty) {
          x++;
          continue;
        }

        // Walk left onto the lead cell if we landed on a wide char's tail.
        let start = x;
        while (start > 0 && nc[rowStart + start] === CONTINUATION) start--;

        // Extend the run while cells are dirty, tolerating short clean gaps.
        let end = start;
        let clean = 0;
        let probe = start;
        while (probe < w) {
          const j = rowStart + probe;
          const d = repaint || nc[j] !== pc[j] || nf[j] !== pf[j] || nb[j] !== pb[j] || na[j] !== pa[j];
          if (d) {
            end = probe;
            clean = 0;
          } else {
            clean++;
            if (clean > GAP_MERGE) break;
          }
          probe++;
        }

        this.moveCursor(start, y);
        for (let cx = start; cx <= end; cx++) {
          const j = rowStart + cx;
          const value = nc[j];
          if (value === CONTINUATION) continue; // emitted with its lead cell
          this.applyStyle(nf[j], nb[j], na[j]);
          this.parts.push(value === 0 ? " " : cellText(value));
          const cw = Math.max(1, cellWidth(value));
          this.state.x += cw;
          if (nc[j] !== pc[j] || nf[j] !== pf[j] || nb[j] !== pb[j] || na[j] !== pa[j]) changed++;
        }
        // Writing the final column may have triggered autowrap; stop trusting x.
        if (this.state.x >= w) this.state.known = false;
        rowDirty = true;
        x = end + 1;
      }
      if (rowDirty) dirtyRows++;
    }

    return { output: this.parts.join(""), changedCells: changed, dirtyRows };
  }
}

/** One-shot encode of a whole buffer, e.g. for `renderToAnsi` in tests. */
export function encodeFull(buffer: FrameBuffer, options: EncoderOptions = {}): string {
  const encoder = new Encoder(options);
  const empty = { ...buffer, width: -1, height: -1 } as FrameBuffer;
  return encoder.encode(empty, buffer, true).output;
}
