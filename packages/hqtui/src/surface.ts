import { FrameBuffer, type Style, type Attributes } from "./buffer.ts";
import { DEFAULT_COLOR, type Color } from "./color.ts";
import { type Rect, inset, intersect, isEmpty, type Padding } from "./layout.ts";
import { graphemes, stringWidth, truncate, fit } from "./unicode.ts";
import type { Theme } from "./theme.ts";
import { fitSpans, spanStyle, spanWidth, truncateSpans, type SpanLine } from "./richtext.ts";

export type BorderStyle = "rounded" | "single" | "double" | "thick" | "dashed" | "ascii" | "none";

export interface BorderChars {
  tl: string; tr: string; bl: string; br: string;
  h: string; v: string;
  ml: string; mr: string; mt: string; mb: string; cross: string;
}

export const BORDERS: Record<Exclude<BorderStyle, "none">, BorderChars> = {
  rounded: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", ml: "├", mr: "┤", mt: "┬", mb: "┴", cross: "┼" },
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", ml: "├", mr: "┤", mt: "┬", mb: "┴", cross: "┼" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║", ml: "╠", mr: "╣", mt: "╦", mb: "╩", cross: "╬" },
  thick: { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃", ml: "┣", mr: "┫", mt: "┳", mb: "┻", cross: "╋" },
  dashed: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "╌", v: "╎", ml: "├", mr: "┤", mt: "┬", mb: "┴", cross: "┼" },
  ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", ml: "+", mr: "+", mt: "+", mb: "+", cross: "+" },
};

/**
 * Edge bits for a border glyph: 1 up, 2 right, 4 down, 8 left.
 *
 * Collapsing two panel borders is the union of their edges. A panel's top-right
 * corner (down + left) landing on its neighbour's top-left (down + right) is
 * down + left + right, which is the T that makes the two read as one frame.
 */
export const EDGE_UP = 1;
export const EDGE_RIGHT = 2;
export const EDGE_DOWN = 4;
export const EDGE_LEFT = 8;

const PART_BITS: Record<keyof BorderChars, number> = {
  tl: EDGE_RIGHT | EDGE_DOWN,
  tr: EDGE_LEFT | EDGE_DOWN,
  bl: EDGE_UP | EDGE_RIGHT,
  br: EDGE_UP | EDGE_LEFT,
  h: EDGE_LEFT | EDGE_RIGHT,
  v: EDGE_UP | EDGE_DOWN,
  ml: EDGE_UP | EDGE_DOWN | EDGE_RIGHT,
  mr: EDGE_UP | EDGE_DOWN | EDGE_LEFT,
  mt: EDGE_LEFT | EDGE_RIGHT | EDGE_DOWN,
  mb: EDGE_LEFT | EDGE_RIGHT | EDGE_UP,
  cross: EDGE_UP | EDGE_RIGHT | EDGE_DOWN | EDGE_LEFT,
};

/**
 * Every border glyph in every style, to its edges. Built once. ASCII borders
 * collide (every corner is `+`), and the first entry wins, which is right: the
 * union of anything with a `+` is a `+`.
 */
const BITS_BY_CODEPOINT = new Map<number, number>();
for (const chars of Object.values(BORDERS)) {
  for (const [part, ch] of Object.entries(chars) as [keyof BorderChars, string][]) {
    const code = ch.codePointAt(0);
    if (code !== undefined && !BITS_BY_CODEPOINT.has(code)) {
      BITS_BY_CODEPOINT.set(code, PART_BITS[part]);
    }
  }
}

/** The glyph in `style` with exactly these edges, or null if there is none. */
export function borderGlyph(style: Exclude<BorderStyle, "none">, bits: number): string | null {
  const chars = BORDERS[style];
  for (const [part, value] of Object.entries(PART_BITS) as [keyof BorderChars, number][]) {
    if (value === bits) return chars[part];
  }
  return null;
}

/** The edges of a border glyph, or null when it is not one. */
export function borderBits(codepoint: number): number | null {
  return BITS_BY_CODEPOINT.get(codepoint) ?? null;
}

export type Side = "top" | "right" | "bottom" | "left";

/**
 * Which edges of a box to draw. "all" is every side, which is what a box was
 * before this existed; "none" draws no rule but still insets nothing, the same
 * as a border style of "none".
 */
export type Sides = "all" | "none" | readonly Side[];

