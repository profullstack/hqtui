/** Sub-cell glyph ramps. Every one degrades to ASCII when Unicode is off. */

/** Left-to-right eighths: ▏▎▍▌▋▊▉█ — horizontal bars and meters. */
export const HORIZONTAL_EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
/** Bottom-up eighths: ▁▂▃▄▅▆▇█ — sparklines and column charts. */
export const VERTICAL_EIGHTHS = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
/** Two vertical halves, for double-density line plots. */
export const HALF_BLOCKS = { upper: "▀", lower: "▄", full: "█", empty: " " } as const;
/** Quadrants indexed by a 4-bit mask: 1=TL, 2=TR, 4=BL, 8=BR. */
export const QUADRANTS = [
  " ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█",
];
export const SHADES = ["░", "▒", "▓", "█"];
export const ASCII_RAMP = [" ", ".", ":", "-", "=", "+", "*", "#", "%", "@"];

export type FillMode = "braille" | "block" | "half" | "quadrant" | "ascii";

/** Pick the glyph for a 0-1 fill of one cell, bottom-up. */
export function verticalGlyph(ratio: number, mode: FillMode = "block"): string {
  const r = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
  if (mode === "ascii") return r === 0 ? " " : r < 0.4 ? "." : r < 0.7 ? "=" : "#";
  if (mode === "half") return r === 0 ? " " : r < 0.5 ? "▄" : "█";
  const i = Math.round(r * 8);
  return i === 0 ? " " : VERTICAL_EIGHTHS[i];
}

/** Pick the glyph for a 0-1 fill of one cell, left to right. */
export function horizontalGlyph(ratio: number, mode: FillMode = "block"): string {
  const r = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
  if (mode === "ascii") return r === 0 ? " " : r < 0.5 ? "-" : "#";
  const i = Math.round(r * 8);
  return i === 0 ? " " : HORIZONTAL_EIGHTHS[i];
}

/** Map a 0-1 value onto a shade block, for heatmaps and dim fills. */
export function shadeGlyph(ratio: number, unicode = true): string {
  const r = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
  if (!unicode) return ASCII_RAMP[Math.round(r * (ASCII_RAMP.length - 1))];
  if (r === 0) return " ";
  return SHADES[Math.min(SHADES.length - 1, Math.floor(r * SHADES.length))];
}

/** Braille when the terminal supports it, blocks when it does not. */
export function bestMode(unicode: boolean, braille: boolean): FillMode {
  if (braille) return "braille";
  if (unicode) return "block";
  return "ascii";
}
