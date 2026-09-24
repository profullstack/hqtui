/**
 * Regenerate the built-in emoji pack from an OpenEmoji set.
 *
 *   node packages/hqtui/scripts/generate-emoji.ts [openemoji.json | URL]
 *
 * Defaults to the reference set's published manifest. Writes one table for the
 * TypeScript library and the Go, Python and Rust ports, so `emoji("fire")` is
 * the same answer in every language. Kept small on purpose: the character is
 * the key's codepoints, skin-tone variants are stored as key and base (their
 * names and shortcodes are derived), and keywords are cut to the ten rarest.
 * The artwork never ships in a terminal library; the art mode fetches it.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT = "https://logicsrc.com/openemoji/set/openemoji.json";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface Entry {
  key: string;
  name: string;
  group: string;
  unicode: string;
  keywords?: string[];
  shortcodes?: string[];
  base?: string;
}
interface Set {
  openemoji: string;
  name: string;
  version: string;
  unicode: string;
  emoji: Entry[];
}

/**
 * Names people already type, from Slack, GitHub and Discord, mapped to keys.
 * Every one is checked against the table below, so a typo fails generation.
 */
const ALIASES: Record<string, string> = {
  "+1": "1f44d", thumbsup: "1f44d", "-1": "1f44e", thumbsdown: "1f44e",
  heart: "2764-fe0f", broken_heart: "1f494", smile: "1f604", smiley: "1f603",
  grinning: "1f600", grin: "1f601", joy: "1f602", rofl: "1f923", laughing: "1f606",
  sweat_smile: "1f605", wink: "1f609", blush: "1f60a", heart_eyes: "1f60d",
  kissing_heart: "1f618", slightly_smiling_face: "1f642", upside_down_face: "1f643",
  thinking: "1f914", neutral_face: "1f610", unamused: "1f612", roll_eyes: "1f644",
  sob: "1f62d", cry: "1f622", angry: "1f620", rage: "1f621", scream: "1f631",
  sunglasses: "1f60e", stuck_out_tongue: "1f61b", hugs: "1f917", partying_face: "1f973",
  skull: "1f480", ghost: "1f47b", robot: "1f916", poop: "1f4a9", see_no_evil: "1f648",
  wave: "1f44b", clap: "1f44f", pray: "1f64f", raised_hands: "1f64c", ok_hand: "1f44c",
  muscle: "1f4aa", point_right: "1f449", point_left: "1f448", point_up: "261d-fe0f",
  point_down: "1f447", eyes: "1f440", shrug: "1f937", facepalm: "1f926",
  fire: "1f525", rocket: "1f680", tada: "1f389", sparkles: "2728", star: "2b50",
  "100": "1f4af", zap: "26a1", boom: "1f4a5", white_check_mark: "2705", check: "2705",
  x: "274c", warning: "26a0-fe0f", bug: "1f41b", bulb: "1f4a1", lock: "1f512",
  key: "1f511", mag: "1f50d", gear: "2699-fe0f", hammer: "1f528", wrench: "1f527",
  package: "1f4e6", email: "1f4e7", phone: "1f4de", link: "1f517", pushpin: "1f4cc",
  calendar: "1f4c5", memo: "1f4dd", computer: "1f4bb", coffee: "2615", beer: "1f37a",
  pizza: "1f355", cake: "1f382", gift: "1f381", moneybag: "1f4b0", chart: "1f4c8",
  sun: "2600-fe0f", moon: "1f319", cloud: "2601-fe0f", rainbow: "1f308",
  snowflake: "2744-fe0f", earth: "1f30d", globe: "1f310", cat: "1f431", dog: "1f436",
  hourglass: "231b", stopwatch: "23f1-fe0f", bell: "1f514", trophy: "1f3c6",
  us: "1f1fa-1f1f8", gb: "1f1ec-1f1e7", jp: "1f1ef-1f1f5",
};