/** The four sides as flags, in the order the drawing code wants them. */
export interface DrawnSides {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export function resolveSides(sides: Sides | undefined): DrawnSides {
  if (sides === undefined || sides === "all") {
    return { top: true, right: true, bottom: true, left: true };
  }
  if (sides === "none") return { top: false, right: false, bottom: false, left: false };
  return {
    top: sides.includes("top"),
    right: sides.includes("right"),
    bottom: sides.includes("bottom"),
    left: sides.includes("left"),
  };
}

/**
 * The glyph for a cell where two edges meet, given which of them are drawn.
 *
 * A corner is only a corner when both its sides are there. A top-only rule
 * runs straight through the cell a corner would occupy, which is why this
 * falls back to the plain rule rather than leaving a gap.
 */
export function junction(style: Exclude<BorderStyle, "none">, bits: number): string | null {
  if (bits === 0) return null;
  const glyph = borderGlyph(style, bits);
  if (glyph !== null) return glyph;
  const chars = BORDERS[style];
  return bits & (EDGE_LEFT | EDGE_RIGHT) ? chars.h : chars.v;
}

export type Align = "left" | "center" | "right";

export interface TextOptions extends Style {
  align?: Align;
  /** Truncate with an ellipsis instead of clipping mid-word. */
  ellipsis?: boolean;
  maxWidth?: number;
}

export interface BoxOptions extends Style {
  border?: BorderStyle;
  /**
   * Which edges to draw. Defaults to all four. The interior follows the sides
   * actually drawn, so a top-only box costs one row rather than two.
   */
  sides?: Sides;
  borderColor?: Color;
  title?: string;
  titleAlign?: Align;
  titleColor?: Color;
  /** Right-aligned text on the top border, e.g. a value or a hint. */
  subtitle?: string;
  subtitleColor?: Color;
  /** Paint the interior with `bg` before drawing. */
  fill?: boolean;
  /**
   * Merge this border with one already drawn in the same cell, rather than
   * overwriting it. Set for you by the container when the app asks for
   * collapsed borders; there is no reason to pass it by hand.
   */
  collapse?: boolean;
  footer?: string;
  footerColor?: Color;
}

/**
 * A clipped, translated view onto the framebuffer. Widgets only ever see a
 * Surface, so nothing can draw outside the rectangle it was given.
 */
export class Surface {
  readonly buffer: FrameBuffer;
  readonly rect: Rect;
  readonly clip: Rect;
  readonly theme: Theme;

  constructor(buffer: FrameBuffer, rect: Rect, theme: Theme, clip?: Rect) {
    this.buffer = buffer;
    this.rect = rect;
    this.theme = theme;
    this.clip = clip ? intersect(rect, clip) : rect;
  }

  get width(): number {
    return this.rect.width;
  }
  get height(): number {
    return this.rect.height;
  }
  get empty(): boolean {
    return isEmpty(this.rect);
  }

  /** A child surface in local coordinates, clipped to this one. */
  sub(x: number, y: number, width: number, height: number): Surface {
    const abs: Rect = { x: this.rect.x + x, y: this.rect.y + y, width, height };
    return new Surface(this.buffer, abs, this.theme, this.clip);
  }

  /** A child surface from an absolute rect (as produced by the layout solver). */
  region(rect: Rect, clipToParent = true): Surface {
    return new Surface(this.buffer, rect, this.theme, clipToParent ? this.clip : undefined);
  }

  inset(padding: Padding): Surface {
    return this.region(inset(this.rect, padding));
  }

  private visible(absX: number, absY: number): boolean {
    const c = this.clip;
    return absX >= c.x && absY >= c.y && absX < c.x + c.width && absY < c.y + c.height;
  }

  char(x: number, y: number, value: number | string, style?: Style): void {
    const ax = this.rect.x + x;
    const ay = this.rect.y + y;
    if (!this.visible(ax, ay)) return;
    const v = typeof value === "string" ? (value.codePointAt(0) ?? 32) : value;
    this.buffer.setCell(ax, ay, v, style);
  }

  /**
   * Writes a border glyph, merging it with whatever border is already there.
   *
   * Only border glyphs merge. Anything else in the cell is overwritten, which
   * keeps a panel drawn over a chart looking like a panel rather than growing
   * junctions out of the data.
   */
  private mergeBorder(
    x: number,
    y: number,
    ch: string,
    style: Exclude<BorderStyle, "none">,
    cellStyle: Style,
  ): void {
    const ax = this.rect.x + x;
    const ay = this.rect.y + y;
    if (!this.visible(ax, ay)) return;

    const incoming = ch.codePointAt(0);
    if (incoming === undefined) return;

    const existing = this.buffer.chars[this.buffer.index(ax, ay)] ?? 0;
    const before = borderBits(existing);
    const after = borderBits(incoming);
    if (before === null || after === null || before === after) {
      this.buffer.setCell(ax, ay, incoming, cellStyle);
      return;
    }

    const merged = borderGlyph(style, before | after);
    this.buffer.setCell(ax, ay, merged?.codePointAt(0) ?? incoming, cellStyle);
  }

