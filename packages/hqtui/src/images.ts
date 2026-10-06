/**
 * HD images inside the frame: OpenEmoji and OpenIcon artwork drawn as real
 * pixels in terminals that speak the Kitty graphics protocol (Kitty, Ghostty),
 * including through tmux.
 *
 *   const images = createImageStore({ write: (s) => app.terminal.write(s), onReady: () => app.invalidate() });
 *   // in render:
 *   drawRichText(surface, x, y, "ship it 🚀", { fg }, images);   // the rocket is the OpenEmoji PNG
 *   drawIcon(surface, x, y, "lock", images, "🔒");               // the OpenIcon PNG, or the fallback text
 *
 * How: each PNG is sent to the terminal once, under an image id, as a *virtual*
 * placement (Kitty "Unicode placeholders", `U=1`). The image then shows wherever
 * the placeholder character U+10EEEE is printed with that id as its foreground
 * colour. Those are ordinary cells, so the diff renderer, scrolling, clipping
 * and redraws all just work, and tmux (which only has to pass the one-time
 * upload through) keeps them in its own grid.
 *
 * Ids travel as explicit 256-palette indexes (1-255), never as truecolor, which
 * an encoder may quantize. Images load lazily: until one is ready the text
 * (the emoji character) is drawn and `onReady` asks for a redraw.
 *
 * Enable with HQTUI_IMAGES=1 (needed under tmux or SSH, where the terminal
 * cannot be detected; tmux also needs `set -g allow-passthrough on`), or it
 * turns itself on in Kitty and Ghostty. HQTUI_IMAGES=0 turns it off.
 */

import { join } from "node:path";
import { ansi256, type Color } from "./color.ts";
import { detectCapabilities } from "./capabilities.ts";
import { emojiInfo } from "./emoji.ts";
import { artCacheDir, artSize, cellSizeFromEnv, emojiPng } from "./emoji-art.ts";
import type { Surface } from "./surface.ts";
import { cellText, graphemes } from "./unicode.ts";

export const PLACEHOLDER = "\u{10EEEE}";
/** Row/column diacritics from the Kitty spec: index n marks row or column n. */
const DIACRITICS = ["̅", "̍", "̎", "̐", "̒", "̽", "̾", "̿"];
export const OPENICON_PNG_BASE = "https://raw.githubusercontent.com/profullstack/openicon/main/png";
const MAX_IDS = 255;

export type ImageSupport = "kitty" | "none";

/** Whether in-frame images can be drawn here. */
export function imageSupport(env: NodeJS.ProcessEnv = process.env): ImageSupport {
  const setting = (env.HQTUI_IMAGES ?? "").toLowerCase();
  if (setting === "0" || setting === "off" || setting === "false") return "none";
  if (setting === "1" || setting === "on" || setting === "true" || setting === "kitty") return "kitty";
  if ((env.HQTUI_EMOJI_ART ?? "").toLowerCase() === "kitty") return "kitty";
  // Kitty/Ghostty environment variables survive into a local tmux, which then
  // only needs passthrough for the uploads; over SSH set HQTUI_IMAGES=1.
  const program = detectCapabilities({}, env).program;
  if (program === "kitty" || program === "ghostty") return "kitty";
  if (env.KITTY_WINDOW_ID || env.GHOSTTY_RESOURCES_DIR) return "kitty";
  if (/^(ghostty|kitty)$/i.test(env.TERM_PROGRAM ?? "")) return "kitty";
  if (/^xterm-(kitty|ghostty)$/.test(env.TERM ?? "")) return "kitty";
  return "none";
}

