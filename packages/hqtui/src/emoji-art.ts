/**
 * The OpenEmoji artwork itself, drawn inline in terminals that show images.
 *
 *   import { emojiImage } from "@profullstack/hqtui";
 *   process.stdout.write(await emojiImage("rocket"));   // the drawing, two cells wide
 *
 * Off by default: `HQTUI_EMOJI_ART=1` (or `{ art: true }`) turns it on, and it
 * then speaks the protocol the terminal understands:
 *
 *   kitty    the Kitty graphics protocol: Kitty, Ghostty
 *   iterm    iTerm2 inline images: iTerm2, WezTerm
 *
 * Everything else, including tmux (which needs passthrough) and sixel-only
 * terminals, gets the emoji character, so the call is always safe to make.
 * `HQTUI_EMOJI_ART=kitty|iterm` forces a protocol.
 *
 * Hi-res: the PNG is chosen from the set's 128, 256 and 512 px sizes as the
 * smallest at least twice the cell's pixel height (a crisp 2x), 128 when the
 * cell size is unknown. `queryCellSize()` asks the terminal (CSI 16 t);
 * `HQTUI_CELL_PX=WxH` states it.
 *
 * Images are fetched from the OpenEmoji repository on first use and cached
 * under $XDG_CACHE_HOME/hqtui/openemoji (never bundled in the package).
 * Node's filesystem is loaded only when art is actually drawn, so importing
 * hqtui stays free of side effects and safe in a browser bundle.
 */

import { detectCapabilities } from "./capabilities.ts";
import { emoji, emojiInfo, emojiMode } from "./emoji.ts";

export type ArtProtocol = "kitty" | "iterm" | "none";

export const OPENEMOJI_PNG_BASE = "https://raw.githubusercontent.com/profullstack/openemoji/main/png";
export const ART_SIZES = [128, 256, 512] as const;

/** Which image protocol to speak, or none. Off unless asked for. */
export function artProtocol(env: NodeJS.ProcessEnv = process.env, enabled?: boolean): ArtProtocol {
  const setting = (env.HQTUI_EMOJI_ART ?? "").toLowerCase();
  if (setting === "kitty" || setting === "iterm") return setting;
  const on = enabled ?? (setting === "1" || setting === "on" || setting === "true");
  if (!on) return "none";
  // tmux swallows graphics escapes unless passthrough is configured; the
  // character is the honest answer there.
  if (env.TMUX) return "none";
  const program = detectCapabilities({}, env).program;
  if (program === "kitty" || program === "ghostty") return "kitty";
  if (program === "iterm" || program === "wezterm") return "iterm";
  return "none";
}

export interface CellSize {
  width: number;
  height: number;
}

/** The cell size stated in HQTUI_CELL_PX (`10x20`), or undefined. */
export function cellSizeFromEnv(env: NodeJS.ProcessEnv = process.env): CellSize | undefined {
  const m = /^(\d+)x(\d+)$/i.exec(env.HQTUI_CELL_PX ?? "");
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

/**
 * Ask the terminal for its cell size in pixels (CSI 16 t, answered as
 * CSI 6 ; height ; width t by Kitty, WezTerm, iTerm2, Ghostty, foot and xterm
 * with `allowWindowOps`). Resolves undefined if nothing answers in time.
 * The caller owns raw mode; hqtui apps already have the terminal in it.
 */
export function queryCellSize(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  timeoutMs = 150,
): Promise<CellSize | undefined> {
  return new Promise((resolve) => {
    let buffer = "";
    const done = (value: CellSize | undefined) => {
      clearTimeout(timer);
      input.removeListener("data", onData);
      resolve(value);
    };
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const m = /\x1b\[6;(\d+);(\d+)t/.exec(buffer);
      if (m) done({ height: Number(m[1]), width: Number(m[2]) });
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    input.on("data", onData);
    output.write("\x1b[16t");
  });
}

/** The smallest of the set's sizes at least twice the cell height; 128 when unknown. */
export function artSize(cell: CellSize | undefined): (typeof ART_SIZES)[number] {
  if (!cell) return 128;
  const target = cell.height * 2;
  return ART_SIZES.find((s) => s >= target) ?? 512;
}

const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");

export function artCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME || join(env.HOME || env.USERPROFILE || ".", ".cache"), "hqtui", "openemoji");
}

export interface EmojiImageOptions {
  /** Columns the image spans; rows are always one. Default 2, an emoji's width. */
  cells?: number;
  /** Turn art on for this call regardless of HQTUI_EMOJI_ART. */
  art?: boolean;
  protocol?: ArtProtocol;
  cell?: CellSize;
  /** Force a PNG size instead of choosing from the cell size. */
  size?: (typeof ART_SIZES)[number];
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  cacheDir?: string;
}

/** The PNG for an emoji at a size, from the cache or the repository. */
export async function emojiPng(
  key: string,
  size: (typeof ART_SIZES)[number],
  options: Pick<EmojiImageOptions, "env" | "fetch" | "cacheDir"> = {},
): Promise<Buffer | undefined> {
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const dir = join(options.cacheDir ?? artCacheDir(options.env), String(size));
  const file = join(dir, `${key}.png`);
  try {
    return await readFile(file);
  } catch {
    // not cached yet
  }
  const response = await (options.fetch ?? fetch)(`${OPENEMOJI_PNG_BASE}/${size}/${key}.png`).catch(() => undefined);
  if (!response?.ok) return undefined;
  const png = Buffer.from(await response.arrayBuffer());
  // A PNG starts with its signature; anything else (an HTML error page) is not cached.
  if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) return undefined;
  await mkdir(dir, { recursive: true });
  await writeFile(file, png);
  return png;
}

/** Kitty graphics protocol: base64 PNG in 4096-byte chunks, `c` columns by one row. */
export function kittyImage(png: Buffer, cells: number): string {
  const data = png.toString("base64");
  const chunks = data.match(/.{1,4096}/g) ?? [""];
  return chunks
    .map((chunk, i) => {
      const more = i < chunks.length - 1 ? 1 : 0;
      const keys = i === 0 ? `f=100,a=T,c=${cells},r=1,q=2,m=${more}` : `m=${more}`;
      return `\x1b_G${keys};${chunk}\x1b\\`;
    })
    .join("");
}

/** iTerm2 inline image (also WezTerm), `cells` wide by one row. */
export function itermImage(png: Buffer, cells: number): string {
  return `\x1b]1337;File=inline=1;size=${png.length};width=${cells};height=1;preserveAspectRatio=1:${png.toString("base64")}\x07`;
}

/**
 * The escape sequence that draws an emoji's artwork, or the emoji character
 * when art is off, the terminal cannot show images, or the image is not
 * available. Never throws for a known emoji; unknown names return "".
 */
export async function emojiImage(name: string, options: EmojiImageOptions = {}): Promise<string> {
  const info = emojiInfo(name);
  if (!info) return "";
  const env = options.env ?? process.env;
  const protocol = options.protocol ?? artProtocol(env, options.art);
  // The fallback follows the same environment the caller passed in.
  const fallback = () => emoji(info.key, { mode: emojiMode(env) });
  if (protocol === "none") return fallback();
  const size = options.size ?? artSize(options.cell ?? cellSizeFromEnv(env));
  const png = await emojiPng(info.key, size, { env, fetch: options.fetch, cacheDir: options.cacheDir }).catch(
    () => undefined,
  );
  if (!png) return fallback();
  const cells = options.cells ?? 2;
  return protocol === "kitty" ? kittyImage(png, cells) : itermImage(png, cells);
}
