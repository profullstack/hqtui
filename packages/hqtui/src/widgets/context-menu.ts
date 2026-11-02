/**
 * A context menu: the small list that opens where you right-clicked.
 *
 * It is drawn on the root surface at a screen point and clamped inside it, so
 * a click near the right edge or the bottom row still shows the whole menu:
 * it slides left rather than off the screen, and opens upward rather than
 * past the last row. Separators and disabled items are drawn but are never
 * selected, by the keyboard or by the pointer.
 */
import type { Surface } from "../surface.ts";
import type { Rect } from "../layout.ts";
import { Attr } from "../buffer.ts";
import type { Color } from "../color.ts";
import { elevate } from "../theme.ts";
import { stringWidth, truncate } from "../unicode.ts";
import type { KeyEvent } from "../input.ts";
import { drawShadow } from "./shadow.ts";

export interface ContextMenuItem {
  label: string;
  /** A shortcut hint shown right-aligned and muted, e.g. "ctrl+w". */
  hint?: string;
  /** Drawn muted; never highlighted and never activated. */
  disabled?: boolean;
  /** A horizontal rule between groups. Its label is ignored. */
  separator?: boolean;
  /** Draw the label in the theme's danger color, for destructive actions. */
  danger?: boolean;
  /** Called when the item is chosen. The menu has already closed. */
  onSelect?: () => void;
}

/** A rule between groups of items. */
export const MENU_SEPARATOR: ContextMenuItem = Object.freeze({ label: "", separator: true });

export interface ContextMenuOptions {
  /** Screen column the menu opens at: usually where the pointer was pressed. */
  x: number;
  /** Screen row the menu opens at. */
  y: number;
  items: ContextMenuItem[];
  /** The highlighted item, by index into `items`. -1 (the default) highlights nothing. */
  selected?: number;
  /** Border color. Defaults to the theme's focused border. */
  color?: Color;
  /** Never narrower than this many columns, borders included. */
  minWidth?: number;
  /** Cast a drop shadow. Default true. */
  shadow?: boolean;
}

/** Where a drawn menu landed, so the cells that show an item are the cells that choose it. */
export interface ContextMenuLayout {
  /** The whole menu, borders included, in screen coordinates. */
  box: Rect;
  /** One row per visible item, in screen coordinates. */
  rows: { index: number; rect: Rect }[];
}

const selectable = (item: ContextMenuItem | undefined): boolean =>
  !!item && !item.separator && !item.disabled;

/**
 * The next selectable item from `from`, stepping by `delta` and wrapping.
 * From -1 (nothing highlighted), down lands on the first item and up on the
 * last. Returns -1 when nothing in the menu can be selected.
 */
export function contextMenuStep(items: readonly ContextMenuItem[], from: number, delta: 1 | -1): number {
  const n = items.length;
  if (n === 0) return -1;
  let i = from < 0 || from >= n ? (delta > 0 ? -1 : n) : from;
  for (let step = 0; step < n; step++) {
    i = (i + delta + n) % n;
    if (selectable(items[i])) return i;
  }
  return -1;
}

export interface ContextMenuKeyResult {
  selected: number;
  /** Index of the item the key chose. */
  activate?: number;
  /** The key dismissed the menu. */
  close?: boolean;
}

/**
 * What a key does to an open menu. Up/Down (and Tab) move over the selectable
 * items, Home/End jump, Enter/Space choose, Escape and Left close, and a
 * letter jumps to the next item whose label starts with it.
 */
export function contextMenuKey(
  items: readonly ContextMenuItem[],
  selected: number,
  event: KeyEvent,
): ContextMenuKeyResult {
  switch (event.name) {
    case "up": return { selected: contextMenuStep(items, selected, -1) };
    case "down": return { selected: contextMenuStep(items, selected, 1) };
    case "tab": return { selected: contextMenuStep(items, selected, event.shift ? -1 : 1) };
    case "home": return { selected: contextMenuStep(items, -1, 1) };
    case "end": return { selected: contextMenuStep(items, -1, -1) };
    case "escape":
    case "left": return { selected, close: true };
    case "enter":
    case "space":
      return selectable(items[selected]) ? { selected, activate: selected } : { selected };
  }
  const ch = event.char?.toLowerCase();
  if (ch && ch.length === 1 && !event.ctrl && !event.alt) {
    for (let step = 1; step <= items.length; step++) {
      const i = (Math.max(selected, -1) + step) % items.length;
      if (selectable(items[i]) && items[i].label.trim().toLowerCase().startsWith(ch)) return { selected: i };
    }
  }
  return { selected };
}

