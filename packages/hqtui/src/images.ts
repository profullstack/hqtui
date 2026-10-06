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
 * WezTerm and iTerm2 do not do Unicode placeholders; they get iTerm2 inline
 * images instead (`HQTUI_IMAGES=wezterm` or `=iterm`, detected locally). Those
 * are not tied to cells, so the store marks each image's cells in the frame
 * (blank cells coloured with the id, which the diff renderer notices when they
 * change) and, once attached to the app, draws the images after each frame:
 * only where they are new or moved, never over something drawn on top.
 *
 * Enable with HQTUI_IMAGES=1 (Kitty/Ghostty) or HQTUI_IMAGES=wezterm (WezTerm,
 * iTerm2): needed under tmux or SSH, where the terminal cannot be detected;
 * tmux also needs `set -g allow-passthrough on`. Kitty, Ghostty, WezTerm and
 * iTerm2 are detected locally. HQTUI_IMAGES=0 turns it off.
 */

import { join } from "node:path";
import { ansi256, type Color } from "./color.ts";
import { detectCapabilities } from "./capabilities.ts";
import { emojiInfo } from "./emoji.ts";
import { artCacheDir, artSize, cellSizeFromEnv, emojiPng } from "./emoji-art.ts";
import type { Surface } from "./surface.ts";
import { cellText, graphemes, internCluster } from "./unicode.ts";

export const PLACEHOLDER = "\u{10EEEE}";
/** Row/column diacritics from the Kitty spec: index n marks row or column n. */
const DIACRITICS = ["̅", "̍", "̎", "̐", "̒", "̽", "̾", "̿"];
export const OPENICON_PNG_BASE = "https://raw.githubusercontent.com/profullstack/openicon/main/png";
const MAX_IDS = 255;

export type ImageSupport = "kitty" | "iterm" | "none";

/** Whether in-frame images can be drawn here. */
export function imageSupport(env: NodeJS.ProcessEnv = process.env): ImageSupport {
  const setting = (env.HQTUI_IMAGES ?? "").toLowerCase();
  if (setting === "0" || setting === "off" || setting === "false") return "none";
  if (setting === "1" || setting === "on" || setting === "true" || setting === "kitty" || setting === "ghostty") return "kitty";
  if (setting === "iterm" || setting === "iterm2" || setting === "wezterm") return "iterm";
  const art = (env.HQTUI_EMOJI_ART ?? "").toLowerCase();
  if (art === "kitty") return "kitty";
  if (art === "iterm") return "iterm";
  // Kitty/Ghostty environment variables survive into a local tmux, which then
  // only needs passthrough for the uploads; over SSH set HQTUI_IMAGES=1.
  const program = detectCapabilities({}, env).program;
  if (program === "kitty" || program === "ghostty") return "kitty";
  if (env.KITTY_WINDOW_ID || env.GHOSTTY_RESOURCES_DIR) return "kitty";
  if (/^(ghostty|kitty)$/i.test(env.TERM_PROGRAM ?? "")) return "kitty";
  if (/^xterm-(kitty|ghostty)$/.test(env.TERM ?? "")) return "kitty";
  // WezTerm and iTerm2: inline images, not placeholders.
  if (program === "wezterm" || program === "iterm") return "iterm";
  if (env.WEZTERM_PANE || env.WEZTERM_EXECUTABLE || /^(wezterm|iterm\.app)$/i.test(env.TERM_PROGRAM ?? "")) return "iterm";
  if (env.LC_TERMINAL === "iTerm2") return "iterm";
  return "none";
}

/**
 * Inside tmux? `TMUX` is the usual sign, but it is lost across su, sudo and
 * some SSH or mosh hops while `TERM` still says tmux (or screen, which tmux
 * also sets). Either one counts.
 */
export function inTmux(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.TMUX || /^(tmux|screen)([-.]|$)/.test(env.TERM ?? "");
}

/** Wrap an escape for tmux passthrough (every ESC doubled inside DCS tmux;). */
export function passthrough(seq: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!inTmux(env)) return seq;
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

