/**
 * Our emoji font in the terminal: `hqtui fonts install`.
 *
 * A TUI draws characters; the terminal picks the font. So the only way to see
 * OpenEmoji's artwork in plain text is to install the font where the terminal
 * looks and make it the emoji fallback. That changes the user's machine, so it
 * happens only on this explicit command (never on import, never on first run),
 * and `hqtui fonts remove` undoes all of it.
 *
 *   Linux   the CBDT colour font into ~/.local/share/fonts, a fontconfig rule
 *           preferring it for emoji (~/.config/fontconfig/conf.d/60-openemoji.conf),
 *           then fc-cache. Alacritty, foot, GNOME Terminal, Konsole and every
 *           other fontconfig terminal follow it; Kitty and WezTerm get snippets.
 *   macOS   the sbix font into ~/Library/Fonts. Terminal.app always draws emoji
 *           with Apple Color Emoji and cannot be told otherwise; Kitty, WezTerm
 *           and iTerm2 can, and get snippets.
 *
 * Every file it edits is backed up first as <name>.bak-001.<ext> (the next
 * free number) in ~/.config/hqtui/backups, outside conf.d, where fontconfig
 * would otherwise load a backup as a second rule. What it wrote is recorded in
 * ~/.config/hqtui/openemoji-font.json, which is what `remove` reads.
 */

// Node's filesystem and process modules are loaded inside the functions that
// use them, so importing hqtui (which re-exports these) stays side-effect free
// and safe in a browser bundle.
type Fs = typeof import("node:fs/promises");
const loadFs = (): Promise<Fs> => import("node:fs/promises");

const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");
const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
const extOf = (path: string) => /\.[^./]*$/.exec(path)?.[0] ?? "";
const baseOf = (path: string, ext = "") => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
};

export const FONT_FAMILY = "OpenEmoji";
export const FONT_RELEASE = "https://github.com/profullstack/openemoji/releases/latest/download";
export const FONT_RAW = "https://raw.githubusercontent.com/profullstack/openemoji/main/font";

/** Emoji blocks for terminals that map by codepoint (Kitty's symbol_map, WezTerm). */
export const EMOJI_RANGES = [
  "U+1F300-U+1F5FF", "U+1F600-U+1F64F", "U+1F680-U+1F6FF", "U+1F900-U+1F9FF",
  "U+1FA70-U+1FAFF", "U+2600-U+27BF", "U+1F1E6-U+1F1FF", "U+2B00-U+2BFF",
];

export type Run = (command: string, args: string[]) => { status: number | null; stdout: string };

export interface FontEnv {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  run?: Run;
  log?: (line: string) => void;
}

interface Resolved {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  run: Run;
  log: (line: string) => void;
}

async function resolve(o: FontEnv): Promise<Resolved> {
  let run = o.run;
  if (!run) {
    const { spawnSync } = await import("node:child_process");
    run = (command, args) => {
      const r = spawnSync(command, args, { encoding: "utf8" });
      return { status: r.error ? null : r.status, stdout: r.stdout ?? "" };
    };
  }
  let home = o.home;
  if (!home) home = (await import("node:os")).homedir();
  return {
    platform: o.platform ?? process.platform,
    home,
    env: o.env ?? process.env,
    fetch: o.fetch ?? fetch,
    run,
    log: o.log ?? ((line) => console.log(line)),
  };
}

/** The font files a platform uses: CBDT where fontconfig reads it, sbix on Apple. */
export function fontFiles(platform: NodeJS.Platform): string[] {
  return platform === "darwin" ? [`${FONT_FAMILY}-sbix.ttf`] : [`${FONT_FAMILY}-CBDT.ttf`];
}

export function fontDir(r: Pick<Resolved, "platform" | "home" | "env">): string {
  if (r.platform === "darwin") return join(r.home, "Library", "Fonts");
  return join(r.env.XDG_DATA_HOME || join(r.home, ".local", "share"), "fonts");
}

const configDir = (r: Pick<Resolved, "home" | "env">) => r.env.XDG_CONFIG_HOME || join(r.home, ".config");
const fontconfigFile = (r: Pick<Resolved, "home" | "env">) =>
  join(configDir(r), "fontconfig", "conf.d", "60-openemoji.conf");