/** Size and place a menu inside a `width` x `height` screen without drawing it. */
export function contextMenuLayout(
  width: number,
  height: number,
  options: Pick<ContextMenuOptions, "x" | "y" | "items" | "minWidth">,
): ContextMenuLayout {
  const items = options.items;
  const labels = items.reduce((w, it) => (it.separator ? w : Math.max(w, stringWidth(it.label))), 0);
  const hints = items.reduce((w, it) => (it.separator || !it.hint ? w : Math.max(w, stringWidth(it.hint))), 0);
  // " label   hint " inside a border on each side.
  const natural = labels + (hints ? hints + 3 : 0) + 4;
  const boxWidth = Math.max(0, Math.min(Math.max(natural, options.minWidth ?? 0, 12), width));
  const boxHeight = Math.max(0, Math.min(items.length + 2, height));

  // Open right and down from the point. Slide left at the right edge; at the
  // bottom open upward from the point if that fits, otherwise pin to the top.
  const x = Math.max(0, Math.min(options.x, width - boxWidth));
  let y = options.y;
  if (y + boxHeight > height) y = options.y - boxHeight + 1 >= 0 ? options.y - boxHeight + 1 : height - boxHeight;
  y = Math.max(0, y);

  const visible = Math.max(0, boxHeight - 2);
  const rows = items.slice(0, visible).map((_, index) => ({
    index,
    rect: { x: x + 1, y: y + 1 + index, width: Math.max(0, boxWidth - 2), height: 1 },
  }));
  return { box: { x, y, width: boxWidth, height: boxHeight }, rows };
}

/** Draw an open context menu on the root surface. Returns where it landed. */
export function drawContextMenu(root: Surface, options: ContextMenuOptions): ContextMenuLayout {
  const layout = contextMenuLayout(root.width, root.height, options);
  const { box } = layout;
  if (box.width < 4 || box.height < 3 || root.empty) return layout;
  const theme = root.theme;
  const border = options.color ?? theme.borderFocused;
  const bg = elevate(theme, 0.1);

  if (options.shadow !== false) drawShadow(root, box);
  const inner = root.sub(box.x, box.y, box.width, box.height).box({ border: "rounded", borderColor: border, bg });

  layout.rows.forEach(({ index }, row) => {
    const item = options.items[index];
    if (item.separator) {
      // Join the rule to the frame so the menu reads as one object.
      root.hline(box.x + 1, box.y + 1 + row, box.width - 2, "─", { fg: theme.border, bg });
      root.char(box.x, box.y + 1 + row, "├", { fg: border, bg });
      root.char(box.x + box.width - 1, box.y + 1 + row, "┤", { fg: border, bg });
      return;
    }
    const selected = index === (options.selected ?? -1) && selectable(item);
    const rowBg = selected ? theme.selection : bg;
    if (selected) inner.fillRect(0, row, inner.width, 1, { bg: rowBg });
    const hintWidth = item.hint ? stringWidth(item.hint) : 0;
    const labelRoom = Math.max(0, inner.width - 2 - (hintWidth ? hintWidth + 2 : 0));
    const fg = item.disabled ? theme.muted
      : selected ? theme.selectionText
        : item.danger ? theme.danger : theme.foreground;
    inner.text(1, row, truncate(item.label, labelRoom), {
      fg,
      bg: rowBg,
      attrs: selected ? Attr.Bold : item.disabled ? Attr.Dim : 0,
    });
    if (item.hint && hintWidth + 3 < inner.width) {
      inner.text(inner.width - hintWidth - 1, row, item.hint, {
        fg: selected ? theme.selectionText : theme.muted,
        bg: rowBg,
      });
    }
  });
  return layout;
}
