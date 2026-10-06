/**
 * An OpenEmoji picker: a search line, one tab per emoji group (plus Recent)
 * drawn with OpenIcon glyphs, a grid of emoji, and the highlighted emoji's
 * name and shortcode underneath.
 *
 * Immediate mode, like every hqtui widget: the app owns an EmojiPickerState,
 * feeds keys through emojiPickerKey(), and draws with ui.emojiPicker() (which
 * also wires the mouse: click a tab or an emoji, scroll the grid, hover to
 * highlight). The picker hands back an EmojiInfo; what to do with `char` (insert it
 * at a caret, react to a message) is the app's business.
 */
import type { Surface } from "../surface.ts";
import type { Rect } from "../layout.ts";
import { Attr } from "../buffer.ts";
import { mix } from "../color.ts";
import { elevate } from "../theme.ts";
import type { KeyEvent } from "../input.ts";
import { fit, stringWidth, truncate } from "../unicode.ts";
import { emojiByGroup, emojiGroups, emojiInfo, emojiSearch, type EmojiInfo } from "../emoji.ts";
import { icon } from "../icons.ts";

/** The Recent tab's id. Group tabs are 0..8, in emojiGroups() order. */
export const EMOJI_RECENT = -1;

export interface EmojiPickerState {
  query: string;
  /** EMOJI_RECENT or a group index. Ignored while there is a query. */
  tab: number;
  /** Highlighted item. */
  index: number;
  /** First visible grid row. */
  offset: number;
}

export interface EmojiPickerOptions {
  state: EmojiPickerState;
  /** Recently picked emoji (characters or names), most recent first. */
  recent?: string[];
  /** Grid size in emoji. Default 10 x 7. */
  columns?: number;
  rows?: number;
  /** Top-left corner on the root surface; default centred. */
  x?: number;
  y?: number;
  title?: string;
}

export interface EmojiPickerLayout {
  box: Rect;
  /** One rect per tab, with the tab id it selects. */
  tabs: { rect: Rect; tab: number }[];
  grid: Rect;
  columns: number;
  rows: number;
}

export interface EmojiPickerResult {
  state: EmojiPickerState;
  picked?: EmojiInfo;
  close?: boolean;
}

const TONED = /(^|-)1f3f[b-f](-|$)/;

/** OpenIcon glyph per group, in Unicode group order. */
const GROUP_ICONS = ["smile", "users", "leaf", "coffee", "globe", "trophy", "lightbulb", "hash", "flag"];

export function createEmojiPicker(recent: string[] = []): EmojiPickerState {
  return { query: "", tab: recent.length ? EMOJI_RECENT : 0, index: 0, offset: 0 };
}

/** What the grid shows for this state: search results, recents, or a group. */
export function emojiPickerItems(state: EmojiPickerState, recent: string[] = []): EmojiInfo[] {
  // Search skips skin-tone rows: the toned couples are full rows in the data,
  // and twenty of them would bury the plain emoji people are looking for.
  if (state.query.trim()) return emojiSearch(state.query, 400).filter((e) => !TONED.test(e.key));
  if (state.tab === EMOJI_RECENT) {
    return recent.map((r) => emojiInfo(r)).filter((e): e is EmojiInfo => !!e);
  }
  return emojiByGroup(state.tab);
}

function tabIds(recent: string[]): number[] {
  return [...(recent.length ? [EMOJI_RECENT] : []), ...emojiGroups().map((_, i) => i)];
}

/** Keep the highlighted item in range and its row on screen. */
function settle(state: EmojiPickerState, count: number, columns: number, rows: number): EmojiPickerState {
  const index = count === 0 ? 0 : Math.max(0, Math.min(state.index, count - 1));
  const row = Math.floor(index / columns);
  const lastOffset = Math.max(0, Math.ceil(count / columns) - rows);
  let offset = Math.max(0, Math.min(state.offset, lastOffset));
  if (row < offset) offset = row;
  if (row >= offset + rows) offset = row - rows + 1;
  return { ...state, index, offset };
}

/**
 * Apply one key. Arrows move the highlight, PageUp/PageDown a screen, Tab and
 * Shift+Tab (or Ctrl+←/→) switch groups, typing searches, Backspace edits the
 * search, Ctrl+U clears it, Enter picks, Escape closes.
 */
export function emojiPickerKey(
  state: EmojiPickerState,
  event: KeyEvent,
  options: { recent?: string[]; columns?: number; rows?: number } = {},
): EmojiPickerResult {
  const recent = options.recent ?? [];
  const columns = options.columns ?? 10;
  const rows = options.rows ?? 7;
  const items = emojiPickerItems(state, recent);
  const move = (next: Partial<EmojiPickerState>) => ({
    state: settle({ ...state, ...next }, emojiPickerItems({ ...state, ...next }, recent).length, columns, rows),
  });
  const switchTab = (step: number) => {
    const ids = tabIds(recent);
    const at = Math.max(0, ids.indexOf(state.tab));
    const tab = ids[(at + step + ids.length) % ids.length] ?? 0;
    return move({ tab, query: "", index: 0, offset: 0 });
  };

  switch (event.key) {
    case "escape": return { state, close: true };
    case "enter": return items[state.index] ? { state, picked: items[state.index] } : { state };
    case "left": return move({ index: state.index - 1 });
    case "right": return move({ index: state.index + 1 });
    case "up": return move({ index: state.index - columns });
    case "down": return move({ index: state.index + columns });
    case "pageup": return move({ index: state.index - columns * rows, offset: state.offset - rows });
    case "pagedown": return move({ index: state.index + columns * rows, offset: state.offset + rows });
    case "home": return move({ index: 0 });
    case "end": return move({ index: items.length - 1 });
    case "tab": case "ctrl+right": return switchTab(event.shift ? -1 : 1);
    case "shift+tab": case "ctrl+left": return switchTab(-1);
    case "backspace": return move({ query: [...state.query].slice(0, -1).join(""), index: 0, offset: 0 });
    case "ctrl+u": return move({ query: "", index: 0, offset: 0 });
  }
  const char = event.name === "space" ? " " : event.char;
  if (char && !event.ctrl && !event.alt && !/[\x00-\x1f\x7f]/.test(char)) {
    return move({ query: state.query + char, index: 0, offset: 0 });
  }
  return { state };
}

