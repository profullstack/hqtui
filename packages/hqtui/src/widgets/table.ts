import type { Surface, Align } from "../surface.ts";
import { Attr, type Style } from "../buffer.ts";
import type { Color } from "../color.ts";
import { mix } from "../color.ts";
import { fit, stringWidth, truncate } from "../unicode.ts";
import { solve } from "../layout.ts";
import { elevate } from "../theme.ts";

export interface Column<Row = Record<string, unknown>> {
  /** Property to read, or use `render` for computed cells. */
  key: string;
  title?: string;
  width?: number | string;
  min?: number;
  max?: number;
  align?: Align;
  color?: Color | ((row: Row, value: unknown) => Color | undefined);
  render?: (row: Row, index: number) => string;
}

export interface TableOptions<Row = Record<string, unknown>> {
  rows: Row[];
  columns: Column<Row>[];
  header?: boolean;
  headerColor?: Color;
  /** Index of the highlighted row, or -1. */
  selected?: number;
  /** First visible row; combine with `selected` for scrolling lists. */
  offset?: number;
  /**
   * Scroll so `selected` stays visible. Only the table knows how many rows fit,
   * so working the offset out here saves every caller from tracking heights.
   */
  followSelection?: boolean;
  zebra?: boolean;
  gap?: number;
  background?: Color;
  rowColor?: (row: Row, index: number) => Color | undefined;
  /** Show a scrollbar in the last column when rows overflow. */
  scrollbar?: boolean;
  onRow?: (row: Row, index: number, y: number) => void;
}

function cellValue<Row>(row: Row, column: Column<Row>, index: number): string {
  if (column.render) return column.render(row, index);
  const v = (row as Record<string, unknown>)[column.key];
  if (v === null || v === undefined) return "";
  return String(v);
}

/**
 * Where the visible window should start: the caller's offset, nudged just far
 * enough to keep the selected row on screen, and clamped to the list.
 */
export function resolveOffset(
  offset: number | undefined,
  selected: number | undefined,
  capacity: number,
  total: number,
  follow = false,
): number {
  const maxOffset = Math.max(0, total - capacity);
  let start = Math.max(0, Math.min(offset ?? 0, maxOffset));
  if (follow && selected !== undefined && capacity > 0) {
    if (selected < start) start = selected;
    else if (selected >= start + capacity) start = selected - capacity + 1;
  }
  return Math.max(0, Math.min(start, maxOffset));
}

/** A dense, column-aligned table with optional selection and scrollbar. */
export function drawTable<Row>(surface: Surface, options: TableOptions<Row>): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const gap = options.gap ?? 1;
  const showHeader = options.header !== false;
  const headerRows = showHeader ? 1 : 0;
  const scrollbar = options.scrollbar ?? false;
  const bodyWidth = surface.width - (scrollbar ? 1 : 0);

  const widths = solve(
    bodyWidth,
    options.columns.map((c) => ({
      size: c.width ?? "auto",
      min: c.min ?? 1,
      max: c.max,
      intrinsic:
        c.width === undefined
          ? Math.max(
              stringWidth(c.title ?? c.key),
              ...options.rows.slice(0, 200).map((r, i) => stringWidth(cellValue(r, c, i))),
            )
          : 0,
    })),
    gap,
  );

  if (showHeader) {
    let x = 0;
    options.columns.forEach((column, i) => {
      const w = widths[i];
      if (w <= 0) return;
      surface.text(x, 0, fit(truncate(column.title ?? column.key, w), w, column.align ?? "left"), {
        fg: options.headerColor ?? theme.muted,
        bg: options.background,
        attrs: Attr.Bold,
      });
      x += w + gap;
    });
  }

  const capacity = Math.max(0, surface.height - headerRows);
  const offset = resolveOffset(options.offset, options.selected, capacity, options.rows.length, options.followSelection);
  const zebraBg = options.zebra ? elevate(theme, 0.04) : undefined;

  for (let i = 0; i < capacity; i++) {
    const rowIndex = offset + i;
    const row = options.rows[rowIndex];
    if (row === undefined) break;
    const y = i + headerRows;
    const selected = options.selected === rowIndex;
    const rowBg = selected ? theme.selection : options.zebra && rowIndex % 2 === 1 ? zebraBg : options.background;

    if (rowBg !== undefined) surface.fillRect(0, y, bodyWidth, 1, { bg: rowBg });

    let x = 0;
    options.columns.forEach((column, ci) => {
      const w = widths[ci];
      if (w <= 0) return;
      const text = cellValue(row, column, rowIndex);
      let fg: Color | undefined;
      if (selected) fg = theme.selectionText;
      else if (typeof column.color === "function") fg = column.color(row, (row as Record<string, unknown>)[column.key]);
      else if (column.color !== undefined) fg = column.color;
      else fg = options.rowColor?.(row, rowIndex);
      surface.text(x, y, fit(truncate(text, w), w, column.align ?? "left"), {
        fg: fg ?? theme.foreground,
        bg: rowBg,
        attrs: selected ? Attr.Bold : 0,
      });
      x += w + gap;
    });
    options.onRow?.(row, rowIndex, y);
  }

  if (scrollbar && options.rows.length > capacity && capacity > 0) {
    drawScrollbar(surface, surface.width - 1, headerRows, capacity, options.rows.length, offset);
  }
}