  /** Draw text at local (x, y). Returns columns written. */
  text(x: number, y: number, text: string, options: TextOptions = {}): number {
    const ay = this.rect.y + y;
    const c = this.clip;
    if (ay < c.y || ay >= c.y + c.height) return 0;

    const limit = Math.min(options.maxWidth ?? this.width - x, this.width - x);
    if (limit <= 0) return 0;
    let content = text;
    if (options.ellipsis !== false && stringWidth(content) > limit) {
      content = truncate(content, limit);
    }
    if (options.align && options.align !== "left") {
      content = fit(content, limit, options.align);
    }

    const style: Style = { fg: options.fg, bg: options.bg, attrs: options.attrs };
    let cx = this.rect.x + x;
    let written = 0;
    for (const g of graphemes(content)) {
      if (written + g.width > limit) break;
      if (cx >= c.x && cx + g.width <= c.x + c.width) {
        this.buffer.setCell(cx, ay, g.value, style);
      }
      cx += g.width;
      written += g.width;
    }
    return written;
  }

  /**
   * Draw one line of styled spans at local (x, y). Returns columns written.
   *
   * The same clipping, truncation and alignment as `text`, but each span paints
   * with its own colours over the options given here, so a line can carry more
   * than one style. `text` is the single-span case of this.
   */
  spans(x: number, y: number, line: SpanLine, options: TextOptions = {}): number {
    const ay = this.rect.y + y;
    const c = this.clip;
    if (ay < c.y || ay >= c.y + c.height) return 0;

    const limit = Math.min(options.maxWidth ?? this.width - x, this.width - x);
    if (limit <= 0) return 0;
    let content = line;
    if (options.ellipsis !== false && spanWidth(content) > limit) {
      content = truncateSpans(content, limit);
    }
    if (options.align && options.align !== "left") {
      content = fitSpans(content, limit, options.align);
    }

    const base: Style = { fg: options.fg, bg: options.bg, attrs: options.attrs };
    let cx = this.rect.x + x;
    let written = 0;
    for (const span of content) {
      const style = spanStyle(span, base);
      for (const g of graphemes(span.text)) {
        if (written + g.width > limit) return written;
        if (cx >= c.x && cx + g.width <= c.x + c.width) {
          this.buffer.setCell(cx, ay, g.value, style);
        }
        cx += g.width;
        written += g.width;
      }
    }
    return written;
  }

  /** Text positioned within the full surface width. */
  textAligned(y: number, text: string, align: Align, options: TextOptions = {}): void {
    this.text(0, y, fit(truncate(text, this.width), this.width, align), { ...options, align: "left" });
  }

  fill(style: Style, ch = 32): void {
    this.fillRect(0, 0, this.width, this.height, style, ch);
  }

  fillRect(x: number, y: number, w: number, h: number, style: Style, ch = 32): void {
    const abs = intersect(
      { x: this.rect.x + x, y: this.rect.y + y, width: w, height: h },
      this.clip,
    );
    if (isEmpty(abs)) return;
    this.buffer.fillRect(abs.x, abs.y, abs.width, abs.height, ch, style);
  }

  styleRect(x: number, y: number, w: number, h: number, style: Style): void {
    const abs = intersect(
      { x: this.rect.x + x, y: this.rect.y + y, width: w, height: h },
      this.clip,
    );
    if (isEmpty(abs)) return;
    this.buffer.styleRect(abs.x, abs.y, abs.width, abs.height, style);
  }

  hline(x: number, y: number, length: number, ch = "─", style?: Style): void {
    for (let i = 0; i < length; i++) this.char(x + i, y, ch, style);
  }

  vline(x: number, y: number, length: number, ch = "│", style?: Style): void {
    for (let i = 0; i < length; i++) this.char(x, y + i, ch, style);
  }