/**
 * The ASCII faces a terminal without emoji shows instead. Anything not here
 * falls back to its name in brackets, [fire], which reads as well as any icon.
 */
const EMOTICONS: Record<string, string> = {
  "1f642": ":)", "263a-fe0f": ":)", "1f60a": "^_^", "1f641": ":(", "2639-fe0f": ":(",
  "1f600": ":D", "1f603": ":D", "1f604": ":D", "1f601": ":D", "1f602": "XD",
  "1f923": "XD", "1f606": "XD", "1f609": ";)", "1f61b": ":P", "1f61c": ";P",
  "1f61d": "XP", "1f62e": ":O", "1f62f": ":o", "1f632": ":O", "1f610": ":|",
  "1f611": "-_-", "1f615": ":/", "1f622": ":'(", "1f62d": ":'(", "1f620": ">:(",
  "1f621": ">:(", "1f60e": "B)", "1f618": ":*", "1f617": ":*", "1f607": "O:)",
  "1f608": ">:)", "1f643": "(:", "1f914": ":-?", "2764-fe0f": "<3", "1f494": "</3",
  "1f44d": "+1", "1f44e": "-1", "1f44b": "o/", "1f64c": "\\o/", "1f937": "\\_(o)_/",
  "2b50": "*", "2728": "*", "2705": "[x]", "274c": "[X]", "26a0-fe0f": "/!\\",
  "1f480": "x_x", "1f634": "-_-zZ",
};

const TONE_KEYS = ["1f3fb", "1f3fc", "1f3fd", "1f3fe", "1f3ff"];

/**
 * The shortcode most names reduce to, and that every port recomputes: lower
 * case, every run of anything but a-z and 0-9 an underscore. A row stores its
 * shortcode only when the set's differs (accents, &, #, skin tones).
 */
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Byte order, not locale order: the Rust port binary-searches these tables. */
const byteOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const source = process.argv[2] ?? DEFAULT;
const set: Set = source.startsWith("http")
  ? await (await fetch(source)).json()
  : JSON.parse(readFileSync(source, "utf8"));

const keys = new Set(set.emoji.map((e) => e.key));
const isTone = (e: Entry) => e.key.split("-").some((cp) => TONE_KEYS.includes(cp));
const shortOf = (e: Entry) => (e.shortcodes?.[0] ?? "").replace(/^oe_/, "");

// A variant is stored as [key, base] only when its base is in the table and
// its derived shortcode matches the set's; anything else is a full row.
const groups = [...new Set(set.emoji.map((e) => e.group))];
const byKey = new Map(set.emoji.map((e) => [e.key, e]));
const derivedShort = (e: Entry, base: Entry) =>
  [shortOf(base), ...e.key.split("-").filter((cp) => TONE_KEYS.includes(cp)).map((cp) => `t${TONE_KEYS.indexOf(cp) + 1}`)].join("_");