const recordFile = (r: Pick<Resolved, "home" | "env">) => join(configDir(r), "hqtui", "openemoji-font.json");
const backupDir = (r: Pick<Resolved, "home" | "env">) => join(configDir(r), "hqtui", "backups");

/**
 * fontconfig: OpenEmoji is what "emoji" means, the other colour emoji families
 * resolve to it, and it is appended (never prepended) to the text families as
 * their fallback. Prepending would be a bug: colour emoji fonts carry glyphs
 * for 0-9, # and * (the keycap bases), so digits would draw as emoji art.
 */
export const FONTCONFIG = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<!-- Written by \`hqtui fonts install\`; \`hqtui fonts remove\` deletes it. -->
<fontconfig>
  <alias binding="strong">
    <family>emoji</family>
    <prefer><family>${FONT_FAMILY}</family></prefer>
  </alias>
${["Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Twemoji", "Twitter Color Emoji", "JoyPixels", "EmojiOne Color", "Blobmoji"]
  .map(
    (family) => `  <alias binding="same">
    <family>${family}</family>
    <prefer><family>${FONT_FAMILY}</family></prefer>
  </alias>`,
  )
  .join("\n")}
${["monospace", "sans-serif", "serif"]
  .map(
    (family) => `  <match target="pattern">
    <test qual="any" name="family"><string>${family}</string></test>
    <edit name="family" mode="append" binding="weak"><string>${FONT_FAMILY}</string></edit>
  </match>`,
  )
  .join("\n")}
</fontconfig>
`;

/** What to add to the terminals that choose fonts themselves. */
export function terminalSnippets(platform: NodeJS.Platform): Array<{ terminal: string; file: string; snippet: string }> {
  const out = [
    {
      terminal: "Kitty",
      file: "~/.config/kitty/kitty.conf",
      snippet: `symbol_map ${EMOJI_RANGES.join(",")} ${FONT_FAMILY}`,
    },
    {
      terminal: "WezTerm",
      file: "~/.wezterm.lua",
      snippet: `config.font = wezterm.font_with_fallback({ "JetBrains Mono", "${FONT_FAMILY}" })`,
    },
  ];
  if (platform === "darwin") {
    out.push({
      terminal: "iTerm2",
      file: "Settings > Profiles > Text",
      snippet: `Use a different font for non-ASCII text: ${FONT_FAMILY}`,
    });
  }
  return out;
}

/** The next free <name>.bak-NNN.<ext> in the backup folder. */
async function backup(r: Resolved, file: string): Promise<string | undefined> {
  const { copyFile, mkdir, stat } = await loadFs();
  try {
    await stat(file);
  } catch {
    return undefined;
  }
  await mkdir(backupDir(r), { recursive: true });
  const ext = extOf(file);
  const stem = baseOf(file, ext);
  for (let n = 1; n < 1000; n++) {
    const target = join(backupDir(r), `${stem}.bak-${String(n).padStart(3, "0")}${ext}`);
    try {
      await stat(target);
    } catch {
      await copyFile(file, target);
      return target;
    }
  }
  throw new Error(`too many backups of ${file}`);
}

async function download(r: Resolved, file: string): Promise<Buffer> {
  const tried: string[] = [];
  for (const url of [`${FONT_RELEASE}/${file}`, `${FONT_RAW}/${file}`]) {
    tried.push(url);
    const response = await r.fetch(url).catch(() => undefined);
    if (response?.ok) {
      const data = Buffer.from(await response.arrayBuffer());
      // A TrueType file starts 00 01 00 00 or 'true'; anything else is an error page.
      const magic = data.length >= 4 ? data.readUInt32BE(0) : 0;
      if (magic === 0x00010000 || magic === 0x74727565) return data;
    }
  }
  throw new Error(
    `The OpenEmoji font is not published yet (tried ${tried.join(" and ")}). ` +
      "It ships with the set's first release; try again later.",
  );
}

interface Record {
  files: string[];
  backups: Array<{ original: string; backup: string }>;
}

