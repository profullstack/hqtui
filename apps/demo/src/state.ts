import type { Theme } from "@profullstack/hqtui";
import type { SystemSample } from "./system/index.ts";

export type ScreenName =
  | "dashboard" | "traffic" | "sessions" | "network" | "services"
  | "components" | "graphics" | "themes" | "input" | "stress";

export const SCREENS: ScreenName[] = [
  "dashboard", "traffic", "sessions", "network", "services",
  "components", "graphics", "themes", "input", "stress",
];

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
  filter: string;
  filtering: boolean;
  showHelp: boolean;
  showPalette: boolean;
  showModal: boolean;
  paletteQuery: string;
  paletteIndex: number;
  themeIndex: number;
  /** Component-showcase interactive state. */
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

export interface Pane {
  selected: number;
  offset: number;
  /** Row count, refreshed by the screen each frame so keys can clamp. */
  total: number;
}

/**
 * The cursor for one scrollable, created on first use. Screens call this while
 * drawing, which is also what registers the pane as existing.
 */
export function pane(state: DemoState, id: string, total: number): Pane {
  const existing = state.panes[id];
  if (existing) {
    existing.total = total;
    return existing;
  }
  const created: Pane = { selected: 0, offset: 0, total };
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
  p.selected = Math.max(p.offset, Math.min(p.selected, max));
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
