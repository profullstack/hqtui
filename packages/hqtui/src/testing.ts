import { FrameBuffer } from "./buffer.ts";
import { Encoder } from "./diff.ts";
import { createSurface, Surface } from "./surface.ts";
import { Container, type RenderContext, type HitRegion } from "./ui.ts";
import { type Theme, type ThemeName, resolveTheme } from "./theme.ts";
import { detectCapabilities, type Capabilities, type CapabilityOverrides } from "./capabilities.ts";
import { CONTINUATION, cellText } from "./unicode.ts";
import { DEFAULT_COLOR, type Color } from "./color.ts";

export interface RenderOptions {
  width?: number;
  height?: number;
  theme?: Theme | ThemeName | string;
  capabilities?: CapabilityOverrides;
  /** Frame number reported to the view, for animation snapshots. */
  frame?: number;
  elapsed?: number;
  focus?: number;
}

export interface CellSnapshot {
  char: string;
  fg: Color;
  bg: Color;
  attrs: number;
}

export interface RenderedScreen {
  width: number;
  height: number;
  buffer: FrameBuffer;
  /**
   * Mouse regions the view registered, in draw order. Lets a test assert that
   * a widget is actually reachable by the wheel or a click, which is otherwise
   * only observable by running a real terminal.
   */
  regions: HitRegion[];
  /** Plain text, one line per row, trailing spaces trimmed. */
  text(): string;
  /** One row of plain text. */
  line(y: number): string;
  /** Everything, with ANSI colors — paste into a terminal to see it. */
  ansi(): string;
  cell(x: number, y: number): CellSnapshot;
  /** Row/col of the first occurrence, or null. */
  find(needle: string): { x: number; y: number } | null;
  contains(needle: string): boolean;
  /** Cell grid as JSON, for structural assertions. */
  toJSON(): CellSnapshot[][];
}

function snapshot(buffer: FrameBuffer, x: number, y: number): CellSnapshot {
  const i = buffer.index(x, y);
  const value = buffer.chars[i];
  return {
    char: value === CONTINUATION ? "" : value === 0 ? " " : cellText(value),
    fg: buffer.fg[i] ?? DEFAULT_COLOR,
    bg: buffer.bg[i] ?? DEFAULT_COLOR,
    attrs: buffer.attrs[i] ?? 0,
  };
}

/**
 * Render a view to an in-memory screen. No TTY, no escape codes, no timers —
 * which is what makes TUI code written with this library actually testable.
 *
 *   const screen = renderToScreen(({ ui }) => ui.text("CPU 72%"));
 *   expect(screen.text()).toContain("CPU 72%");
 */
export function renderToScreen(
  view: (args: { ui: Container; theme: Theme; width: number; height: number; capabilities: Capabilities }) => void,
  options: RenderOptions = {},
): RenderedScreen {
  const width = options.width ?? 80;
  const height = options.height ?? 24;
  const theme = resolveTheme(options.theme);
  const capabilities = detectCapabilities(
    { tty: true, colors: "truecolor", unicode: true, braille: true, ...options.capabilities },
    process.env,
    { isTTY: true },
  );

  const buffer = new FrameBuffer(width, height);
  buffer.clear(theme.background, theme.foreground);

  const overlays: ((root: Surface) => void)[] = [];
  const regions: HitRegion[] = [];
  let focusCursor = 0;
  const ctx: RenderContext = {
    theme,
    capabilities,
    width,
    height,
    frame: options.frame ?? 0,
    elapsed: options.elapsed ?? 0,
    focusIndex: options.focus ?? 0,
    registerFocus: () => {
      const index = focusCursor++;
      return { index, focused: index === (options.focus ?? 0) };
    },
    hit: (region) => regions.push(region),
    overlay: (draw) => overlays.push(draw),
    invalidate: () => {},
  };

  const root = createSurface(buffer, theme);
  const container = new Container(root, ctx, "column");
  view({ ui: container, theme, width, height, capabilities });
  container.flush();
  for (const overlay of overlays) overlay(root);

  return {
    width,
    height,
    buffer,
    regions,
    text: () => buffer.toText(),
    line: (y: number) => buffer.rowText(y).replace(/\s+$/, ""),
    ansi: () => {
      const empty = new FrameBuffer(width, height);
      return new Encoder({ colors: "truecolor" }).encode(empty, buffer, true).output;
    },
    cell: (x: number, y: number) => snapshot(buffer, x, y),
    find: (needle: string) => {
      for (let y = 0; y < height; y++) {
        const x = buffer.rowText(y).indexOf(needle);
        if (x !== -1) return { x, y };
      }
      return null;
    },
    contains: (needle: string) => {
      for (let y = 0; y < height; y++) if (buffer.rowText(y).includes(needle)) return true;
      return false;
    },
    toJSON: () => {
      const grid: CellSnapshot[][] = [];
      for (let y = 0; y < height; y++) {
        const row: CellSnapshot[] = [];
        for (let x = 0; x < width; x++) row.push(snapshot(buffer, x, y));
        grid.push(row);
      }
      return grid;
    },
  };
}