const keywordUse = new Map<string, number>();
for (const e of set.emoji) if (!isTone(e)) for (const k of e.keywords ?? []) keywordUse.set(k, (keywordUse.get(k) ?? 0) + 1);
const toned: Array<[string, string]> = [];
const rows: Array<[string, string, string, number, string]> = [];
for (const e of set.emoji) {
  if (!shortOf(e)) throw new Error(`${e.key} has no shortcode; regenerate the set with shortcodes`);
  const base = e.base ? byKey.get(e.base) : undefined;
  if (isTone(e) && base && !isTone(base) && derivedShort(e, base) === shortOf(e)) {
    toned.push([e.key, base.key]);
    continue;
  }
  // Keywords the name already says add nothing to a search, and neither do
  // ones on dozens of emoji (face, hand, person). Keep the ten rarest, which
  // is where the words people type live: lol, haha, yolo.
  const words = new Set(e.name.toLowerCase().split(/[^a-z0-9]+/));
  const keywords = (e.keywords ?? [])
    .filter((k) => !words.has(k.toLowerCase()) && (keywordUse.get(k) ?? 0) <= 30)
    .sort((a, b) => (keywordUse.get(a) ?? 0) - (keywordUse.get(b) ?? 0))
    .slice(0, 10)
    .join(" ");
  const short = shortOf(e) === slug(e.name) ? "" : shortOf(e);
  rows.push([e.key, short, e.name, groups.indexOf(e.group), keywords]);
}
rows.sort((a, b) => byteOrder(a[0], b[0]));
toned.sort((a, b) => byteOrder(a[0], b[0]));
for (const [alias, key] of Object.entries(ALIASES)) {
  if (!keys.has(key)) throw new Error(`alias ${alias} points at ${key}, which the set does not have`);
}
for (const key of Object.keys(EMOTICONS)) {
  if (!keys.has(key)) throw new Error(`emoticon for ${key}, which the set does not have`);
}
const aliases = Object.entries(ALIASES).sort((a, b) => byteOrder(a[0], b[0]));
const emoticons = Object.entries(EMOTICONS).sort((a, b) => byteOrder(a[0], b[0]));
const stamp = `${set.name} ${set.version} (OpenEmoji ${set.openemoji}, Unicode ${set.unicode}), ${set.emoji.length} emoji`;

/** A string literal every one of the four languages reads the same way. */
let escapeFor = (ch: string) => `\\u{${ch.codePointAt(0)!.toString(16)}}`;
const lit = (s: string) =>
  `"${[...s]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      if (ch === '"' || ch === "\\") return `\\${ch}`;
      return cp >= 0x20 && cp < 0x7f ? ch : escapeFor(ch);
    })
    .join("")}"`;

function write(rel: string, text: string) {
  writeFileSync(join(root, rel), text);
  console.log(`wrote ${rel} (${(Buffer.byteLength(text) / 1024).toFixed(0)} KB)`);
}

const header = (c: string) =>
  `${c} Generated by packages/hqtui/scripts/generate-emoji.ts from ${stamp}. Do not edit.
${c} Emoji rows: key (codepoints), shortcode without oe_ (empty when it is the name in snake_case),
${c} CLDR name, group index, up to ten of its rarest keywords the name does not already say.
${c} Toned rows: key and base key; name and shortcode are the base's plus the skin tones.`;

// TypeScript
escapeFor = (ch) => `\\u{${ch.codePointAt(0)!.toString(16)}}`;
write(
  "packages/hqtui/src/emoji-data.ts",
  `${header("//")}

export const OPENEMOJI_VERSION = ${lit(set.version)};
export const OPENEMOJI_UNICODE = ${lit(set.unicode)};

export const OPENEMOJI_GROUPS: readonly string[] = [${groups.map(lit).join(", ")}];

export const OPENEMOJI_ROWS: ReadonlyArray<readonly [string, string, string, number, string]> = [
${rows.map(([k, s, n, g, kw]) => `  [${lit(k)}, ${lit(s)}, ${lit(n)}, ${g}, ${lit(kw)}],`).join("\n")}
];

export const OPENEMOJI_TONED: ReadonlyArray<readonly [string, string]> = [
${toned.map((t) => `  [${t.map(lit).join(", ")}],`).join("\n")}
];

export const OPENEMOJI_ALIASES: ReadonlyArray<readonly [string, string]> = [
${aliases.map((a) => `  [${a.map(lit).join(", ")}],`).join("\n")}
];

export const OPENEMOJI_EMOTICONS: ReadonlyArray<readonly [string, string]> = [
${emoticons.map((a) => `  [${a.map(lit).join(", ")}],`).join("\n")}
];
`,
);

