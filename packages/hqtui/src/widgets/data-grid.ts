import type { Align, Surface } from "../surface.ts";
import { Attr } from "../buffer.ts";
import type { Color } from "../color.ts";
import { mix } from "../color.ts";
import { fit, stringWidth, truncate } from "../unicode.ts";
import { elevate } from "../theme.ts";
import { drawScrollbar } from "./scrollbar.ts";
import { hoverBg, resolveOffset } from "./table.ts";

/**
 * A data grid: rows and columns of text that scroll on both axes, with a cell
 * cursor, a frozen header, a row-number gutter and a sort marker. It is what a
 * CSV viewer, a query result or a log table needs and `table` is not: `table`
 * fits every column into the width, a grid keeps each column readable and lets
 * the ones that do not fit scroll in from the side.
 *
 * The grid only draws. Parsing, sorting and filtering belong to the caller,
 * which hands over the cells as strings and, optionally, `order`: the row
 * indices to show, in the order to show them. A sorted, filtered view of a
 * 100,000-row file is then one index array, and the rows are never copied.
 */
export interface DataGridColumn {
  title: string;
  align?: Align;
  /** A fixed width, in cells. Otherwise the column is as wide as its widest sampled value. */
  width?: number;
  /** Cap for a measured width. Defaults to the grid's `maxColumnWidth`. */
  max?: number;
  color?: Color;
}

export interface DataGridOptions {
  columns: DataGridColumn[];
  /** Row-major cell text. A short row is drawn with empty cells. */
  rows: readonly (readonly string[])[];
  /** Indices into `rows` to show, in display order. Defaults to every row in order. */
  order?: readonly number[];
  /** The cursor: a position in the displayed order, and a column index. -1 hides it. */
  selectedRow?: number;
  selectedColumn?: number;
  /** First displayed row and first column drawn after the gutter. */
  rowOffset?: number;
  columnOffset?: number;
  /** Scroll so the cursor cell stays on screen. Default true. */
  followSelection?: boolean;
  /** A gutter with each row's 1-based number in `rows`, so a sorted row still says where it came from. Default true. */
  rowNumbers?: boolean;
  /** Marks a column header ▲ or ▼. */
  sort?: { column: number; descending?: boolean } | null;
  /** Widest a measured column may grow. Default 40. */
  maxColumnWidth?: number;
  /** Rows sampled when measuring column widths. Default 1,000. */
  sample?: number;
  zebra?: boolean;
  scrollbar?: boolean;
  headerColor?: Color;
  /** The displayed row under the mouse. */
  hovered?: number;
  /** Told what was drawn, so a caller can page by a screenful and map its own clicks. */
  onLayout?: (layout: DataGridFrame) => void;
}

export interface DataGridSlot {
  /** Column index. */
  index: number;
  /** Left edge inside the grid, in cells. */
  x: number;
  width: number;
}

export interface DataGridLayout {
  /** Gutter width, separator included; 0 without row numbers. */
  gutter: number;
  /** The first column drawn, after any adjustment to keep the cursor visible. */
  columnOffset: number;
  slots: DataGridSlot[];
  /** Columns exist to the left or right of what is drawn. */
  more: { left: boolean; right: boolean };
}

export interface DataGridFrame extends DataGridLayout {
  rowOffset: number;
  /** Body rows that fit, header excluded. */
  capacity: number;
  /** Rows in the displayed order. */
  total: number;
}

const SEPARATOR = "│";
const widthCache = new WeakMap<object, { key: string; widths: number[] }>();

/**
 * Natural column widths: the widest of the title and a sample of the cells,
 * capped. Measured once per `rows` array and cached, because a frame is drawn
 * far more often than a file is opened.
 */
export function dataGridWidths(
  columns: readonly DataGridColumn[],
  rows: readonly (readonly string[])[],
  options: { maxColumnWidth?: number; sample?: number; order?: readonly number[] } = {},
): number[] {
  const cap = options.maxColumnWidth ?? 40;
  const sample = options.sample ?? 1000;
  const key = `${columns.length}:${cap}:${sample}:${columns.map((c) => `${c.title}/${c.width ?? ""}/${c.max ?? ""}`).join("|")}`;
  const cached = widthCache.get(rows);
  if (cached && cached.key === key) return cached.widths;
  // Sample evenly through the file rather than only its top, so a long value
  // near the end still gets a column that shows it.
  const step = Math.max(1, Math.floor(rows.length / sample));
  const widths = columns.map((column, c) => {
    if (column.width !== undefined) return Math.max(1, column.width);
    let widest = stringWidth(column.title) + 2; // room for the sort marker
    for (let r = 0; r < rows.length; r += step) {
      const cell = rows[r]?.[c];
      if (cell) widest = Math.max(widest, stringWidth(firstLine(cell)));
    }
    return Math.max(1, Math.min(widest, column.max ?? cap));
  });
  widthCache.set(rows, { key, widths });
  return widths;
}

/**
 * Which columns fit in `width`, starting at `columnOffset` and nudged just far
 * enough that `selectedColumn` is fully on screen. The last visible column is
 * cut short rather than dropped, so the space is never wasted on blank.
 */
