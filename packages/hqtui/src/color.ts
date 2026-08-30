/**
 * Colors are packed into a single 32-bit integer so a cell never needs an object.
 *
 *   0                       -> "terminal default"
 *   0x1000000 | 0xRRGGBB    -> truecolor
 *   0x2000000 | index       -> explicit 256-colour palette index
 */

export type Color = number;

export const DEFAULT_COLOR: Color = 0;
const RGB_FLAG = 0x1000000;
const IDX_FLAG = 0x2000000;

/** Truecolor from 0-255 components. */
export function rgb(r: number, g: number, b: number): Color {
  return RGB_FLAG | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

/** `hex("#00d7ff")`, `hex("#0df")` or `hex(0x00d7ff)`. */
export function hex(value: string | number): Color {
  if (typeof value === "number") return RGB_FLAG | (value & 0xffffff);
  let s = value.trim().replace(/^#/, "");
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return RGB_FLAG | (Number.parseInt(s, 16) & 0xffffff);
}

/** An explicit xterm-256 palette entry (rarely needed; truecolor is quantized for you). */
export function ansi256(index: number): Color {
  return IDX_FLAG | (index & 255);
}

export function isDefault(c: Color): boolean {
  return c === DEFAULT_COLOR;
}

export function red(c: Color): number {
  return (c >> 16) & 255;
}
export function green(c: Color): number {
  return (c >> 8) & 255;
}
export function blue(c: Color): number {
  return c & 255;
}

/** Mix two colors. `t` of 0 returns `a`, 1 returns `b`. Software alpha — terminals have none. */
export function mix(a: Color, b: Color, t: number): Color {
  if (isDefault(a) || isDefault(b)) return t < 0.5 ? a : b;
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return rgb(
    Math.round(red(a) + (red(b) - red(a)) * k),
    Math.round(green(a) + (green(b) - green(a)) * k),
    Math.round(blue(a) + (blue(b) - blue(a)) * k),
  );
}

/** Blend a color over a background at `alpha` (0-1). Used for subtle fills and shadows. */
export function alpha(fg: Color, bg: Color, a: number): Color {
  return mix(bg, fg, a);
}

export function lighten(c: Color, amount = 0.2): Color {
  return mix(c, rgb(255, 255, 255), amount);
}

export function darken(c: Color, amount = 0.2): Color {
  return mix(c, rgb(0, 0, 0), amount);
}

/** Relative luminance, 0-1. */
export function luminance(c: Color): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(red(c)) + 0.7152 * f(green(c)) + 0.0722 * f(blue(c));
}

/** WCAG contrast ratio between two colors (1-21). */
export function contrast(a: Color, b: Color): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A multi-stop gradient. Returns a sampler: `g(0)` is the first stop, `g(1)` the last.
 *
 *   const heat = gradient(["#00d7ff", "#5fff87", "#ffd75f", "#ff5f5f"]);
 *   heat(0.75);
 */
export function gradient(stops: (Color | string)[]): (t: number) => Color {
  const cols = stops.map((s) => (typeof s === "string" ? hex(s) : s));
  if (cols.length === 0) return () => DEFAULT_COLOR;
  if (cols.length === 1) return () => cols[0];
  return (t: number) => {
    const k = t < 0 ? 0 : t > 1 ? 1 : t;
    const pos = k * (cols.length - 1);
    const i = Math.min(Math.floor(pos), cols.length - 2);
    return mix(cols[i], cols[i + 1], pos - i);
  };
}

/** Sample `n` evenly spaced colors from a gradient. */
export function gradientSteps(stops: (Color | string)[], n: number): Color[] {
  const g = gradient(stops);
  const out: Color[] = [];
  for (let i = 0; i < n; i++) out.push(g(n === 1 ? 0 : i / (n - 1)));
  return out;
}

const CUBE = [0, 95, 135, 175, 215, 255];

function nearestCubeIndex(v: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < 6; i++) {
    const d = Math.abs(CUBE[i] - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Quantize truecolor to the xterm-256 palette (used when COLORTERM is absent). */
export function to256(c: Color): number {
  if ((c & IDX_FLAG) !== 0) return c & 255;
  const r = red(c);
  const g = green(c);
  const b = blue(c);
  // Grey ramp often beats the cube for desaturated colors.
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 24);
  }
  return 16 + 36 * nearestCubeIndex(r) + 6 * nearestCubeIndex(g) + nearestCubeIndex(b);
}

const BASE16: [number, number, number][] = [
  [0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16],
  [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229],
  [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67],
  [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255],
];

/** Quantize truecolor to the 16-color palette (last-resort terminals). */
export function to16(c: Color): number {
  if ((c & IDX_FLAG) !== 0) {
    const i = c & 255;
    return i < 16 ? i : to16(from256(i));
  }
  const r = red(c);
  const g = green(c);
  const b = blue(c);
  let best = 7;
  let bestD = Infinity;
  for (let i = 0; i < 16; i++) {
    const [br, bg, bb] = BASE16[i];
    const d = (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Convert a 256-palette index back to truecolor. */
export function from256(index: number): Color {
  const i = index & 255;
  if (i < 16) {
    const [r, g, b] = BASE16[i];
    return rgb(r, g, b);
  }
  if (i >= 232) {
    const v = 8 + (i - 232) * 10;
    return rgb(v, v, v);
  }
  const n = i - 16;
  return rgb(CUBE[Math.floor(n / 36) % 6], CUBE[Math.floor(n / 6) % 6], CUBE[n % 6]);
}

/** Desaturate towards grey — powers `monochrome` mode. */
export function grayscale(c: Color): Color {
  if (isDefault(c)) return c;
  const v = Math.round(0.299 * red(c) + 0.587 * green(c) + 0.114 * blue(c));
  return rgb(v, v, v);
}
