import { type Color, hex, mix, gradient } from "./color.ts";

/**
 * A theme is flat and small on purpose: every token here is one a widget
 * actually reaches for. Anything deeper is computed, not configured.
 */
export interface Theme {
  name: string;
  /** True for palettes designed against a dark terminal background. */
  dark: boolean;

  background: Color;
  /** Panel interiors, lifted slightly off the page. */
  surface: Color;
  foreground: Color;
  muted: Color;

  primary: Color;
  secondary: Color;
  accent: Color;

  success: Color;
  warning: Color;
  danger: Color;
  info: Color;

  border: Color;
  borderFocused: Color;
  title: Color;

  selection: Color;
  selectionText: Color;
  cursor: Color;

  /** Series colors for multi-line graphs, in draw order. */
  graph: Color[];
  /** Low-to-high ramp for gauges, meters and heat bars. */
  heat: Color[];
}

const DARK: Theme = {
  name: "dark",
  dark: true,
  background: hex("#05070a"),
  surface: hex("#0a0e14"),
  foreground: hex("#c6d0db"),
  muted: hex("#5a6b7d"),
  primary: hex("#58a6ff"),
  secondary: hex("#bd93f9"),
  accent: hex("#56d4dd"),
  success: hex("#5fff87"),
  warning: hex("#ffd75f"),
  danger: hex("#ff6b6b"),
  info: hex("#56d4dd"),
  border: hex("#243040"),
  borderFocused: hex("#56d4dd"),
  title: hex("#7ee2ff"),
  selection: hex("#1d3a52"),
  selectionText: hex("#e6f2ff"),
  cursor: hex("#56d4dd"),
  graph: [hex("#58a6ff"), hex("#5fff87"), hex("#ff79c6"), hex("#ffd75f"), hex("#56d4dd"), hex("#ffa657")],
  heat: [hex("#5fff87"), hex("#a8ff60"), hex("#ffd75f"), hex("#ffa657"), hex("#ff6b6b")],
};

function variant(base: Theme, overrides: Partial<Theme>): Theme {
  return { ...base, ...overrides };
}

const DRACULA = variant(DARK, {
  name: "dracula",
  background: hex("#191a21"),
  surface: hex("#21222c"),
  foreground: hex("#f8f8f2"),
  muted: hex("#6272a4"),
  primary: hex("#bd93f9"),
  secondary: hex("#ff79c6"),
  accent: hex("#8be9fd"),
  success: hex("#50fa7b"),
  warning: hex("#f1fa8c"),
  danger: hex("#ff5555"),
  info: hex("#8be9fd"),
  border: hex("#44475a"),
  borderFocused: hex("#bd93f9"),
  title: hex("#ff79c6"),
  selection: hex("#44475a"),
  selectionText: hex("#f8f8f2"),
  graph: [hex("#bd93f9"), hex("#50fa7b"), hex("#ff79c6"), hex("#f1fa8c"), hex("#8be9fd"), hex("#ffb86c")],
  heat: [hex("#50fa7b"), hex("#f1fa8c"), hex("#ffb86c"), hex("#ff5555")],
});

const NORD = variant(DARK, {
  name: "nord",
  background: hex("#2e3440"),
  surface: hex("#333b4a"),
  foreground: hex("#e5e9f0"),
  muted: hex("#7b88a1"),
  primary: hex("#88c0d0"),
  secondary: hex("#b48ead"),
  accent: hex("#8fbcbb"),
  success: hex("#a3be8c"),
  warning: hex("#ebcb8b"),
  danger: hex("#bf616a"),
  info: hex("#81a1c1"),
  border: hex("#434c5e"),
  borderFocused: hex("#88c0d0"),
  title: hex("#8fbcbb"),
  selection: hex("#434c5e"),
  selectionText: hex("#eceff4"),
  graph: [hex("#88c0d0"), hex("#a3be8c"), hex("#b48ead"), hex("#ebcb8b"), hex("#81a1c1"), hex("#d08770")],
  heat: [hex("#a3be8c"), hex("#ebcb8b"), hex("#d08770"), hex("#bf616a")],
});

