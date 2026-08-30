import { FrameBuffer, type Style, type Attributes } from "./buffer.ts";
import { DEFAULT_COLOR, type Color } from "./color.ts";
import { type Rect, inset, intersect, isEmpty, type Padding } from "./layout.ts";
import { graphemes, stringWidth, truncate, fit } from "./unicode.ts";
import type { Theme } from "./theme.ts";

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

export type Align = "left" | "center" | "right";

export interface TextOptions extends Style {
  align?: Align;
  /** Truncate with an ellipsis instead of clipping mid-word. */
  ellipsis?: boolean;
  maxWidth?: number;
}

export interface BoxOptions extends Style {
  border?: BorderStyle;
  borderColor?: Color;
  title?: string;
  titleAlign?: Align;
  titleColor?: Color;
  /** Right-aligned text on the top border, e.g. a value or a hint. */
  subtitle?: string;
  subtitleColor?: Color;
  /** Paint the interior with `bg` before drawing. */
  fill?: boolean;
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

    if (style === "none" || this.width < 2 || this.height < 1) {
      return this.inset(style === "none" ? 0 : 1);
    }

    const b = BORDERS[style];
    const w = this.width;
    const h = this.height;
    const borderStyle: Style = { fg, bg };

    this.char(0, 0, b.tl, borderStyle);
    this.char(w - 1, 0, b.tr, borderStyle);
    this.hline(1, 0, w - 2, b.h, borderStyle);
    if (h > 1) {
      this.char(0, h - 1, b.bl, borderStyle);
      this.char(w - 1, h - 1, b.br, borderStyle);
      this.hline(1, h - 1, w - 2, b.h, borderStyle);
      this.vline(0, 1, h - 2, b.v, borderStyle);
      this.vline(w - 1, 1, h - 2, b.v, borderStyle);
    }

    if (options.title) {
      const titleColor = options.titleColor ?? this.theme.title;
      const label = ` ${options.title} `;
      const maxLabel = Math.max(0, w - 4);
      const shown = truncate(label, maxLabel);
      const tw = stringWidth(shown);
      const align = options.titleAlign ?? "left";
      const tx = align === "left" ? 2 : align === "right" ? Math.max(2, w - 2 - tw) : Math.max(2, Math.floor((w - tw) / 2));
      this.text(tx, 0, shown, { fg: titleColor, bg, attrs: 1 /* bold */ });
    }

    if (options.subtitle) {
      const sub = ` ${options.subtitle} `;
      const sw = stringWidth(sub);
      if (sw + 4 < w) {
        this.text(w - 2 - sw, 0, sub, { fg: options.subtitleColor ?? this.theme.muted, bg });
      }
    }

    if (options.footer && h > 2) {
      const foot = ` ${options.footer} `;
      const fw = stringWidth(foot);
      if (fw + 4 < w) {
        this.text(2, h - 1, foot, { fg: options.footerColor ?? this.theme.muted, bg });
      }
    }

    return this.sub(1, 1, Math.max(0, w - 2), Math.max(0, h - 2));
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