/** The picker's outer size for a grid of columns x rows. */
export function emojiPickerSize(columns = 10, rows = 7): { width: number; height: number } {
  // 3 columns per emoji, a border each side, a gutter on the left and the scrollbar on the right.
  return { width: columns * 3 + 4, height: rows + 6 };
}

export function drawEmojiPicker(root: Surface, options: EmojiPickerOptions): EmojiPickerLayout {
  const theme = root.theme;
  const recent = options.recent ?? [];
  const columns = Math.max(4, Math.min(options.columns ?? 10, Math.floor((root.width - 4) / 3)));
  const rows = Math.max(2, Math.min(options.rows ?? 7, root.height - 6));
  const size = emojiPickerSize(columns, rows);
  const x = options.x ?? Math.max(0, Math.floor((root.width - size.width) / 2));
  const y = options.y ?? Math.max(0, Math.floor((root.height - size.height) / 2));
  const state = options.state;
  const items = emojiPickerItems(state, recent);

  const outer = root.sub(x, y, size.width, size.height);
  const inner = outer.box({ border: "rounded", borderColor: theme.borderFocused, bg: elevate(theme, 0.1), title: options.title ?? "Emoji" });
  const origin = inner.hitRect();
  const muted = mix(theme.foreground, theme.background, 0.45);

  // Search line.
  inner.text(1, 0, icon("search"), { fg: theme.accent });
  const query = state.query;
  inner.text(4, 0, truncate(query || "Search emoji", inner.width - 5), { fg: query ? theme.foreground : theme.muted });
  inner.styleRect(Math.min(4 + stringWidth(query), inner.width - 1), 0, 1, 1, { bg: theme.cursor, fg: theme.background });

  // Tabs, or the result count while searching.
  const tabs: EmojiPickerLayout["tabs"] = [];
  if (query.trim()) {
    inner.text(1, 1, `${items.length} result${items.length === 1 ? "" : "s"}`, { fg: theme.muted });
  } else {
    tabIds(recent).forEach((tab, i) => {
      const tx = 1 + i * 3;
      if (tx + 3 > inner.width) return;
      const active = tab === state.tab;
      const glyph = icon(tab === EMOJI_RECENT ? "clock" : GROUP_ICONS[tab] ?? "smile");
      if (active) inner.fillRect(tx, 1, 3, 1, { bg: theme.selection });
      inner.text(tx, 1, fit(glyph, 3, "center"), {
        fg: active ? theme.selectionText : muted,
        bg: active ? theme.selection : undefined,
        attrs: active ? Attr.Bold : 0,
      });
      tabs.push({ rect: { x: origin.x + tx, y: origin.y + 1, width: 3, height: 1 }, tab });
    });
  }
  inner.hline(0, 2, inner.width, "─", { fg: theme.border });

  // The grid.
  const gridTop = 3;
  if (items.length === 0) {
    const empty = query.trim() ? "No emoji match." : state.tab === EMOJI_RECENT ? "Nothing picked yet." : "";
    inner.text(Math.max(1, Math.floor((inner.width - stringWidth(empty)) / 2)), gridTop + 1, empty, { fg: theme.muted });
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = (state.offset + r) * columns + c;
      const e = items[i];
      if (!e) break;
      const cx = 1 + c * 3;
      if (i === state.index) inner.fillRect(cx, gridTop + r, 3, 1, { bg: theme.selection });
      inner.text(cx + 1, gridTop + r, e.char, { bg: i === state.index ? theme.selection : undefined });
    }
  }
  // A scroll hint when the list runs past the window.
  const totalRows = Math.ceil(items.length / columns);
  if (totalRows > rows) {
    const pos = Math.round((state.offset / Math.max(1, totalRows - rows)) * (rows - 1));
    for (let r = 0; r < rows; r++) inner.text(inner.width - 1, gridTop + r, r === pos ? "┃" : "│", { fg: r === pos ? theme.accent : theme.border });
  }

  // Footer: what Enter would pick.
  const current = items[state.index];
  const footerY = gridTop + rows;
  if (current) {
    const label = `:${current.shortcode.replace(/^oe_/, "")}:  ${current.name}`;
    inner.text(1, footerY, truncate(label, inner.width - 2), { fg: theme.muted });
  } else {
    inner.text(1, footerY, truncate("Tab: groups  Enter: pick  Esc: close", inner.width - 2), { fg: theme.muted });
  }

  return {
    box: outer.hitRect(),
    tabs,
    grid: { x: origin.x + 1, y: origin.y + gridTop, width: columns * 3, height: rows },
    columns,
    rows,
  };
}

/** The item index under a grid cell (relative coordinates), or -1. */
export function emojiPickerIndexAt(state: EmojiPickerState, layout: EmojiPickerLayout, x: number, y: number): number {
  const c = Math.floor(x / 3);
  const r = Math.floor(y);
  if (c < 0 || c >= layout.columns || r < 0 || r >= layout.rows) return -1;
  return (state.offset + r) * layout.columns + c;
}