export interface InstallResult {
  installed: string[];
  fontconfig?: string;
  snippets: ReturnType<typeof terminalSnippets>;
  notes: string[];
}

/** Download the font and wire it up. Changes the machine; only call on the user's say-so. */
export async function installEmojiFont(options: FontEnv = {}): Promise<InstallResult> {
  const r = await resolve(options);
  const { mkdir, readFile, writeFile } = await loadFs();
  if (r.platform === "win32") {
    throw new Error("Windows Terminal draws emoji with Segoe UI Emoji and has no fallback setting to change.");
  }
  const record: Record = { files: [], backups: [] };
  const dir = fontDir(r);
  await mkdir(dir, { recursive: true });
  const installed: string[] = [];
  for (const file of fontFiles(r.platform)) {
    const data = await download(r, file);
    const target = join(dir, file);
    await writeFile(target, data);
    record.files.push(target);
    installed.push(target);
    r.log(`installed ${target}`);
  }

  const notes: string[] = [];
  let fontconfig: string | undefined;
  if (r.platform !== "darwin") {
    fontconfig = fontconfigFile(r);
    const previous = await readFile(fontconfig, "utf8").catch(() => undefined);
    if (previous !== undefined && previous !== FONTCONFIG) {
      const saved = await backup(r, fontconfig);
      if (saved) record.backups.push({ original: fontconfig, backup: saved });
    }
    await mkdir(dirOf(fontconfig), { recursive: true });
    await writeFile(fontconfig, FONTCONFIG);
    record.files.push(fontconfig);
    r.log(`wrote ${fontconfig}`);
    const cache = r.run("fc-cache", ["-f", dir]);
    if (cache.status !== 0) notes.push("fc-cache is not installed or failed; run `fc-cache -f` after installing fontconfig.");
  } else {
    notes.push(
      "Terminal.app always draws emoji with Apple Color Emoji; use Kitty, WezTerm or iTerm2 to see OpenEmoji.",
    );
  }

  await mkdir(dirOf(recordFile(r)), { recursive: true });
  await writeFile(recordFile(r), `${JSON.stringify(record, null, 2)}\n`);
  return { installed, fontconfig, snippets: terminalSnippets(r.platform), notes };
}

export interface FontStatus {
  installed: boolean;
  files: string[];
  fontconfig: boolean;
  /** What fc-match picks for emoji, where fontconfig exists. */
  emojiFont?: string;
  active: boolean;
}

export async function emojiFontStatus(options: FontEnv = {}): Promise<FontStatus> {
  const r = await resolve(options);
  const { stat } = await loadFs();
  const files: string[] = [];
  for (const file of fontFiles(r.platform)) {
    const path = join(fontDir(r), file);
    if (await stat(path).then(() => true, () => false)) files.push(path);
  }
  const fontconfig = r.platform !== "darwin" && (await stat(fontconfigFile(r)).then(() => true, () => false));
  let emojiFont: string | undefined;
  if (r.platform !== "darwin" && r.platform !== "win32") {
    const match = r.run("fc-match", ["-f", "%{family}", "emoji"]);
    if (match.status === 0) emojiFont = match.stdout.trim();
  }
  const installed = files.length > 0;
  const active = installed && (r.platform === "darwin" || (emojiFont ?? "").includes(FONT_FAMILY));
  return { installed, files, fontconfig, emojiFont, active };
}

/** Undo `installEmojiFont`: delete what it wrote and put back what it replaced. */
export async function removeEmojiFont(options: FontEnv = {}): Promise<string[]> {
  const r = await resolve(options);
  const { copyFile, readFile, rm } = await loadFs();
  const raw = await readFile(recordFile(r), "utf8").catch(() => undefined);
  if (!raw) return [];
  const record = JSON.parse(raw) as Record;
  const done: string[] = [];
  for (const file of record.files) {
    await rm(file, { force: true });
    done.push(`removed ${file}`);
  }
  for (const { original, backup: saved } of record.backups) {
    await copyFile(saved, original);
    done.push(`restored ${original} from ${saved}`);
  }
  await rm(recordFile(r), { force: true });
  if (r.platform !== "darwin") r.run("fc-cache", ["-f"]);
  for (const line of done) r.log(line);
  return done;
}
