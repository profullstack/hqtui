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
  /** Selected process row. */
  selected: number;
  offset: number;
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
    selected: 0,
    offset: 0,
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
