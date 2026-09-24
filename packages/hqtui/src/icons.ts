/**
 * Icons for terminals: `icon("mail")` is the best glyph this terminal can draw.
 *
 *   import { icon } from "@profullstack/hqtui";
 *   ui.text(`${icon("mail")} Inbox`);   // 󰇰 Inbox, ✉ Inbox, or @ Inbox
 *
 * The built-in pack is OpenIcon (https://logicsrc.com/openicon), on by
 * default: 370 icons, each with a Nerd Font glyph, a Unicode symbol and an
 * ASCII spelling. Which of the three you get:
 *
 *   1. setIconMode("nerd" | "unicode" | "ascii"), if the app chose;
 *   2. OPENICON_GLYPHS or HQTUI_ICONS in the environment;
 *   3. NERD_FONT=1 means Nerd Font glyphs;
 *   4. otherwise Unicode where the terminal draws it (the same detection the
 *      rest of hqtui uses), and ASCII where it does not.
 *
 * A Nerd Font is never assumed, because it cannot be detected from inside the
 * terminal: the font is the emulator's business, and a Nerd codepoint in a
 * plain font is a box. Say so with NERD_FONT=1 or setIconMode("nerd").
 *
 * An icon Nerd Fonts has no glyph for falls back to its Unicode symbol, and an
 * unknown name draws nothing rather than throwing mid-frame.
 */

import { detectCapabilities } from "./capabilities.ts";
import { OPENICON_ALIASES, OPENICON_GLYPHS, OPENICON_VERSION } from "./icons-data.ts";

export type IconMode = "nerd" | "unicode" | "ascii";

export interface IconGlyphs {
  /** The Nerd Font character; empty when Nerd Fonts has none for this icon. */
  nerd: string;
  unicode: string;
  ascii: string;
}

/** An icon pack: glyphs by key, plus aliases that resolve to a key. */
export interface IconPack {
  name: string;
  version: string;
  icons: ReadonlyMap<string, IconGlyphs>;
  aliases: ReadonlyMap<string, string>;
}

/** Build a pack from an OpenIcon `openicon.json`, for a set other than the built-in one. */
export function iconPackFrom(set: {
  name: string;
  version: string;
  icons: ReadonlyArray<{ key: string; aliases?: readonly string[]; tui: { nerd?: string; unicode: string; ascii: string } }>;
}): IconPack {
  const icons = new Map<string, IconGlyphs>();
  const aliases = new Map<string, string>();
  for (const i of set.icons) {
    icons.set(i.key, { nerd: i.tui.nerd ?? "", unicode: i.tui.unicode, ascii: i.tui.ascii });
    for (const a of i.aliases ?? []) aliases.set(a, i.key);
  }
  return { name: set.name, version: set.version, icons, aliases };
}

/** The built-in pack: OpenIcon. */
export const openIcon: IconPack = {
  name: "OpenIcon",
  version: OPENICON_VERSION,
  icons: new Map(OPENICON_GLYPHS.map(([key, nerd, unicode, ascii]) => [key, { nerd, unicode, ascii }])),
  aliases: new Map(OPENICON_ALIASES),
};

let pack: IconPack = openIcon;
let chosen: IconMode | undefined;
let detected: IconMode | undefined;

/** Swap the icon pack for the whole app. `useIconPack(openIcon)` restores the default. */
export function useIconPack(next: IconPack): void {
  pack = next;
}

export function currentIconPack(): IconPack {
  return pack;
}

/** Pin the glyph family for the whole app, or pass undefined to detect again. */
export function setIconMode(mode: IconMode | undefined): void {
  chosen = mode;
  detected = undefined;
}

const isMode = (value: string | undefined): value is IconMode =>
  value === "nerd" || value === "unicode" || value === "ascii";

/** Which glyph family this environment gets, following the order at the top of this file. */
export function iconMode(env: NodeJS.ProcessEnv = process.env): IconMode {
  if (chosen) return chosen;
  const named = env.OPENICON_GLYPHS || env.HQTUI_ICONS;
  if (isMode(named)) return named;
  if (env.NERD_FONT === "1" || env.NERD_FONTS === "1") return "nerd";
  return detectCapabilities({}, env).unicode ? "unicode" : "ascii";
}

/** The three glyphs of an icon, by key or alias, or undefined if the pack has no such icon. */
export function iconGlyphs(name: string): IconGlyphs | undefined {
  return pack.icons.get(name) ?? pack.icons.get(pack.aliases.get(name) ?? "");
}

export interface IconOptions {
  /** Override the app-wide mode for this one call. */
  mode?: IconMode;
}

/**
 * The best glyph for an icon: `icon("mail")`, `icon("email")` (an alias), or
 * `icon("github", { mode: "ascii" })`. Unknown names return "".
 */
export function icon(name: string, options: IconOptions = {}): string {
  const glyphs = iconGlyphs(name);
  if (!glyphs) return "";
  const mode = options.mode ?? chosen ?? (detected ??= iconMode());
  if (mode === "nerd") return glyphs.nerd || glyphs.unicode;
  return mode === "unicode" ? glyphs.unicode : glyphs.ascii;
}

/** Every key in the current pack, sorted. */
export function iconNames(): string[] {
  return [...pack.icons.keys()].sort();
}
