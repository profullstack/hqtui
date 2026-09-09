import type { Theme } from "@profullstack/hqtui";
import type { SystemSample } from "./system/index.ts";

export type ScreenName =
  | "dashboard" | "traffic" | "sessions" | "network" | "services"
  | "components" | "graphics" | "themes" | "input" | "stress" | "world";

export const SCREENS: ScreenName[] = [
  "dashboard", "traffic", "sessions", "network", "services",
  "components", "graphics", "themes", "input", "stress", "world",
];

/**
 * The key that jumps straight to each screen. Digits run out at ten, so the
 * eleventh takes a letter rather than a second "1" that would shadow the first.
 */
export const SCREEN_KEYS: Record<ScreenName, string> = {
  dashboard: "1", traffic: "2", sessions: "3", network: "4", services: "5",
  components: "6", graphics: "7", themes: "8", input: "9", stress: "0",
  world: "w",
};

export interface DemoState {
  sample: SystemSample;
  screen: ScreenName;
  source: string;
  unavailable: string[];
  /** Why hardware sensors are missing on this host, when they are. */
  sensorNote: string;
  /**
   * One cursor per scrollable pane, not per screen. Sharing a cursor across a
   * screen meant only one of its lists could ever be driven, so the second
   * scrollbar on a screen sat there doing nothing.
   */
  panes: Record<string, Pane>;
  /** Which pane the arrow keys drive, per screen. Clicking a pane sets it. */
  focused: Partial<Record<ScreenName, string>>;
  sort: "cpu" | "mem" | "pid" | "name";
  /**
   * Whether the [c] key has merged adjacent panel borders. Collapsing only
   * happens where two bordered siblings actually touch, so the screens read
   * this to lay out at a gap of zero; leaving them at one meant the key
   * toggled a flag that could never reach a seam and nothing moved.
   */
  collapsed: boolean;
  filter: string;
  filtering: boolean;
  showHelp: boolean;
  showPalette: boolean;
  showModal: boolean;
  paletteQuery: string;
  paletteIndex: number;
  themeIndex: number;
  /** Component-showcase interactive state. */
  /** The country under the pointer on the world map, by name; "" for open water. */
  worldHovered: string;
  /** Whether the world map is framed on the selection rather than the globe. */
  worldZoom: boolean;
  toggle: boolean;
  checkbox: boolean;
  selectOpen: boolean;
  selectIndex: number;
  slider: number;
  inputValue: string;
  lastKey: string;
  lastMouse: string;
  keyLog: string[];
  paused: boolean;
  fps: number;
  renderMs: number;
  changedCells: number;
  bytes: number;
}

/** The seam between panels: zero while collapsed, so their borders can merge. */
export function panelGap(state: DemoState): number {
  return state.collapsed ? 0 : 1;
}

export interface Pane {
  selected: number;
  offset: number;
  /** Row count, refreshed by the screen each frame so keys can clamp. */
  total: number;
  /**
   * A log has no selected row: the arrows move its window instead, and it
   * counts backwards from the newest line rather than forwards from the first.
   */
  kind: "list" | "log";
}

/**
 * The cursor for one scrollable, created on first use. Screens call this while
 * drawing, which is also what registers the pane as existing.
 */
export function pane(state: DemoState, id: string, total: number, kind: Pane["kind"] = "list"): Pane {
  const existing = state.panes[id];
  if (existing) {
    existing.total = total;
    return existing;
  }
  const created: Pane = { selected: 0, offset: 0, total, kind };
  state.panes[id] = created;
  // The first pane a screen draws is the one the arrows drive by default.
  if (!state.focused[state.screen]) state.focused[state.screen] = id;
  return created;
}

/** The pane the arrow keys act on, for the screen that is showing. */
export function focusedPane(state: DemoState): Pane | undefined {
  const id = state.focused[state.screen];
  return id ? state.panes[id] : undefined;
}

export function focusPane(state: DemoState, id: string): void {
  state.focused[state.screen] = id;
}

/** Move a pane's window, dragging the selection so it stays inside. */
export function scrollPane(p: Pane, delta: number, rows = 3): void {
  const max = Math.max(0, p.total - 1);
  p.offset = Math.max(0, Math.min(p.offset + delta * rows, max));
  if (p.kind !== "log") p.selected = Math.max(p.offset, Math.min(p.selected, max));
}

/**
 * What the arrow keys do to the focused pane. Lists move the selection and let
 * the widget scroll to follow it; logs have nothing to select, so they move
 * their own window.
 */
export function moveSelection(state: DemoState, delta: number): void {
  const p = focusedPane(state);
  if (!p || p.total === 0) return;
  if (p.kind === "log") {
    // Down means newer, which is a smaller distance from the end.
    p.offset = Math.max(0, Math.min(p.total - 1, p.offset - delta));
    return;
  }
  p.selected = Math.max(0, Math.min(p.total - 1, p.selected + delta));
  p.offset = Math.max(0, Math.min(p.offset, Math.max(0, p.total - 1)));
}

export function createState(
  sample: SystemSample,
  source: string,
  unavailable: string[],
  sensorNote = "",
): DemoState {
  return {
    sample,
    sensorNote,
    screen: "dashboard",
    source,
    unavailable,
    panes: {},
    focused: {},
    sort: "cpu",
    collapsed: false,
    worldHovered: "",
    worldZoom: false,
    filter: "",
    filtering: false,
    showHelp: false,
    showPalette: false,
    showModal: false,
    paletteQuery: "",
    paletteIndex: 0,
    themeIndex: 0,
    toggle: true,
    checkbox: true,
    selectOpen: false,
    selectIndex: 0,
    slider: 0.7,
    inputValue: "",
    lastKey: "—",
    lastMouse: "—",
    keyLog: [],
    paused: false,
    fps: 0,
    renderMs: 0,
    changedCells: 0,
    bytes: 0,
  };
}
