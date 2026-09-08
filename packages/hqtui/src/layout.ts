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
/**
 * `gap` may be one number for every seam, or one per seam. The per-seam form
 * exists so collapsed borders can be a gap of minus one between two panels and
 * the ordinary gap everywhere else on the same row.
 */
export function solve(total: number, items: Constraint[], gap: number | number[] = 0): number[] {
  const n = items.length;
  if (n === 0) return [];
  const gapTotal = Array.isArray(gap)
    ? gap.slice(0, n - 1).reduce((sum, value) => sum + value, 0)
    : gap * (n - 1);
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

/**
 * Where leftover space goes.
 *
 * It only ever applies when there is slack, and a container holding any `fr`
 * or `fill` child has none -- that child has already absorbed it. So this is
 * inert exactly where it would otherwise fight with the constraints.
 */
export type Justify =
  | "start"
  | "end"
  | "center"
  | "space-between"
  | "space-around"
  | "space-evenly";

/**
 * How much slack sits before item `i`, as an exact fraction.
 *
 * Every mode is a different answer to that one question, which is why they can
 * share the rounding below rather than each doing their own and each getting a
 * different kind of off-by-one.
 */
function before(i: number, slack: number, count: number, justify: Justify): number {
  switch (justify) {
    case "end":
      return slack;
    case "center":
      // Floor, so an odd cell falls after the content rather than before it.
      // That is what CSS and ratatui do, and it is what reads as centred.
      return Math.floor(slack / 2);
    case "space-between":
      // One child has nothing to sit between, so it stays where it started.
      return count > 1 ? (i * slack) / (count - 1) : 0;
    case "space-evenly":
      return ((i + 1) * slack) / (count + 1);
    case "space-around":
      // Half a share at each end, a whole one between.
      return ((i + 0.5) * slack) / count;
    default:
      return 0;
  }
}

/**
 * The offset before the first child, and the extra added at each seam.
 *
 * Cells are whole, and rounding each gap on its own loses a cell here and
 * gains one there. Rounding the *cumulative* offset instead and taking
 * differences means the parts always add up to exactly the slack, whatever the
 * mode and however awkward the division.
 */
export function distribute(
  slack: number,
  count: number,
  justify: Justify,
): { lead: number; seams: number[] } {
  const seams = new Array<number>(Math.max(0, count - 1)).fill(0);
  if (slack <= 0 || count === 0 || justify === "start") return { lead: 0, seams };

  const at = (i: number): number => Math.round(before(i, slack, count, justify));
  for (let i = 0; i + 1 < count; i++) seams[i] = at(i + 1) - at(i);
  return { lead: at(0), seams };
}

/** Lay children out along one axis inside `rect`. */
export function stack(
  rect: Rect,
  items: Constraint[],
  direction: "row" | "column",
  gap: number | number[] = 0,
  justify: Justify = "start",
): Rect[] {
  const horizontal = direction === "row";
  const axis = horizontal ? rect.width : rect.height;
  const sizes = solve(axis, items, gap);
  const seam = (i: number) => (Array.isArray(gap) ? (gap[i] ?? 0) : gap);

  let gapTotal = 0;
  for (let i = 0; i + 1 < sizes.length; i++) gapTotal += seam(i);
  const slack = Math.max(0, axis - sizes.reduce((a, b) => a + b, 0) - gapTotal);
  const { lead, seams } = distribute(slack, sizes.length, justify);

  const out: Rect[] = [];
  let offset = (horizontal ? rect.x : rect.y) + lead;
  sizes.forEach((size, i) => {
    out.push(
      horizontal
        ? { x: offset, y: rect.y, width: size, height: rect.height }
        : { x: rect.x, y: offset, width: rect.width, height: size },
    );
    offset += size + seam(i) + (seams[i] ?? 0);
  });
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