/** Shorthand: render and return plain text. Ideal for snapshot tests. */
export function renderToText(
  view: Parameters<typeof renderToScreen>[0],
  options: RenderOptions = {},
): string {
  return renderToScreen(view, options).text();
}

/** Render with ANSI colors, e.g. to write a demo screenshot to a file. */
export function renderToAnsi(
  view: Parameters<typeof renderToScreen>[0],
  options: RenderOptions = {},
): string {
  return renderToScreen(view, options).ansi();
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => HTML_ESCAPES[c]);
}

const ATTR_ESCAPES: Record<string, string> = { ...HTML_ESCAPES, '"': "&quot;", "'": "&#39;" };

/**
 * Attribute values need the quote characters escaped too, or a caller-supplied
 * `className` or `fontFamily` closes the attribute and opens its own.
 */
function escapeAttr(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ATTR_ESCAPES[c]);
}

function cssColor(color: Color, fallback: string): string {
  if (color === DEFAULT_COLOR) return fallback;
  return `#${((color & 0xffffff) >>> 0).toString(16).padStart(6, "0")}`;
}

/**
 * Render to standalone HTML — a real screenshot of the UI, no terminal needed.
 * This is how the marketing site and the docs show live examples.
 */
export function renderToHtml(
  view: Parameters<typeof renderToScreen>[0],
  options: RenderOptions & {
    fontSize?: number;
    padding?: number;
    className?: string;
    /** Override the font stack. The default prioritises box-drawing coverage. */
    fontFamily?: string;
  } = {},
): string {
  const screen = renderToScreen(view, options);
  const theme = resolveTheme(options.theme);
  const buffer = screen.buffer;
  const bgFallback = cssColor(theme.background, "#000");
  const fgFallback = cssColor(theme.foreground, "#fff");
  const rows: string[] = [];

  for (let y = 0; y < screen.height; y++) {
    let row = "";
    let run = "";
    let runFg = -1;
    let runBg = -1;
    let runAttrs = -1;

    const flush = () => {
      if (run === "") return;
      const style = `color:${cssColor(runFg, fgFallback)};background:${cssColor(runBg, bgFallback)}` +
        (runAttrs & 1 ? ";font-weight:700" : "") +
        (runAttrs & 2 ? ";opacity:.65" : "") +
        (runAttrs & 4 ? ";font-style:italic" : "") +
        (runAttrs & 8 ? ";text-decoration:underline" : "");
      row += `<span style="${style}">${escapeHtml(run)}</span>`;
      run = "";
    };

    for (let x = 0; x < screen.width; x++) {
      const i = buffer.index(x, y);
      if (buffer.chars[i] === CONTINUATION) continue;
      const fg = buffer.fg[i];
      const bg = buffer.bg[i];
      const attrs = buffer.attrs[i];
      if (fg !== runFg || bg !== runBg || attrs !== runAttrs) {
        flush();
        runFg = fg;
        runBg = bg;
        runAttrs = attrs;
      }
      const value = buffer.chars[i];
      run += value === 0 ? " " : cellText(value);
    }
    flush();
    rows.push(row);
  }

  // Every one of these is spliced into an attribute, so none may be trusted to
  // be the type the signature claims. Numbers are coerced and bounded; a font
  // stack is reduced to the characters a font stack can legitimately contain,
  // because escaping alone still lets `;` open a new CSS property.
  const number = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 1000 ? n : fallback;
  };
  const fontSize = number(options.fontSize, 14);
  const padding = number(options.padding, 16);
  // line-height must be exactly 1: box-drawing glyphs fill the em box, so any
  // extra leading shows up as gaps in every vertical rule on the screen.
  // The font stack is ordered by box-drawing and Braille coverage.
  const font = String(options.fontFamily ??
    "ui-monospace,SFMono-Regular,Menlo,'DejaVu Sans Mono','Liberation Mono',Consolas,'Segoe UI Symbol',monospace")
    .replace(/[^A-Za-z0-9 ,._'-]/g, "");
  // One <pre> with newline-separated rows: wrapping each row in its own element
  // gives the browser licence to lay out lines independently, which pulls
  // box-drawing rules apart. A single text flow tiles the grid exactly.
  return `<pre class="${escapeAttr(options.className ?? "hqtui-screen")}" style="background:${bgFallback};color:${fgFallback};` +
    `padding:${padding}px;font-size:${fontSize}px;line-height:${(fontSize * 1.18).toFixed(2)}px;font-family:${escapeAttr(font)};` +
    `margin:0;overflow-x:auto;border-radius:8px;white-space:pre;font-variant-ligatures:none;` +
    `-webkit-font-smoothing:antialiased">${rows.join("\n")}</pre>`;
}

/** Drive a view for N frames — for animation and performance assertions. */
export function renderFrames(
  view: Parameters<typeof renderToScreen>[0],
  count: number,
  options: RenderOptions = {},
): RenderedScreen[] {
  const out: RenderedScreen[] = [];
  for (let i = 0; i < count; i++) out.push(renderToScreen(view, { ...options, frame: i }));
  return out;
}