/** An iTerm2 inline image `cols` cells wide, one row high, at the cursor. */
export function itermInlineImage(png: Buffer, cols: number, env: NodeJS.ProcessEnv = process.env): string {
  return passthrough(
    `\x1b]1337;File=inline=1;size=${png.length};width=${cols};height=1;preserveAspectRatio=1:${png.toString("base64")}\x07`,
    env,
  );
}

/**
 * Where the current tmux pane sits in the real terminal: its left/top, plus one
 * row when the status line is at the top. {0,0} when tmux cannot be asked.
 */
export async function tmuxPaneOffset(env: NodeJS.ProcessEnv = process.env): Promise<{ x: number; y: number }> {
  try {
    const { execFile } = await import("node:child_process");
    const target = env.TMUX_PANE ? ["-t", env.TMUX_PANE] : [];
    const out: string = await new Promise((resolve, reject) =>
      execFile("tmux", ["display", "-p", ...target, "#{pane_left} #{pane_top} #{status} #{status-position}"], { timeout: 2000 }, (err, stdout) =>
        err ? reject(err) : resolve(String(stdout)),
      ),
    );
    const [left, top, status, position] = out.trim().split(/\s+/);
    const statusTop = status !== "off" && status !== "0" && position === "top" ? 1 : 0;
    return { x: Number(left) || 0, y: (Number(top) || 0) + statusTop };
  } catch {
    return { x: 0, y: 0 };
  }
}

/** Free image `id` and its placements in the terminal. */
export function kittyDeleteImage(id: number, env: NodeJS.ProcessEnv = process.env): string {
  return passthrough(`\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`, env);
}

/** The placeholder cell text for column `col` of row `row`. */
export function placeholderCell(row: number, col: number): string {
  return PLACEHOLDER + (DIACRITICS[row] ?? DIACRITICS[0]) + (DIACRITICS[col] ?? DIACRITICS[0]);
}

// Reserve the single-row placeholder cells in the cluster table now, at import:
// a table that later fills up degrades new clusters to their base character,
// and a placeholder without its diacritics would lose its column.
for (let col = 0; col < DIACRITICS.length; col++) internCluster(placeholderCell(0, col));

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
  /** Under tmux: the pane's position in the real terminal. Asked of tmux when omitted. */
  paneOffset?: { x: number; y: number };
}

/** The parts of an hqtui App the store needs for inline (iTerm/WezTerm) images. */
export interface ImageHost {
  // biome-ignore lint/suspicious/noExplicitAny: an App's typed event map, or any emitter.
  on(event: "frame" | "focus", listener: (arg: any) => void): unknown;
  readonly frameBuffer: { width: number; height: number; chars: Uint32Array; fg: Uint32Array };
  readonly inline?: boolean;
}

