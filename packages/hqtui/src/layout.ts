/**
 * Sizes are resolved once per frame with a single pass. No manual coordinate
 * arithmetic should ever appear in application code.
 *
 *   12       12 columns/rows
 *   "40%"    40% of the container
 *   "2fr"    two shares of whatever is left over
 *   "auto"   whatever the widget says it needs
 *   "fill"   same as "1fr"
 */
export type Size = number | string;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Constraint {
  size?: Size;
  min?: number;
  max?: number;
  /** Natural size, used by "auto" and as the floor for flexible items. */
  intrinsic?: number;
}

export const fixed = (n: number): Size => n;
export const percent = (n: number): Size => `${n}%`;
export const flex = (n = 1): Size => `${n}fr`;
export const auto: Size = "auto";
export const fill: Size = "fill";
export const remaining = (): Size => "fill";
export const minmax = (min: number, max: number): Constraint => ({ size: "fill", min, max });

interface Resolved {
  value: number;
  fr: number;
  min: number;
  max: number;
}

function parse(c: Constraint, total: number): Resolved {
  const min = c.min ?? 0;
  const max = c.max ?? Infinity;
  const size = c.size ?? "auto";
  if (typeof size === "number") return { value: size, fr: 0, min, max };
  const s = size.trim();
  if (s === "auto") return { value: c.intrinsic ?? 0, fr: 0, min, max };
  if (s === "fill") return { value: 0, fr: 1, min, max };
  if (s.endsWith("%")) {
    const pct = Number.parseFloat(s) / 100;
    return { value: Math.round(total * (Number.isFinite(pct) ? pct : 0)), fr: 0, min, max };
  }
  if (s.endsWith("fr")) {
    const n = Number.parseFloat(s);
    return { value: 0, fr: Number.isFinite(n) && n > 0 ? n : 1, min, max };
  }
  const n = Number.parseFloat(s);
  return { value: Number.isFinite(n) ? n : 0, fr: 0, min, max };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Distribute `total` across `items`, honouring gaps, fractions, and min/max.
 * Always returns non-negative integers that sum to at most `total`.
 */
export function solve(total: number, items: Constraint[], gap = 0): number[] {
  const n = items.length;
  if (n === 0) return [];
  const gapTotal = gap * (n - 1);
  const available = Math.max(0, total - gapTotal);
  const parsed = items.map((c) => parse(c, available));

  let used = 0;
  let frTotal = 0;
  const out = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    const p = parsed[i];
    if (p.fr > 0) {
      frTotal += p.fr;
      out[i] = -1; // resolved in the flexible pass
    } else {
      out[i] = clamp(Math.round(p.value), p.min, Math.min(p.max, available));
      used += out[i];
    }
  }

  let free = Math.max(0, available - used);
  if (frTotal > 0) {
    // Two passes: clamped items give their surplus back to the rest.
    const flexible: number[] = [];
    for (let i = 0; i < n; i++) if (out[i] === -1) flexible.push(i);

    let remainingFr = frTotal;
    let pool = free;
    const pending = new Set(flexible);
    let changed = true;
    while (changed && pending.size > 0) {
      changed = false;
      for (const i of [...pending]) {
        const p = parsed[i];
        const share = remainingFr > 0 ? (pool * p.fr) / remainingFr : 0;
        const clamped = clamp(share, p.min, p.max);
        if (clamped !== share) {
          out[i] = Math.round(clamped);
          pool -= out[i];
          remainingFr -= p.fr;
          pending.delete(i);
          changed = true;
        }
      }
    }
    // Distribute what is left, giving rounding remainder to the largest shares.
    let assigned = 0;
    const order = [...pending];
    order.forEach((i, k) => {
      const p = parsed[i];
      const exact = remainingFr > 0 ? (pool * p.fr) / remainingFr : 0;
      const v = k === order.length - 1 ? Math.max(0, pool - assigned) : Math.floor(exact);
      out[i] = v;
      assigned += v;
    });
    free = 0;
  }

  // Overflow: shrink from the end until it fits rather than drawing outside.
  let sum = out.reduce((a, b) => a + b, 0);
  if (sum > available) {
    for (let i = n - 1; i >= 0 && sum > available; i--) {
      const shrink = Math.min(out[i] - parsed[i].min, sum - available);
      if (shrink > 0) {
        out[i] -= shrink;
        sum -= shrink;
      }
    }
    for (let i = n - 1; i >= 0 && sum > available; i--) {
      const shrink = Math.min(out[i], sum - available);
      out[i] -= shrink;
      sum -= shrink;
    }
  }

  return out;
}

/** Lay children out along one axis inside `rect`. */
export function stack(
  rect: Rect,
  items: Constraint[],
  direction: "row" | "column",
  gap = 0,
): Rect[] {
  const horizontal = direction === "row";
  const sizes = solve(horizontal ? rect.width : rect.height, items, gap);
  const out: Rect[] = [];
  let offset = horizontal ? rect.x : rect.y;
  for (const size of sizes) {
    out.push(
      horizontal
        ? { x: offset, y: rect.y, width: size, height: rect.height }
        : { x: rect.x, y: offset, width: rect.width, height: size },
    );
    offset += size + gap;
  }
  return out;
}

export type Padding = number | [number, number] | [number, number, number, number] |
  { top?: number; right?: number; bottom?: number; left?: number };

export function normalizePadding(p: Padding | undefined): [number, number, number, number] {
  if (p === undefined) return [0, 0, 0, 0];
  if (typeof p === "number") return [p, p, p, p];
  if (Array.isArray(p)) {
    if (p.length === 2) return [p[0], p[1], p[0], p[1]];
    return [p[0], p[1], p[2], p[3]];
  }
  return [p.top ?? 0, p.right ?? 0, p.bottom ?? 0, p.left ?? 0];
}

/** Shrink a rect by padding, never past zero. */
export function inset(rect: Rect, padding: Padding): Rect {
  const [t, r, b, l] = normalizePadding(padding);
  return {
    x: rect.x + l,
    y: rect.y + t,
    width: Math.max(0, rect.width - l - r),
    height: Math.max(0, rect.height - t - b),
  };
}

export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, x2 - x), height: Math.max(0, y2 - y) };
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

export function isEmpty(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}