/** Wrap an escape for tmux passthrough (every ESC doubled inside DCS tmux;). */
export function passthrough(seq: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!env.TMUX) return seq;
  return `\x1bPtmux;${seq.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
}

/** Upload a PNG as image `id` with a virtual placement `cols` x `rows` cells. */
export function kittyVirtualImage(id: number, png: Buffer, cols: number, rows = 1, env: NodeJS.ProcessEnv = process.env): string {
  const data = png.toString("base64");
  const chunks = data.match(/.{1,4096}/g) ?? [""];
  return chunks
    .map((chunk, i) => {
      const more = i < chunks.length - 1 ? 1 : 0;
      const keys = i === 0 ? `a=T,U=1,f=100,i=${id},c=${cols},r=${rows},q=2,m=${more}` : `m=${more}`;
      // Each chunk is its own passthrough: tmux caps a single DCS in length.
      return passthrough(`\x1b_G${keys};${chunk}\x1b\\`, env);
    })
    .join("");
}

/** Free image `id` and its placements in the terminal. */
export function kittyDeleteImage(id: number, env: NodeJS.ProcessEnv = process.env): string {
  return passthrough(`\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`, env);
}

/** The placeholder cell text for column `col` of row `row`. */
export function placeholderCell(row: number, col: number): string {
  return PLACEHOLDER + (DIACRITICS[row] ?? DIACRITICS[0]) + (DIACRITICS[col] ?? DIACRITICS[0]);
}

export interface ImageStoreOptions {
  /** Raw terminal write, outside the frame (e.g. `app.terminal.write`). */
  write: (seq: string) => void;
  /** Called when an image finishes loading, to redraw. */
  onReady?: () => void;
  env?: NodeJS.ProcessEnv;
  /** Force support on/off instead of detecting it. */
  support?: ImageSupport;
  fetch?: typeof fetch;
  cacheDir?: string;
}

export interface ImageStore {
  readonly enabled: boolean;
  /** The image id for an emoji (character or name), loading it if needed; undefined until ready. */
  emoji(text: string): number | undefined;
  /** The image id for an OpenIcon by name; undefined until ready (or unknown). */
  icon(name: string): number | undefined;
  /** Forget every image (call on exit so the terminal frees them). */
  clear(): void;
}

/** Load-once, id-per-image store for emoji and icon artwork. */
export function createImageStore(options: ImageStoreOptions): ImageStore {
  const env = options.env ?? process.env;
  const enabled = (options.support ?? imageSupport(env)) === "kitty";
  const ready = new Map<string, number>(); // key -> id, in least-recently-used order
  const pending = new Set<string>();
  const failed = new Set<string>();
  let nextId = 1;
  const size = artSize(cellSizeFromEnv(env));

  const allocate = (): number => {
    if (ready.size < MAX_IDS) return nextId++;
    // Recycle the least recently used id.
    const [oldKey, oldId] = ready.entries().next().value as [string, number];
    ready.delete(oldKey);
    options.write(kittyDeleteImage(oldId, env));
    return oldId;
  };

  const use = (key: string, cols: number, load: () => Promise<Buffer | undefined>): number | undefined => {
    if (!enabled) return undefined;
    const id = ready.get(key);
    if (id !== undefined) {
      ready.delete(key);
      ready.set(key, id);
      return id;
    }
    if (pending.has(key) || failed.has(key)) return undefined;
    pending.add(key);
    load()
      .catch(() => undefined)
      .then((png) => {
        pending.delete(key);
        if (!png) {
          failed.add(key);
          return;
        }
        const newId = allocate();
        options.write(kittyVirtualImage(newId, png, cols, 1, env));
        ready.set(key, newId);
        options.onReady?.();
      });
    return undefined;
  };

  return {
    enabled,
    emoji(text) {
      const info = emojiInfo(text);
      if (!info) return undefined;
      return use(`e:${info.key}`, 2, () =>
        emojiPng(info.key, size, { env, fetch: options.fetch, cacheDir: options.cacheDir }),
      );
    },
    icon(name) {
      if (!/^[a-z0-9-]+$/.test(name)) return undefined;
      return use(`i:${name}`, 2, () => iconPng(name, 128, { env, fetch: options.fetch, cacheDir: options.cacheDir }));
    },
    clear() {
      for (const id of ready.values()) options.write(kittyDeleteImage(id, env));
      ready.clear();
    },
  };
}

/** An OpenIcon PNG, fetched once and cached beside the emoji art. */
export async function iconPng(
  name: string,
  size: number,
  options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; cacheDir?: string } = {},
): Promise<Buffer | undefined> {
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const base = options.cacheDir ?? join(artCacheDir(options.env), "..", "openicon");
  const dir = join(base, String(size));
  const file = join(dir, `${name}.png`);
  try {
    return await readFile(file);
  } catch {
    // not cached yet
  }
  const response = await (options.fetch ?? fetch)(`${OPENICON_PNG_BASE}/${size}/${name}.png`).catch(() => undefined);
  if (!response?.ok) return undefined;
  const png = Buffer.from(await response.arrayBuffer());
  if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) return undefined;
  await mkdir(dir, { recursive: true });
  await writeFile(file, png);
  return png;
}

/** Draw image `id` as `cols` placeholder cells at (x, y). Returns the columns used. */
export function drawImage(surface: Surface, x: number, y: number, id: number, cols = 2): number {
  const fg: Color = ansi256(id);
  for (let c = 0; c < cols; c++) surface.text(x + c, y, placeholderCell(0, c), { fg });
  return cols;
}

/**
 * `surface.text`, except that emoji with OpenEmoji artwork are drawn as images
 * once loaded. Returns the columns written.
 */
export function drawRichText(
  surface: Surface,
  x: number,
  y: number,
  text: string,
  style: Parameters<Surface["text"]>[3] = {},
  images?: ImageStore,
): number {
  if (!images?.enabled) return surface.text(x, y, text, style);
  let col = 0;
  let run = "";
  const flush = () => {
    if (run) col += surface.text(x + col, y, run, style);
    run = "";
  };
  for (const g of graphemes(text)) {
    const piece = cellText(g.value);
    const id = g.width === 2 ? images.emoji(piece) : undefined;
    if (id === undefined) {
      run += piece;
      continue;
    }
    flush();
    col += drawImage(surface, x + col, y, id, 2);
  }
  flush();
  return col;
}

/** An OpenIcon image when available, else `fallback` text. Returns columns used. */
export function drawIcon(
  surface: Surface,
  x: number,
  y: number,
  name: string,
  images: ImageStore | undefined,
  fallback: string,
  style: Parameters<Surface["text"]>[3] = {},
): number {
  const id = images?.icon(name);
  if (id === undefined) return surface.text(x, y, fallback, style);
  return drawImage(surface, x, y, id, 2);
}