export interface ImageStore {
  readonly enabled: boolean;
  readonly mode: ImageSupport;
  /** Reserve `cols` cells at (x, y) of `surface` for image `id` (inline mode). */
  place(surface: Surface, x: number, y: number, id: number, cols: number): number;
  /** Inline mode: draw images after each frame of `app`. Call once. */
  attach(app: ImageHost): void;
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
  const mode: ImageSupport = options.support ?? imageSupport(env);
  const enabled = mode !== "none";
  const pngs = new Map<number, { png: Buffer; cols: number }>(); // inline mode: id -> artwork
  let placements: { x: number; y: number; id: number; cols: number }[] = [];
  let shown = new Map<string, number>(); // "x,y" -> id drawn there and still on screen
  // Under tmux: where this pane sits in the real terminal (pane offset plus a top status line).
  let paneOffset: { x: number; y: number } | null = options.paneOffset ?? null;
  const refreshOffset = () => {
    if (!inTmux(env) || options.paneOffset) return;
    void tmuxPaneOffset(env).then((o) => {
      const moved = !paneOffset || o.x !== paneOffset.x || o.y !== paneOffset.y;
      paneOffset = o;
      if (moved) {
        shown = new Map();
        options.onReady?.();
      }
    });
  };
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
    if (mode === "kitty") options.write(kittyDeleteImage(oldId, env));
    pngs.delete(oldId);
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
        if (mode === "kitty") options.write(kittyVirtualImage(newId, png, cols, 1, env));
        else pngs.set(newId, { png, cols });
        ready.set(key, newId);
        options.onReady?.();
      });
    return undefined;
  };

  /** Inline mode, after a frame: draw what is new or moved, where the marker cells survived. */
  const afterFrame = (app: ImageHost, repainted: boolean) => {
    if (repainted) {
      shown = new Map();
      refreshOffset(); // a resize can move the pane
    }
    // Under tmux, wait for the pane offset rather than draw in the wrong place.
    if (inTmux(env) && !paneOffset) {
      placements = [];
      return;
    }
    const buf = app.frameBuffer;
    const next = new Map<string, number>();
    let out = "";
    for (const p of placements) {
      const art = pngs.get(p.id);
      if (!art || p.y < 0 || p.y >= buf.height || p.x < 0 || p.x + p.cols > buf.width) continue;
      // Something drawn on top (a popup) replaced the marker: no image there.
      let intact = true;
      for (let c = 0; c < p.cols && intact; c++) {
        const i = p.y * buf.width + p.x + c;
        intact = buf.chars[i] === 32 && buf.fg[i] === ansi256(p.id);
      }
      if (!intact) continue;
      const key = `${p.x},${p.y}`;
      next.set(key, p.id);
      if (shown.get(key) === p.id) continue; // unchanged cells: the image is still there
      out += inlineAt(p.x, p.y, art.png, p.cols);
    }
    shown = next;
    placements = [];
    if (out) options.write(out);
  };

  /**
   * One image at a screen cell, cursor saved and restored around it so the
   * renderer's idea of the cursor stays true. Under tmux the whole thing goes
   * through as one passthrough: tmux does not move the real terminal's cursor
   * before forwarding passthrough data, so the move has to travel with the
   * image, in the outer terminal's coordinates (pane offset added).
   */
  const inlineAt = (x: number, y: number, png: Buffer, cols: number): string => {
    const image = `\x1b]1337;File=inline=1;size=${png.length};width=${cols};height=1;preserveAspectRatio=1:${png.toString("base64")}\x07`;
    if (!inTmux(env)) return `\x1b7\x1b[${y + 1};${x + 1}H${image}\x1b8`;
    const o = paneOffset ?? { x: 0, y: 0 };
    return passthrough(`\x1b7\x1b[${y + o.y + 1};${x + o.x + 1}H${image}\x1b8`, env);
  };

  return {
    enabled,
    mode,
    place(surface, x, y, id, cols) {
      const fg: Color = ansi256(id);
      surface.text(x, y, " ".repeat(cols), { fg });
      const ax = surface.rect.x + x;
      const ay = surface.rect.y + y;
      const c = surface.clip;
      if (ax >= c.x && ay >= c.y && ax + cols <= c.x + c.width && ay < c.y + c.height) placements.push({ x: ax, y: ay, id, cols });
      return cols;
    },
    attach(app) {
      if (mode !== "iterm" || app.inline) return;
      refreshOffset();
      app.on("frame", (stats: { repainted?: boolean }) => afterFrame(app, !!stats?.repainted));
      // Coming back to the window (a tmux window switch, a reattach) may have
      // repainted the terminal underneath us: draw every image again.
      app.on("focus", (event: { focused?: boolean }) => {
        if (event?.focused === false) return;
        shown = new Map();
        refreshOffset();
        options.onReady?.();
      });
    },
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
      if (mode === "kitty") for (const id of ready.values()) options.write(kittyDeleteImage(id, env));
      ready.clear();
      pngs.clear();
      shown.clear();
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

/** Draw image `id` in `cols` cells at (x, y). Returns the columns used. */
export function drawImage(surface: Surface, x: number, y: number, id: number, cols = 2, images?: ImageStore): number {
  if (images?.mode === "iterm") return images.place(surface, x, y, id, cols);
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
    col += drawImage(surface, x + col, y, id, 2, images);
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
  return drawImage(surface, x, y, id, 2, images);
}
