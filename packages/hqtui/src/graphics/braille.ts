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

  /** Set one pixel. Out-of-range coordinates are ignored, not clamped. */
  pixel(x: number, y: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const cell = (py >> 2) * this.cols + (px >> 1);
    this.dots[cell] |= DOT_BITS[py & 3][px & 1];
  }

  unset(x: number, y: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const cell = (py >> 2) * this.cols + (px >> 1);
    this.dots[cell] &= ~DOT_BITS[py & 3][px & 1];
  }

  get(x: number, y: number): boolean {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return false;
    const cell = (py >> 2) * this.cols + (px >> 1);
    return (this.dots[cell] & DOT_BITS[py & 3][px & 1]) !== 0;
  }

  /** Bresenham. Used for every line graph in the library. */
  line(x0: number, y0: number, x1: number, y1: number): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
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
    const a = Math.min(y0, y1);
    const b = Math.max(y0, y1);
    for (let y = a; y <= b; y++) this.pixel(x, y);
  }

  hline(y: number, x0: number, x1: number): void {
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    for (let x = a; x <= b; x++) this.pixel(x, y);
  }

  rect(x0: number, y0: number, x1: number, y1: number): void {
    this.hline(y0, x0, x1);
    this.hline(y1, x0, x1);
    this.vline(x0, y0, y1);
    this.vline(x1, y0, y1);
  }

  fillRect(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      this.hline(y, x0, x1);
    }
  }

  /** Fill the area under a series — the shaded region of an area graph. */
  fillUnder(points: [number, number][], baseline: number): void {
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const steps = Math.max(1, Math.round(Math.abs(x1 - x0)));
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        this.vline(x, y, baseline);
      }
    }
  }

  circle(cx: number, cy: number, radius: number): void {
    let x = Math.round(radius);
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