const TOKYO_NIGHT = variant(DARK, {
  name: "tokyo-night",
  background: hex("#1a1b26"),
  surface: hex("#1f2335"),
  foreground: hex("#c0caf5"),
  muted: hex("#565f89"),
  primary: hex("#7aa2f7"),
  secondary: hex("#bb9af7"),
  accent: hex("#7dcfff"),
  success: hex("#9ece6a"),
  warning: hex("#e0af68"),
  danger: hex("#f7768e"),
  info: hex("#7dcfff"),
  border: hex("#2f3549"),
  borderFocused: hex("#7aa2f7"),
  title: hex("#7dcfff"),
  selection: hex("#283457"),
  selectionText: hex("#c0caf5"),
  graph: [hex("#7aa2f7"), hex("#9ece6a"), hex("#bb9af7"), hex("#e0af68"), hex("#7dcfff"), hex("#ff9e64")],
  heat: [hex("#9ece6a"), hex("#e0af68"), hex("#ff9e64"), hex("#f7768e")],
});

const GRUVBOX = variant(DARK, {
  name: "gruvbox",
  background: hex("#1d2021"),
  surface: hex("#282828"),
  foreground: hex("#ebdbb2"),
  muted: hex("#928374"),
  primary: hex("#83a598"),
  secondary: hex("#d3869b"),
  accent: hex("#8ec07c"),
  success: hex("#b8bb26"),
  warning: hex("#fabd2f"),
  danger: hex("#fb4934"),
  info: hex("#83a598"),
  border: hex("#3c3836"),
  borderFocused: hex("#fabd2f"),
  title: hex("#fabd2f"),
  selection: hex("#3c3836"),
  selectionText: hex("#fbf1c7"),
  graph: [hex("#83a598"), hex("#b8bb26"), hex("#d3869b"), hex("#fabd2f"), hex("#8ec07c"), hex("#fe8019")],
  heat: [hex("#b8bb26"), hex("#fabd2f"), hex("#fe8019"), hex("#fb4934")],
});

const MATRIX = variant(DARK, {
  name: "matrix",
  background: hex("#000000"),
  surface: hex("#020a02"),
  foreground: hex("#9dff9d"),
  muted: hex("#2f6b2f"),
  primary: hex("#00ff41"),
  secondary: hex("#00c853"),
  accent: hex("#7cff7c"),
  success: hex("#00ff41"),
  warning: hex("#d4ff00"),
  danger: hex("#ff3b30"),
  info: hex("#00e5b0"),
  border: hex("#12401f"),
  borderFocused: hex("#00ff41"),
  title: hex("#00ff41"),
  selection: hex("#0d2f14"),
  selectionText: hex("#c9ffc9"),
  graph: [hex("#00ff41"), hex("#00c853"), hex("#7cff7c"), hex("#00e5b0"), hex("#d4ff00"), hex("#2f9e44")],
  heat: [hex("#0f7a2e"), hex("#00c853"), hex("#00ff41"), hex("#d4ff00")],
});

const MONOCHROME = variant(DARK, {
  name: "monochrome",
  background: hex("#000000"),
  surface: hex("#0b0b0b"),
  foreground: hex("#d0d0d0"),
  muted: hex("#6e6e6e"),
  primary: hex("#ffffff"),
  secondary: hex("#c0c0c0"),
  accent: hex("#e0e0e0"),
  success: hex("#e8e8e8"),
  warning: hex("#b8b8b8"),
  danger: hex("#ffffff"),
  info: hex("#a0a0a0"),
  border: hex("#3a3a3a"),
  borderFocused: hex("#d0d0d0"),
  title: hex("#ffffff"),
  selection: hex("#303030"),
  selectionText: hex("#ffffff"),
  graph: [hex("#ffffff"), hex("#c8c8c8"), hex("#909090"), hex("#686868"), hex("#b0b0b0"), hex("#808080")],
  heat: [hex("#585858"), hex("#909090"), hex("#c8c8c8"), hex("#ffffff")],
});