// Go
escapeFor = (ch) => `\\U${ch.codePointAt(0)!.toString(16).padStart(8, "0")}`;
write(
  "ports/go/emoji_data.go",
  `${header("//").replace("// Generated", "// Code generated").replace("Do not edit.", "DO NOT EDIT.")}

package hqtui

// OpenEmojiVersion is the OpenEmoji set the built-in pack was generated from.
const OpenEmojiVersion = ${lit(set.version)}

// OpenEmojiUnicode is the Emoji version that set covers.
const OpenEmojiUnicode = ${lit(set.unicode)}

var openEmojiGroups = []string{${groups.map(lit).join(", ")}}

type emojiRow struct {
	key, short, name string
	group            int
	keywords         string
}

var openEmojiRows = []emojiRow{
${rows.map(([k, s, n, g, kw]) => `\t{${lit(k)}, ${lit(s)}, ${lit(n)}, ${g}, ${lit(kw)}},`).join("\n")}
}

var openEmojiToned = [][2]string{
${toned.map((t) => `\t{${t.map(lit).join(", ")}},`).join("\n")}
}

var openEmojiAliases = map[string]string{
${aliases.map(([a, k]) => `\t${lit(a)}: ${lit(k)},`).join("\n")}
}

var openEmojiEmoticons = map[string]string{
${emoticons.map(([a, k]) => `\t${lit(a)}: ${lit(k)},`).join("\n")}
}
`,
);
spawnSync("gofmt", ["-w", join(root, "ports/go/emoji_data.go")], { stdio: "ignore" });

// Python
escapeFor = (ch) => `\\U${ch.codePointAt(0)!.toString(16).padStart(8, "0")}`;
write(
  "ports/python/hqtui/emoji_data.py",
  `${header("#")}

OPENEMOJI_VERSION = ${lit(set.version)}
OPENEMOJI_UNICODE = ${lit(set.unicode)}

OPENEMOJI_GROUPS = (${groups.map(lit).join(", ")})

OPENEMOJI_ROWS = (
${rows.map(([k, s, n, g, kw]) => `    (${lit(k)}, ${lit(s)}, ${lit(n)}, ${g}, ${lit(kw)}),`).join("\n")}
)

OPENEMOJI_TONED = (
${toned.map((t) => `    (${t.map(lit).join(", ")}),`).join("\n")}
)

OPENEMOJI_ALIASES = {
${aliases.map(([a, k]) => `    ${lit(a)}: ${lit(k)},`).join("\n")}
}

OPENEMOJI_EMOTICONS = {
${emoticons.map(([a, k]) => `    ${lit(a)}: ${lit(k)},`).join("\n")}
}
`,
);

// Rust
escapeFor = (ch) => `\\u{${ch.codePointAt(0)!.toString(16)}}`;
write(
  "ports/rust/src/emoji_data.rs",
  `${header("//")}

/// The OpenEmoji set the built-in pack was generated from.
pub const OPENEMOJI_VERSION: &str = ${lit(set.version)};
/// The Emoji version that set covers.
pub const OPENEMOJI_UNICODE: &str = ${lit(set.unicode)};

pub static OPENEMOJI_GROUPS: &[&str] = &[${groups.map(lit).join(", ")}];

/// (key, shortcode without oe_, name, group index, keywords), sorted by key.
pub static OPENEMOJI_ROWS: &[(&str, &str, &str, usize, &str)] = &[
${rows.map(([k, s, n, g, kw]) => `    (${lit(k)}, ${lit(s)}, ${lit(n)}, ${g}, ${lit(kw)}),`).join("\n")}
];

/// (key, base key), sorted by key.
pub static OPENEMOJI_TONED: &[(&str, &str)] = &[
${toned.map((t) => `    (${t.map(lit).join(", ")}),`).join("\n")}
];

/// Sorted by alias.
pub static OPENEMOJI_ALIASES: &[(&str, &str)] = &[
${aliases.map((a) => `    (${a.map(lit).join(", ")}),`).join("\n")}
];

/// Sorted by key.
pub static OPENEMOJI_EMOTICONS: &[(&str, &str)] = &[
${emoticons.map((a) => `    (${a.map(lit).join(", ")}),`).join("\n")}
];
`,
);

console.log(`${rows.length} rows, ${toned.length} toned, ${aliases.length} aliases, ${emoticons.length} emoticons`);