/** A one-column scrollbar. Thumb size reflects the visible fraction. */
export function drawScrollbar(
  surface: Surface,
  x: number,
  y: number,
  height: number,
  total: number,
  offset: number,
): void {
  const theme = surface.theme;
  const track = mix(theme.background, theme.border, 0.7);
  const thumbSize = Math.max(1, Math.round((height / total) * height));
  const maxOffset = Math.max(1, total - height);
  const thumbPos = Math.round((offset / maxOffset) * (height - thumbSize));
  for (let i = 0; i < height; i++) {
    const inThumb = i >= thumbPos && i < thumbPos + thumbSize;
    surface.char(x, y + i, inThumb ? "█" : "│", { fg: inThumb ? theme.accent : track });
  }
}

export interface ListOptions {
  items: (string | { label: string; color?: Color; badge?: string })[];
  selected?: number;
  offset?: number;
  /** Scroll so `selected` stays visible. */
  followSelection?: boolean;
  background?: Color;
  bullet?: string;
  scrollbar?: boolean;
}

export function drawList(surface: Surface, options: ListOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const width = surface.width - (options.scrollbar ? 1 : 0);
  const offset = resolveOffset(
    options.offset, options.selected, surface.height, options.items.length, options.followSelection,
  );
  for (let i = 0; i < surface.height; i++) {
    const index = offset + i;
    const raw = options.items[index];
    if (raw === undefined) break;
    const item = typeof raw === "string" ? { label: raw } : raw;
    const selected = options.selected === index;
    const bullet = options.bullet ? `${options.bullet} ` : "";
    const label = `${bullet}${item.label}`;
    if (selected) surface.fillRect(0, i, width, 1, { bg: theme.selection });
    surface.text(0, i, fit(truncate(label, width), width), {
      fg: selected ? theme.selectionText : item.color ?? theme.foreground,
      bg: selected ? theme.selection : options.background,
      attrs: selected ? Attr.Bold : 0,
    });
  }
  if (options.scrollbar && options.items.length > surface.height) {
    drawScrollbar(surface, surface.width - 1, 0, surface.height, options.items.length, offset);
  }
}

export interface TreeNode {
  label: string;
  color?: Color;
  /** Right-aligned columns, e.g. CPU% and MEM% in a process tree. */
  values?: { text: string; width: number; color?: Color; align?: Align }[];
  children?: TreeNode[];
  expanded?: boolean;
}

export interface TreeOptions {
  nodes: TreeNode[];
  selected?: number;
  offset?: number;
  /** Scroll so `selected` stays visible. */
  followSelection?: boolean;
  background?: Color;
  /** Draw the ├─ └─ connectors. */
  guides?: boolean;
  guideColor?: Color;
}

interface FlatNode {
  node: TreeNode;
  depth: number;
  last: boolean[];
}

function flatten(nodes: TreeNode[], depth: number, trail: boolean[], out: FlatNode[]): void {
  nodes.forEach((node, i) => {
    const last = i === nodes.length - 1;
    out.push({ node, depth, last: [...trail, last] });
    if (node.children && node.expanded !== false) {
      flatten(node.children, depth + 1, [...trail, last], out);
    }
  });
}

