/**
 * Braille turns every terminal cell into a 2x4 pixel matrix, which is why a
 * terminal graph can look like a real plot instead of a bar chart of hashes.
 */

const BRAILLE_BASE = 0x2800;
// Dot numbering is column-major and famously not sequential.
const DOT_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

export class BrailleCanvas {
  /** Pixel dimensions (cells * 2 wide, cells * 4 tall). */
  readonly width: number;
  readonly height: number;
  readonly cols: number;
  readonly rows: number;
  private dots: Uint8Array;

  constructor(cols: number, rows: number) {
    this.cols = Math.max(0, cols | 0);
    this.rows = Math.max(0, rows | 0);
    this.width = this.cols * 2;
    this.height = this.rows * 4;
    this.dots = new Uint8Array(this.cols * this.rows);
  }

  clear(): void {
    this.dots.fill(0);
  }

  /**
   * Set one pixel. Out-of-range coordinates are ignored, not clamped — and the
   * test is written positively so that NaN, which compares false against
   * everything, is ignored too rather than landing in cell 0.
   */
  pixel(x: number, y: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (!(px >= 0 && py >= 0 && px < this.width && py < this.height)) return;
    const cell = (py >> 2) * this.cols + (px >> 1);
    this.dots[cell] |= DOT_BITS[py & 3][px & 1];
  }

  unset(x: number, y: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (!(px >= 0 && py >= 0 && px < this.width && py < this.height)) return;
    const cell = (py >> 2) * this.cols + (px >> 1);
    this.dots[cell] &= ~DOT_BITS[py & 3][px & 1];
  }

  get(x: number, y: number): boolean {
    const px = Math.round(x);
    const py = Math.round(y);
    if (!(px >= 0 && py >= 0 && px < this.width && py < this.height)) return false;
    const cell = (py >> 2) * this.cols + (px >> 1);
    return (this.dots[cell] & DOT_BITS[py & 3][px & 1]) !== 0;
  }

  /**
   * Coordinates are clamped to this before anything iterates over them. It is
   * far larger than any canvas and far below 2^53, where `x += 1` stops
   * advancing and a Bresenham walk can never reach its endpoint.
   */
  private static readonly LIMIT = 1e7;

  /**
   * Above this many Bresenham steps the walk is clipped to the canvas first.
   * Clipping shifts which pixels a partly-offscreen line lands on, so it is
   * reserved for walks long enough that their exact pattern cannot matter.
   */
  private static readonly MAX_WALK = 100_000;

  /** Finite, bounded, and direction-preserving. NaN has no direction. */
  private static finite(v: number): number | null {
    if (Number.isNaN(v)) return null;
    const L = BrailleCanvas.LIMIT;
    return v > L ? L : v < -L ? -L : v;
  }

  /**
   * The inclusive row/column span an axis-aligned loop should cover, clipped to
   * the canvas. Nothing outside it can draw, so clipping here is what makes
   * every loop below finite for any input — infinite, enormous, or NaN.
   */
  private span(a: number, b: number, limit: number): [number, number] {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (!(lo <= hi)) return [0, -1];
    return [Math.max(0, Math.ceil(lo)), Math.min(limit - 1, Math.floor(hi))];
  }