const HIGH_CONTRAST = variant(DARK, {
  name: "high-contrast",
  background: hex("#000000"),
  surface: hex("#000000"),
  foreground: hex("#ffffff"),
  muted: hex("#c0c0c0"),
  primary: hex("#00ffff"),
  secondary: hex("#ff00ff"),
  accent: hex("#ffff00"),
  success: hex("#00ff00"),
  warning: hex("#ffff00"),
  danger: hex("#ff0000"),
  info: hex("#00ffff"),
  border: hex("#ffffff"),
  borderFocused: hex("#ffff00"),
  title: hex("#ffffff"),
  selection: hex("#ffffff"),
  selectionText: hex("#000000"),
  graph: [hex("#00ffff"), hex("#00ff00"), hex("#ff00ff"), hex("#ffff00"), hex("#ffffff"), hex("#ff8000")],
  heat: [hex("#00ff00"), hex("#ffff00"), hex("#ff8000"), hex("#ff0000")],
});

const LIGHT: Theme = {
  name: "light",
  dark: false,
  background: hex("#fbfcfd"),
  surface: hex("#ffffff"),
  foreground: hex("#1c2530"),
  muted: hex("#6b7a8c"),
  primary: hex("#0b62d0"),
  secondary: hex("#7c3aed"),
  accent: hex("#0e7490"),
  success: hex("#128a3f"),
  warning: hex("#a86a00"),
  danger: hex("#c62828"),
  info: hex("#0e7490"),
  border: hex("#d3dbe4"),
  borderFocused: hex("#0b62d0"),
  title: hex("#0b3d78"),
  selection: hex("#d6e6fb"),
  selectionText: hex("#0b2545"),
  cursor: hex("#0b62d0"),
  graph: [hex("#0b62d0"), hex("#128a3f"), hex("#a3348a"), hex("#a86a00"), hex("#0e7490"), hex("#c2410c")],
  heat: [hex("#128a3f"), hex("#7aa300"), hex("#a86a00"), hex("#c2410c"), hex("#c62828")],
};

/** Built-in themes. `themes.dark` is the default and needs no configuration. */
export const themes = {
  dark: DARK,
  dracula: DRACULA,
  nord: NORD,
  tokyoNight: TOKYO_NIGHT,
  gruvbox: GRUVBOX,
  matrix: MATRIX,
  monochrome: MONOCHROME,
  highContrast: HIGH_CONTRAST,
  light: LIGHT,
} as const;

export type ThemeName = keyof typeof themes;

export const themeList: Theme[] = Object.values(themes);

/** Build a theme by overriding a base (dark unless you say otherwise). */
export function defineTheme(overrides: Partial<Theme> & { name?: string }, base: Theme = DARK): Theme {
  return { ...base, ...overrides, name: overrides.name ?? `${base.name}-custom` };
}

export function resolveTheme(theme: Theme | ThemeName | string | undefined): Theme {
  if (!theme) return DARK;
  if (typeof theme !== "string") return theme;
  const direct = (themes as Record<string, Theme>)[theme];
  if (direct) return direct;
  const found = themeList.find((t) => t.name === theme);
  return found ?? DARK;
}

/** A slightly lifted or dropped shade of the surface, for zebra rows and tracks. */
export function elevate(theme: Theme, amount = 0.06): Color {
  return mix(theme.surface, theme.dark ? hex("#ffffff") : hex("#000000"), amount);
}

/** Color a 0-1 ratio along the theme's heat ramp: green when idle, red when hot. */
export function heatColor(theme: Theme, ratio: number): Color {
  return gradient(theme.heat)(ratio);
}

/** The nth series color, wrapping around. */
export function seriesColor(theme: Theme, index: number): Color {
  return theme.graph[((index % theme.graph.length) + theme.graph.length) % theme.graph.length];
}