/** An indented tree with box-drawing connectors, like `pstree`. */
export function drawTree(surface: Surface, options: TreeOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const flat: FlatNode[] = [];
  flatten(options.nodes, 0, [], flat);

  const offset = resolveOffset(
    options.offset, options.selected, surface.height, flat.length, options.followSelection,
  );
  const guides = options.guides !== false;
  const guideColor = options.guideColor ?? mix(theme.border, theme.foreground, 0.15);

  for (let i = 0; i < surface.height; i++) {
    const index = offset + i;
    const entry = flat[index];
    if (!entry) break;
    const selected = options.selected === index;
    const bg = selected ? theme.selection : options.background;
    if (selected) surface.fillRect(0, i, surface.width, 1, { bg: theme.selection });

    let prefix = "";
    if (guides) {
      for (let d = 0; d < entry.depth; d++) prefix += entry.last[d] ? "   " : "│  ";
      prefix += entry.last[entry.depth] ? "└─ " : "├─ ";
    } else {
      prefix = "  ".repeat(entry.depth);
    }

    const valuesWidth = (entry.node.values ?? []).reduce((a, v) => a + v.width + 1, 0);
    const labelWidth = Math.max(0, surface.width - valuesWidth);
    surface.text(0, i, truncate(prefix, labelWidth), { fg: guideColor, bg });
    const px = Math.min(stringWidth(prefix), labelWidth);
    surface.text(px, i, truncate(entry.node.label, Math.max(0, labelWidth - px)), {
      fg: selected ? theme.selectionText : entry.node.color ?? theme.foreground,
      bg,
      attrs: selected ? Attr.Bold : 0,
    });

    let vx = labelWidth;
    for (const value of entry.node.values ?? []) {
      surface.text(vx, i, fit(truncate(value.text, value.width), value.width, value.align ?? "right"), {
        fg: selected ? theme.selectionText : value.color ?? theme.foreground,
        bg,
      });
      vx += value.width + 1;
    }
  }
}

export interface LogEntry {
  time?: string;
  level?: string;
  message: string;
  meta?: string;
  color?: Color;
}

export interface LogOptions {
  entries: LogEntry[];
  /** Pin to the newest entry. Default true. */
  follow?: boolean;
  offset?: number;
  background?: Color;
  levelColors?: Record<string, Color>;
  timeColor?: Color;
  metaColor?: Color;
  wrap?: boolean;
}

/** A tailing log view with colored levels. Newest at the bottom. */
export function drawLog(surface: Surface, options: LogOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const levels: Record<string, Color> = {
    ERROR: theme.danger,
    WARN: theme.warning,
    INFO: theme.success,
    DEBUG: theme.muted,
    TRACE: theme.muted,
    FATAL: theme.danger,
    ...options.levelColors,
  };

  const entries = options.entries;
  const follow = options.follow !== false;
  const start = follow
    ? Math.max(0, entries.length - surface.height)
    : resolveOffset(options.offset, undefined, surface.height, entries.length);

  for (let i = 0; i < surface.height; i++) {
    const entry = entries[start + i];
    if (!entry) break;
    let x = 0;
    if (entry.time) {
      x += surface.text(x, i, `${entry.time} `, { fg: options.timeColor ?? theme.muted, bg: options.background });
    }
    if (entry.level) {
      const color = levels[entry.level.toUpperCase()] ?? theme.foreground;
      x += surface.text(x, i, fit(entry.level.toUpperCase(), 5), { fg: color, bg: options.background, attrs: Attr.Bold });
      x += surface.text(x, i, " ", { bg: options.background });
    }
    const metaWidth = entry.meta ? stringWidth(entry.meta) + 1 : 0;
    const msgWidth = Math.max(0, surface.width - x - metaWidth);
    surface.text(x, i, truncate(entry.message, msgWidth), {
      fg: entry.color ?? theme.foreground,
      bg: options.background,
    });
    if (entry.meta && metaWidth < surface.width) {
      surface.text(surface.width - metaWidth + 1, i, entry.meta, {
        fg: options.metaColor ?? theme.muted,
        bg: options.background,
      });
    }
  }
}
