/**
 * Emoji for terminals: `emoji("fire")` is 🔥 where the terminal draws emoji,
 * and `[fire]` where it cannot.
 *
 *   import { emoji, emojify } from "@profullstack/hqtui";
 *   ui.text(`${emoji("rocket")} shipped`);          // 🚀 shipped
 *   ui.text(emojify("deploy :tada: :+1:"));         // deploy 🎉 👍
 *
 * The built-in pack is OpenEmoji (https://logicsrc.com/openemoji), on by
 * default: every fully-qualified emoji in Unicode's list, with its CLDR name,
 * its `oe_` shortcode and a few keywords. A name can be the shortcode with or
 * without `oe_` and colons, the CLDR name, a common alias (`thumbsup`, `+1`,
 * `heart`), or the emoji itself.
 *
 * Which you get:
 *
 *   1. setEmojiMode("emoji" | "text"), if the app chose;
 *   2. HQTUI_EMOJI=emoji|text in the environment;
 *   3. otherwise emoji where the terminal draws Unicode (the same detection the
 *      rest of hqtui uses) and is not the Linux console, and text elsewhere.
 *
 * Text is an emoticon where one fits (`:)`, `<3`, `:D`) and the name in
 * brackets where none does, `[fire]`. An unknown name draws nothing rather
 * than throwing mid-frame. Widths are handled by stringWidth, which counts
 * every emoji here (skin tones, flags, keycaps, ZWJ sequences) as two columns.
 */

import { detectCapabilities } from "./capabilities.ts";
import {
  OPENEMOJI_ALIASES, OPENEMOJI_EMOTICONS, OPENEMOJI_GROUPS, OPENEMOJI_ROWS, OPENEMOJI_TONED,
  OPENEMOJI_UNICODE, OPENEMOJI_VERSION,
} from "./emoji-data.ts";
import { stringWidth } from "./unicode.ts";

export type EmojiMode = "emoji" | "text";

export interface EmojiInfo {
  /** Fully-qualified codepoints, lowercase hex, hyphen-joined: the OpenEmoji key. */
  key: string;
  char: string;
  /** The CLDR short name. */
  name: string;
  /** The set's shortcode, `oe_` included. */
  shortcode: string;
  group: string;
  keywords: string[];
  /** The toneless emoji a skin-tone variant belongs to. */
  base?: string;
}

const TONES = ["1f3fb", "1f3fc", "1f3fd", "1f3fe", "1f3ff"];
const TONE_NAMES = ["light", "medium-light", "medium", "medium-dark", "dark"];

/** The shortcode a name reduces to; rows store theirs only when it differs. */
export const slugOf = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const charOf = (key: string): string => String.fromCodePoint(...key.split("-").map((h) => Number.parseInt(h, 16)));

interface Table {
  byKey: Map<string, EmojiInfo>;
  byName: Map<string, string>;
  byChar: Map<string, string>;
  all: EmojiInfo[];
}

let table: Table | undefined;

/** Built on first use: importing hqtui costs nothing until someone asks for an emoji. */
function load(): Table {
  if (table) return table;
  const byKey = new Map<string, EmojiInfo>();
  for (const [key, short, name, group, keywords] of OPENEMOJI_ROWS) {
    byKey.set(key, {
      key,
      char: charOf(key),
      name,
      shortcode: `oe_${short || slugOf(name)}`,
      group: OPENEMOJI_GROUPS[group] ?? "",
      keywords: keywords ? keywords.split(" ") : [],
    });
  }
  for (const [key, baseKey] of OPENEMOJI_TONED) {
    const base = byKey.get(baseKey);
    if (!base) continue;
    const tones = key.split("-").filter((cp) => TONES.includes(cp)).map((cp) => TONES.indexOf(cp));
    const toneNames = tones.map((t) => `${TONE_NAMES[t]} skin tone`).join(", ");
    byKey.set(key, {
      key,
      char: charOf(key),
      name: `${base.name}${base.name.includes(":") ? ", " : ": "}${toneNames}`,
      shortcode: `${base.shortcode}_${tones.map((t) => `t${t + 1}`).join("_")}`,
      group: base.group,
      keywords: base.keywords,
      base: baseKey,
    });
  }
  const byName = new Map<string, string>();
  const byChar = new Map<string, string>();
  const all = [...byKey.values()];
  for (const e of all) {
    byName.set(e.shortcode, e.key);
    byName.set(e.shortcode.slice(3), e.key);
    byName.set(e.name.toLowerCase(), e.key);
    byChar.set(e.char, e.key);
    byChar.set(e.char.replace(/️/g, ""), e.key);
  }
  // Aliases last, but never over a real name: `x` is an alias for ❌ and must
  // not hide anything the set itself calls x.
  for (const [alias, key] of OPENEMOJI_ALIASES) if (!byName.has(alias)) byName.set(alias, key);
  table = { byKey, byName, byChar, all };
  return table;
}

