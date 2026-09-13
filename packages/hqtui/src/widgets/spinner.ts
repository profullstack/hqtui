import type { Surface, Align } from "../surface.ts";
import { Attr } from "../buffer.ts";
import type { Color } from "../color.ts";
import { stringWidth, truncate } from "../unicode.ts";

/** Frame sets a spinner can cycle. `ascii` is what a terminal without Unicode gets. */
export const SPINNER_FRAMES = {
  dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  arc: ["◜", "◠", "◝", "◞", "◡", "◟"],
  line: ["─", "╲", "│", "╱"],
  ascii: ["|", "/", "-", "\\"],
} as const;

export type SpinnerFrames = keyof typeof SPINNER_FRAMES | readonly string[];

export interface SpinnerOptions {
  /** Milliseconds since the app started (`RenderArgs.elapsed`); picks the frame. */
  elapsed: number;
  /** What is happening, drawn after the glyph. */
  label?: string;
  /** A right-hand readout, e.g. `349/1200`. */
  text?: string;
  /** Named set or your own frames. Default `dots`, or `ascii` where the terminal has no Unicode. */
  frames?: SpinnerFrames;
  /** Milliseconds per frame. Default 80. */
  interval?: number;
  /**
   * False stops the glyph and draws `doneGlyph` instead, so the same line can
   * say "loading" and then "loaded" without a layout change. Default true.
   */
  active?: boolean;
  doneGlyph?: string;
  color?: Color;
  labelColor?: Color;
  background?: Color;
  align?: Align;
}

/** Which frame `elapsed` lands on. Exported so a status line elsewhere can show the same glyph. */
export function spinnerFrame(elapsed: number, frames: readonly string[], interval = 80): string {
  if (frames.length === 0) return "";
  const step = Math.max(1, interval);
  return frames[Math.floor(Math.max(0, elapsed) / step) % frames.length] ?? "";
}

/**
 * A busy indicator: a spinning glyph, a label, and an optional readout on the
 * right. One row. The widget does not keep time itself; it draws the frame
 * `elapsed` names, and the container asks the app for another frame while it
 * is active, so a spinner animates with no timer in the caller.
 */
export function drawSpinner(surface: Surface, options: SpinnerOptions): number {
  if (surface.empty) return 0;
  const theme = surface.theme;
  const named = typeof options.frames === "string" ? SPINNER_FRAMES[options.frames] : options.frames;
  const frames: readonly string[] = named ?? SPINNER_FRAMES.dots;
  const active = options.active ?? true;
  const glyph = active ? spinnerFrame(options.elapsed, frames, options.interval) : (options.doneGlyph ?? "✓");
  const color = options.color ?? (active ? theme.accent : theme.success);
  const labelColor = options.labelColor ?? theme.foreground;
  const bg = options.background;

  const label = options.label ? ` ${options.label}` : "";
  const readout = options.text ?? "";
  const left = `${glyph}${label}`;
  const leftWidth = stringWidth(left);
  const readWidth = stringWidth(readout);
  const total = readout ? Math.min(surface.width, leftWidth + 1 + readWidth) : Math.min(surface.width, leftWidth);
  const x0 = options.align === "right" ? surface.width - total : options.align === "center" ? Math.floor((surface.width - total) / 2) : 0;
  const x = Math.max(0, x0);

  if (bg !== undefined) surface.fill({ bg });
  surface.text(x, 0, glyph, { fg: color, bg, attrs: Attr.Bold });
  const glyphWidth = stringWidth(glyph);
  if (label) surface.text(x + glyphWidth, 0, truncate(label, Math.max(0, surface.width - x - glyphWidth)), { fg: labelColor, bg });
  if (readout) {
    const room = surface.width - (x + leftWidth + 1);
    if (room > 0) surface.text(surface.width - Math.min(readWidth, room), 0, truncate(readout, room), { fg: theme.muted, bg });
  }
  return total;
}