export function dataGridLayout(
  width: number,
  widths: readonly number[],
  options: { columnOffset?: number; selectedColumn?: number; gutter?: number; follow?: boolean } = {},
): DataGridLayout {
  const gutter = options.gutter ?? 0;
  const room = Math.max(0, width - gutter);
  const count = widths.length;
  let start = Math.max(0, Math.min(options.columnOffset ?? 0, Math.max(0, count - 1)));
  const selected = options.selectedColumn ?? -1;
  const span = (from: number, to: number): number => {
    let total = 0;
    for (let i = from; i <= to; i++) total += (widths[i] ?? 0) + (i > from ? 1 : 0);
    return total;
  };
  if (options.follow !== false && selected >= 0 && selected < count) {
    if (selected < start) start = selected;
    else while (start < selected && span(start, selected) > room) start++;
  }
  // Scrolled further right than needed: pull back so the right edge is used.
  while (start > 0 && span(start - 1, count - 1) <= room) start--;

  const slots: DataGridSlot[] = [];
  let x = gutter;
  for (let i = start; i < count && x < width; i++) {
    const w = Math.min(widths[i] ?? 0, width - x);
    if (w <= 0) break;
    slots.push({ index: i, x, width: w });
    x += w + 1;
  }
  const last = slots.at(-1);
  return {
    gutter,
    columnOffset: start,
    slots,
    more: { left: start > 0, right: !!last && (last.index < count - 1 || last.width < (widths[last.index] ?? 0)) },
  };
}

/** The column under grid column `x`, or -1 over the gutter or a separator. */
export function dataGridCellAt(layout: DataGridLayout, x: number): number {
  for (const slot of layout.slots) if (x >= slot.x && x < slot.x + slot.width) return slot.index;
  return -1;
}

const firstLine = (text: string): string => {
  const at = text.search(/[\r\n]/);
  // A multi-line cell shows its first line and a marker, never a broken row.
  return at < 0 ? text.replace(/\t/g, " ") : `${text.slice(0, at).replace(/\t/g, " ")}↵`;
};

export function gutterWidth(rows: number): number {
  return String(Math.max(1, rows)).length + 2;
}

export function drawDataGrid(surface: Surface, options: DataGridOptions): DataGridFrame {
  const theme = surface.theme;
  const order = options.order;
  const total = order ? order.length : options.rows.length;
  const scrollbar = options.scrollbar ?? false;
  const width = surface.width - (scrollbar ? 1 : 0);
  const gutter = options.rowNumbers === false ? 0 : gutterWidth(options.rows.length);
  const widths = dataGridWidths(options.columns, options.rows, options);
  const follow = options.followSelection !== false;
  const layout = dataGridLayout(width, widths, {
    columnOffset: options.columnOffset,
    selectedColumn: options.selectedColumn,
    gutter,
    follow,
  });
  const capacity = Math.max(0, surface.height - 1);
  const selectedRow = options.selectedRow ?? -1;
  const rowOffset = resolveOffset(options.rowOffset, selectedRow >= 0 ? selectedRow : undefined, capacity, total, follow);
  const frame: DataGridFrame = { ...layout, rowOffset, capacity, total };
  if (surface.empty) {
    options.onLayout?.(frame);
    return frame;
  }

  const rule = mix(theme.border, theme.foreground, 0.15);
  const headerBg = elevate(theme, 0.06);
  const zebraBg = options.zebra ? elevate(theme, 0.03) : undefined;
  const selectedColumn = options.selectedColumn ?? -1;

  // Header: frozen, with the sort marker and arrows for columns off screen.
  surface.fillRect(0, 0, width, 1, { bg: headerBg });
  if (gutter) surface.text(0, 0, fit(layout.more.left ? "‹" : "#", gutter - 1, "right"), { fg: theme.muted, bg: headerBg });
  for (const slot of layout.slots) {
    const column = options.columns[slot.index]!;
    const sorted = options.sort && options.sort.column === slot.index ? (options.sort.descending ? " ▼" : " ▲") : "";
    const room = Math.max(0, slot.width - stringWidth(sorted));
    const title = fit(truncate(column.title, room), room, column.align ?? "left") + sorted;
    surface.text(slot.x, 0, title, {
      fg: slot.index === selectedColumn ? theme.accent : options.headerColor ?? theme.title,
      bg: headerBg,
      attrs: Attr.Bold,
    });
    surface.text(slot.x + slot.width, 0, SEPARATOR, { fg: rule, bg: headerBg });
  }
  if (layout.more.right) surface.text(width - 1, 0, "›", { fg: theme.muted, bg: headerBg, attrs: Attr.Bold });

  for (let i = 0; i < capacity; i++) {
    const position = rowOffset + i;
    if (position >= total) break;
    const index = order ? order[position]! : position;
    const row = options.rows[index] ?? [];
    const y = i + 1;
    const selected = position === selectedRow;
    const hovered = !selected && options.hovered === position;
    const bg = selected
      ? theme.selection
      : hovered
        ? hoverBg(theme)
        : zebraBg && position % 2 === 1
          ? zebraBg
          : undefined;
    if (bg !== undefined) surface.fillRect(0, y, width, 1, { bg });
    if (gutter) surface.text(0, y, fit(String(index + 1), gutter - 1, "right"), { fg: selected ? theme.accent : theme.muted, bg });
    for (const slot of layout.slots) {
      const column = options.columns[slot.index]!;
      const cell = fit(truncate(firstLine(row[slot.index] ?? ""), slot.width), slot.width, column.align ?? "left");
      const cursor = selected && slot.index === selectedColumn;
      surface.text(slot.x, y, cell, {
        fg: cursor ? theme.background : selected ? theme.selectionText : column.color ?? theme.foreground,
        bg: cursor ? theme.cursor : bg,
        attrs: cursor || selected ? Attr.Bold : 0,
      });
      surface.text(slot.x + slot.width, y, SEPARATOR, { fg: rule, bg });
    }
  }

  if (scrollbar && total > capacity && capacity > 0) drawScrollbar(surface, surface.width - 1, 1, capacity, total, rowOffset);
  options.onLayout?.(frame);
  return frame;
}