/** Everything known about an emoji, by any name it answers to, or undefined. */
export function emojiInfo(name: string): EmojiInfo | undefined {
  const t = load();
  const trimmed = name.trim();
  const bare = trimmed.replace(/^:|:$/g, "").toLowerCase();
  const key =
    t.byName.get(bare) ?? t.byName.get(bare.replace(/[\s-]+/g, "_")) ?? t.byChar.get(trimmed) ??
    t.byChar.get(trimmed.replace(/️/g, "")) ?? (t.byKey.has(bare) ? bare : undefined);
  return key ? t.byKey.get(key) : undefined;
}

let chosen: EmojiMode | undefined;
let detected: EmojiMode | undefined;

/** Pin emoji or text for the whole app, or pass undefined to detect again. */
export function setEmojiMode(mode: EmojiMode | undefined): void {
  chosen = mode;
  detected = undefined;
}

/** Which this environment gets, following the order at the top of this file. */
export function emojiMode(env: NodeJS.ProcessEnv = process.env): EmojiMode {
  if (chosen) return chosen;
  const named = env.HQTUI_EMOJI;
  if (named === "emoji" || named === "text") return named;
  // The Linux virtual console speaks UTF-8 but its font has no emoji.
  if (env.TERM === "linux") return "text";
  return detectCapabilities({}, env).unicode ? "emoji" : "text";
}

const emoticons = new Map(OPENEMOJI_EMOTICONS);

/** The text an emoji is when a terminal cannot draw it: an emoticon, or its name in brackets. */
export function emojiText(name: string): string {
  const info = emojiInfo(name);
  if (!info) return "";
  return emoticons.get(info.key) ?? emoticons.get(info.base ?? "") ?? `[${info.name}]`;
}

export interface EmojiOptions {
  /** Override the app-wide mode for this one call. */
  mode?: EmojiMode;
}

/**
 * The emoji, or its text where the terminal cannot draw it: `emoji("fire")`,
 * `emoji(":oe_fire:")`, `emoji("thumbsup")`, `emoji("face with tears of joy")`.
 * Unknown names return "".
 */
export function emoji(name: string, options: EmojiOptions = {}): string {
  const info = emojiInfo(name);
  if (!info) return "";
  const mode = options.mode ?? chosen ?? (detected ??= emojiMode());
  return mode === "emoji" ? info.char : emojiText(info.key);
}

/**
 * Replace every `:name:` in a string with its emoji (or text): `:fire:`,
 * `:oe_fire:`, `:+1:`, `:thumbs_up_t3:`. Anything between colons that is not
 * an emoji is left exactly as it was, so `12:30:00` survives.
 */
export function emojify(text: string, options: EmojiOptions = {}): string {
  return text.replace(/:([a-z0-9_+-]+):/gi, (whole, name: string) => emoji(name, options) || whole);
}

/**
 * Emoji whose name, shortcode or keywords match every word of the query, best
 * first: the exact emoji, then names with the query as a whole word (flag:
 * Japan for "japan"), then names starting with it, then the rest.
 */
export function emojiSearch(query: string, limit = 20): EmojiInfo[] {
  const t = load();
  const q = query.trim().toLowerCase().replace(/^:|:$/g, "");
  if (!q) return [];
  const words = q.split(/[\s_]+/).filter(Boolean);
  const exact = emojiInfo(q);
  const scored: Array<[number, EmojiInfo]> = [];
  for (const e of t.all) {
    if (e.base) continue;
    const hay = `${e.name} ${e.shortcode} ${e.keywords.join(" ")}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const name = e.name.toLowerCase();
    const score =
      e.key === exact?.key ? 0
      : name.split(/[^a-z0-9]+/).includes(q) ? 1
      : name.startsWith(q) ? 2
      : name.includes(q) ? 3
      : 4;
    scored.push([score, e]);
  }
  if (exact && !exact.base && !scored.some(([, e]) => e.key === exact.key)) scored.push([0, exact]);
  return scored.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length).slice(0, limit).map(([, e]) => e);
}

/** Every shortcode in the set, sorted. */
export function emojiNames(): string[] {
  return load().all.map((e) => e.shortcode).sort();
}

/** Columns a string with emoji in it occupies: the same count the renderer uses. */
export const emojiWidth = (text: string): number => stringWidth(text);

/** Which OpenEmoji set and Emoji version the built-in pack was generated from. */
export const openEmoji = { name: "OpenEmoji", version: OPENEMOJI_VERSION, unicode: OPENEMOJI_UNICODE } as const;