  /**
   * Liang-Barsky. Clipping before the walk — rather than clamping the endpoints,
   * which would change the slope — keeps the line where it belongs and bounds
   * the number of steps to the canvas.
   */
  private clip(
    x0: number, y0: number, x1: number, y1: number,
  ): [number, number, number, number] | null {
    const fx0 = BrailleCanvas.finite(x0), fy0 = BrailleCanvas.finite(y0);
    const fx1 = BrailleCanvas.finite(x1), fy1 = BrailleCanvas.finite(y1);
    if (fx0 === null || fy0 === null || fx1 === null || fy1 === null) return null;
    const dx = fx1 - fx0;
    const dy = fy1 - fy0;
    let t0 = 0;
    let t1 = 1;
    const edges: [number, number][] = [
      [-dx, fx0 - 0], [dx, this.width - 1 - fx0],
      [-dy, fy0 - 0], [dy, this.height - 1 - fy0],
    ];
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) return null;
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
    return [fx0 + t0 * dx, fy0 + t0 * dy, fx0 + t1 * dx, fy0 + t1 * dy];
  }

  /** Bresenham. Used for every line graph in the library. */
  line(x0: number, y0: number, x1: number, y1: number): void {
    // The walk below only ends at `x === ex && y === ey`. Testing the endpoints
    // for finiteness is not enough to guarantee it gets there: `dx` is derived
    // from them and overflows to Infinity, and past 2^53 `x += 1` does not
    // advance at all. Clipping to the canvas bounds the walk for every input.
    let ax = BrailleCanvas.finite(x0);
    let ay = BrailleCanvas.finite(y0);
    let bx = BrailleCanvas.finite(x1);
    let by = BrailleCanvas.finite(y1);
    if (ax === null || ay === null || bx === null || by === null) return;
    if (Math.max(Math.abs(bx - ax), Math.abs(by - ay)) > BrailleCanvas.MAX_WALK) {
      const clipped = this.clip(ax, ay, bx, by);
      if (clipped === null) return;
      [ax, ay, bx, by] = clipped;
    }
    let x = Math.round(ax);
    let y = Math.round(ay);
    const ex = Math.round(bx);
    const ey = Math.round(by);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.pixel(x, y);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  polyline(points: [number, number][]): void {
    for (let i = 1; i < points.length; i++) {
      this.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    }
  }

  vline(x: number, y0: number, y1: number): void {
    const [a, b] = this.span(y0, y1, this.height);
    for (let y = a; y <= b; y++) this.pixel(x, y);
  }

  hline(y: number, x0: number, x1: number): void {
    const [a, b] = this.span(x0, x1, this.width);
    for (let x = a; x <= b; x++) this.pixel(x, y);
  }

  rect(x0: number, y0: number, x1: number, y1: number): void {
    this.hline(y0, x0, x1);
    this.hline(y1, x0, x1);
    this.vline(x0, y0, y1);
    this.vline(x1, y0, y1);
  }

  fillRect(x0: number, y0: number, x1: number, y1: number): void {
    const [a, b] = this.span(y0, y1, this.height);
    for (let y = a; y <= b; y++) this.hline(y, x0, x1);
  }

  /** Fill the area under a series — the shaded region of an area graph. */
  fillUnder(points: [number, number][], baseline: number): void {
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      // Bounded by the canvas: a span wider than it cannot add a new column.
      const steps = Math.max(1, Math.min(this.width, Math.round(Math.abs(x1 - x0)) || 1));
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        this.vline(x, y, baseline);
      }
    }
  }

  circle(cx: number, cy: number, radius: number): void {
    // A radius larger than the canvas draws the same arc as one exactly its
    // size, and an unbounded one never finishes the `x >= y` walk.
    const r = BrailleCanvas.finite(radius);
    if (r === null) return;
    let x = Math.round(Math.min(Math.abs(r), this.width + this.height));
    let y = 0;
    let err = 1 - x;
    while (x >= y) {
      this.pixel(cx + x, cy + y);
      this.pixel(cx + y, cy + x);
      this.pixel(cx - y, cy + x);
      this.pixel(cx - x, cy + y);
      this.pixel(cx - x, cy - y);
      this.pixel(cx - y, cy - x);
      this.pixel(cx + y, cy - x);
      this.pixel(cx + x, cy - y);
      y++;
      if (err < 0) err += 2 * y + 1;
      else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }

  /** The Braille codepoint for one cell, or 0 when the cell is empty. */
  cell(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return 0;
    const bits = this.dots[row * this.cols + col];
    return bits === 0 ? 0 : BRAILLE_BASE | bits;
  }

  /** Rows of Braille text — handy for tests and for the HTML renderer. */
  toLines(): string[] {
    const lines: string[] = [];
    for (let row = 0; row < this.rows; row++) {
      let line = "";
      for (let col = 0; col < this.cols; col++) {
        const c = this.cell(col, row);
        line += c === 0 ? " " : String.fromCodePoint(c);
      }
      lines.push(line);
    }
    return lines;
  }
}