  /**
   * Draw a bordered box with an optional title, and return the interior surface.
   * This is the workhorse behind every panel in the library.
   */
  box(options: BoxOptions = {}): Surface {
    const style = options.border ?? "rounded";
    const fg = options.borderColor ?? this.theme.border;
    const bg = options.bg;

    if (options.fill !== false && bg !== undefined) {
      this.fill({ bg });
    }

    const sides = resolveSides(options.sides);
    const any = sides.top || sides.right || sides.bottom || sides.left;

    if (style === "none" || !any || this.width < 2 || this.height < 1) {
      return this.inset(style === "none" || !any ? 0 : 1);
    }

    const b = BORDERS[style];
    const w = this.width;
    const h = this.height;
    const borderStyle: Style = { fg, bg };

    // With collapsing on, a border glyph landing on another one becomes the
    // union of the two. Without it this is a plain write, so a screen that
    // never asks for collapsing renders byte for byte as it always did.
    const put = options.collapse
      ? (x: number, y: number, ch: string) => this.mergeBorder(x, y, ch, style, borderStyle)
      : (x: number, y: number, ch: string) => this.char(x, y, ch, borderStyle);
    const putH = (x: number, y: number, length: number, ch: string) => {
      for (let i = 0; i < length; i++) put(x + i, y, ch);
    };
    const putV = (x: number, y: number, length: number, ch: string) => {
      for (let i = 0; i < length; i++) put(x, y + i, ch);
    };

    // A corner belongs to the two sides that meet there, so it exists only if
    // both of them are drawn; where one is, the rule runs straight through.
    const corner = (a: boolean, aBit: number, c: boolean, cBit: number): string | null =>
      junction(style, (a ? aBit : 0) | (c ? cBit : 0));

    const tl = corner(sides.top, EDGE_RIGHT, sides.left, EDGE_DOWN);
    const tr = corner(sides.top, EDGE_LEFT, sides.right, EDGE_DOWN);
    if (sides.top) putH(1, 0, w - 2, b.h);
    if (tl !== null) put(0, 0, tl);
    if (tr !== null) put(w - 1, 0, tr);

    if (h > 1) {
      const bl = corner(sides.bottom, EDGE_RIGHT, sides.left, EDGE_UP);
      const br = corner(sides.bottom, EDGE_LEFT, sides.right, EDGE_UP);
      if (sides.bottom) putH(1, h - 1, w - 2, b.h);
      if (bl !== null) put(0, h - 1, bl);
      if (br !== null) put(w - 1, h - 1, br);
      if (sides.left) putV(0, 1, h - 2, b.v);
      if (sides.right) putV(w - 1, 1, h - 2, b.v);
    }

    // Measured before the title is drawn: both share the top border row, and
    // the title used to be truncated against the full width and then painted
    // over by the subtitle.
    const subtitle = options.subtitle ? ` ${options.subtitle} ` : "";
    const subtitleWidth = subtitle && stringWidth(subtitle) + 4 < w ? stringWidth(subtitle) : 0;

    if (options.title && sides.top) {
      const titleColor = options.titleColor ?? this.theme.title;
      const label = ` ${options.title} `;
      // The title lives in [2, limit). Reserving the width is not enough on its
      // own: right- and centre-aligned titles are positioned from the panel
      // edge, so they would still be drawn over the subtitle — and a wide glyph
      // straddling the boundary bisects it, leaving an orphaned half-character.
      // Both labels carry a space of padding, and those two spaces may share a
      // column, so the region ends one past the subtitle when there is one.
      const limit = subtitleWidth > 0 ? w - 1 - subtitleWidth : w - 2;
      const room = Math.max(0, limit - 2);
      const shown = truncate(label, room);
      const tw = stringWidth(shown);
      const align = options.titleAlign ?? "left";
      const tx = align === "left"
        ? 2
        : align === "right"
          ? Math.max(2, limit - tw)
          : Math.max(2, Math.min(limit - tw, Math.floor((w - tw) / 2)));
      this.text(tx, 0, shown, { fg: titleColor, bg, attrs: 1 /* bold */ });
    }

    if (subtitleWidth > 0 && sides.top) {
      this.text(w - 2 - subtitleWidth, 0, subtitle, {
        fg: options.subtitleColor ?? this.theme.muted,
        bg,
      });
    }

    if (options.footer && sides.bottom && h > 2) {
      const foot = ` ${options.footer} `;
      const fw = stringWidth(foot);
      if (fw + 4 < w) {
        this.text(2, h - 1, foot, { fg: options.footerColor ?? this.theme.muted, bg });
      }
    }

    // The interior follows the sides actually drawn, so a top-only box costs
    // one row rather than two.
    const left = sides.left ? 1 : 0;
    const top = sides.top ? 1 : 0;
    const shrinkX = left + (sides.right ? 1 : 0);
    const shrinkY = top + (sides.bottom ? 1 : 0);
    return this.sub(left, top, Math.max(0, w - shrinkX), Math.max(0, h - shrinkY));
  }

  /** Absolute rect of this surface, for hit-testing mouse events. */
  hitRect(): Rect {
    return { ...this.rect };
  }
}

export function createSurface(buffer: FrameBuffer, theme: Theme, rect?: Rect): Surface {
  return new Surface(
    buffer,
    rect ?? { x: 0, y: 0, width: buffer.width, height: buffer.height },
    theme,
  );
}

export type { Style, Attributes, Color };
export { DEFAULT_COLOR };
