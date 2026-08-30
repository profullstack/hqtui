import type { Surface, Align } from "../surface.ts";
import type { Style } from "../buffer.ts";
import { Attr } from "../buffer.ts";
import type { Color } from "../color.ts";
import { mix } from "../color.ts";
import { fit, stringWidth, truncate, wrap } from "../unicode.ts";
import { elevate } from "../theme.ts";

export interface TextOptions extends Style {
  align?: Align;
  wrap?: boolean;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

function attrsOf(o: TextOptions): number {
  let a = o.attrs ?? 0;
  if (o.bold) a |= Attr.Bold;
  if (o.dim) a |= Attr.Dim;
  if (o.italic) a |= Attr.Italic;
  if (o.underline) a |= Attr.Underline;
  return a;
}

export function drawText(surface: Surface, content: string, options: TextOptions = {}): void {
  if (surface.empty) return;
  const style: Style = {
    fg: options.fg ?? surface.theme.foreground,
    bg: options.bg,
    attrs: attrsOf(options),
  };
  const lines = options.wrap ? wrap(content, surface.width) : content.split("\n");
  for (let i = 0; i < lines.length && i < surface.height; i++) {
    surface.text(0, i, fit(truncate(lines[i], surface.width), surface.width, options.align ?? "left"), style);
  }
}

export interface BadgeOptions {
  text: string;
  color?: Color;
  /** Filled reads as a chip; outline keeps the panel quiet. */
  variant?: "filled" | "outline" | "subtle";
  align?: Align;
}

export function drawBadge(surface: Surface, options: BadgeOptions): number {
  if (surface.empty) return 0;
  const theme = surface.theme;
  const color = options.color ?? theme.primary;
  const label = ` ${options.text} `;
  const variant = options.variant ?? "filled";
  const style: Style =
    variant === "filled"
      ? { fg: theme.dark ? theme.background : theme.surface, bg: color, attrs: Attr.Bold }
      : variant === "subtle"
        ? { fg: color, bg: mix(theme.surface, color, 0.18) }
        : { fg: color, attrs: Attr.Bold };
  const width = Math.min(stringWidth(label), surface.width);
  const x = options.align === "right" ? surface.width - width : options.align === "center" ? Math.floor((surface.width - width) / 2) : 0;
  surface.text(Math.max(0, x), 0, truncate(label, surface.width), style);
  return width;
}

export interface KeyValueRow {
  label: string;
  value: string;
  color?: Color;
  labelColor?: Color;
}

export interface KeyValueOptions {
  rows: KeyValueRow[];
  /** Columns reserved for labels. Defaults to the widest label. */
  labelWidth?: number;
  gap?: number;
  /** Push values to the right edge instead of next to the label. */
  spread?: boolean;
  labelColor?: Color;
  valueColor?: Color;
  background?: Color;
}

/** Aligned label/value pairs — the backbone of every "System" panel. */
export function drawKeyValues(surface: Surface, options: KeyValueOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const rows = options.rows;
  const gap = options.gap ?? 1;
  const labelWidth =
    options.labelWidth ?? Math.min(
      Math.max(0, ...rows.map((r) => stringWidth(r.label))) + 1,
      Math.max(4, Math.floor(surface.width * 0.6)),
    );

  for (let i = 0; i < rows.length && i < surface.height; i++) {
    const row = rows[i];
    surface.text(0, i, fit(truncate(row.label, labelWidth), labelWidth), {
      fg: row.labelColor ?? options.labelColor ?? theme.muted,
      bg: options.background,
    });
    const vx = labelWidth + gap;
    const vw = Math.max(0, surface.width - vx);
    if (vw === 0) continue;
    const value = truncate(row.value, vw);
    surface.text(vx, i, options.spread === false ? value : fit(value, vw, "right"), {
      fg: row.color ?? options.valueColor ?? theme.foreground,
      bg: options.background,
    });
  }
}

export interface DividerOptions {
  label?: string;
  color?: Color;
  char?: string;
  align?: Align;
}

export function drawDivider(surface: Surface, options: DividerOptions = {}): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const color = options.color ?? theme.border;
  const ch = options.char ?? "─";
  surface.hline(0, 0, surface.width, ch, { fg: color });
  if (options.label) {
    const label = ` ${options.label} `;
    const w = stringWidth(label);
    const align = options.align ?? "left";
    const x = align === "left" ? 1 : align === "right" ? surface.width - w - 1 : Math.floor((surface.width - w) / 2);
    surface.text(Math.max(0, x), 0, truncate(label, surface.width), { fg: theme.muted });
  }
}

export interface StatusItem {
  key?: string;
  label: string;
  color?: Color;
  /** Highlight this entry, e.g. the active tab or a live indicator. */
  active?: boolean;
}

export interface StatusBarOptions {
  items: StatusItem[];
  right?: StatusItem[];
  background?: Color;
  keyColor?: Color;
  /** Reverse-video the key caps, like a function-key bar. */
  keyStyle?: "caps" | "plain";
}

/** The F1/F2/F10 bar along the bottom of every serious TUI. */
export function drawStatusBar(surface: Surface, options: StatusBarOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const bg = options.background ?? elevate(theme, 0.04);
  surface.fill({ bg });

  let x = 1;
  const drawItems = (items: StatusItem[], startX: number): number => {
    let cx = startX;
    for (const item of items) {
      if (cx >= surface.width) break;
      if (item.key) {
        const cap = options.keyStyle === "plain" ? item.key : item.key;
        const capStyle: Style =
          options.keyStyle === "plain"
            ? { fg: options.keyColor ?? theme.accent, bg, attrs: Attr.Bold }
            : { fg: theme.dark ? theme.background : theme.surface, bg: options.keyColor ?? theme.accent, attrs: Attr.Bold };
        cx += surface.text(cx, 0, cap, capStyle);
        cx += surface.text(cx, 0, " ", { bg });
      }
      cx += surface.text(cx, 0, item.label, {
        fg: item.active ? theme.foreground : item.color ?? theme.muted,
        bg,
        attrs: item.active ? Attr.Bold : 0,
      });
      cx += surface.text(cx, 0, "  ", { bg });
    }
    return cx;
  };

  x = drawItems(options.items, x);

  if (options.right && options.right.length) {
    const width = options.right.reduce(
      (a, i) => a + stringWidth(i.label) + (i.key ? stringWidth(i.key) + 1 : 0) + 2,
      0,
    );
    drawItems(options.right, Math.max(x, surface.width - width - 1));
  }
}
