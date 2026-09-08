//! Braille turns every terminal cell into a 2x4 pixel matrix, which is why a
//! terminal graph can look like a real plot instead of a bar chart of hashes.

use crate::color::round_half_up;

const BRAILLE_BASE: u32 = 0x2800;
// Dot numbering is column-major and famously not sequential.
const DOT_BITS: [[u8; 2]; 4] = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];

/// `Math.min` and `Math.max` propagate NaN; Rust's `f64::min`/`max` return the
/// other operand instead. Every bounds test below is written so that NaN falls
/// out rather than landing in cell zero, and that only holds with JavaScript's
/// semantics — so they are spelled out.
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}

pub struct BrailleCanvas {
    /// Pixel dimensions (cells * 2 wide, cells * 4 tall).
    pub width: usize,
    pub height: usize,
    pub cols: usize,
    pub rows: usize,
    dots: Vec<u8>,
}

/// Round, treating a value within a hair of .5 as the tie it mathematically is.
///
/// Plot geometry runs through cos and sin, and libm implementations differ by an
/// ULP at the exact angles where a coordinate lands on .5 — cos(120°) is -0.5,
/// and V8 returns a hair under it where Rust returns a hair over. Rounding the
/// raw value lets that ULP decide a pixel, so the same widget at the same size
/// differs between ports. The tolerance is far wider than an ULP and far
/// narrower than anything geometric.
fn snap_round(v: f64) -> f64 {
    round_half_up(if v >= 0.0 { v + 1e-9 } else { v - 1e-9 })
}

impl BrailleCanvas {
    /// Coordinates are clamped to this before anything iterates over them. It
    /// is far larger than any canvas and far below 2^53, where `x += 1` stops
    /// advancing and a Bresenham walk can never reach its endpoint.
    const LIMIT: f64 = 1e7;

    /// Above this many Bresenham steps the walk is clipped to the canvas first.
    /// Clipping shifts which pixels a partly-offscreen line lands on, so it is
    /// reserved for walks long enough that their exact pattern cannot matter.
    const MAX_WALK: f64 = 100_000.0;

    pub fn new(cols: usize, rows: usize) -> BrailleCanvas {
        BrailleCanvas {
            width: cols * 2,
            height: rows * 4,
            cols,
            rows,
            dots: vec![0; cols * rows],
        }
    }

    pub fn clear(&mut self) {
        self.dots.fill(0);
    }

    /// Resolve a pixel coordinate to a cell index and dot bit, or `None` when
    /// it is outside the canvas. The test is written positively so that NaN,
    /// which compares false against everything, is ignored rather than landing
    /// in cell 0.
    fn locate(&self, x: f64, y: f64) -> Option<(usize, u8)> {
        let px = snap_round(x);
        let py = snap_round(y);
        if !(px >= 0.0 && py >= 0.0 && px < self.width as f64 && py < self.height as f64) {
            return None;
        }
        let (px, py) = (px as usize, py as usize);
        Some(((py >> 2) * self.cols + (px >> 1), DOT_BITS[py & 3][px & 1]))
    }

    /// Set one pixel. Out-of-range coordinates are ignored, not clamped.
    pub fn pixel(&mut self, x: f64, y: f64) {
        if let Some((cell, bit)) = self.locate(x, y) {
            self.dots[cell] |= bit;
        }
    }

    pub fn unset(&mut self, x: f64, y: f64) {
        if let Some((cell, bit)) = self.locate(x, y) {
            self.dots[cell] &= !bit;
        }
    }

    pub fn get(&self, x: f64, y: f64) -> bool {
        match self.locate(x, y) {
            Some((cell, bit)) => self.dots[cell] & bit != 0,
            None => false,
        }
    }

    /// Finite, bounded, and direction-preserving. NaN has no direction.
    fn finite(v: f64) -> Option<f64> {
        if v.is_nan() {
            return None;
        }
        Some(if v > Self::LIMIT {
            Self::LIMIT
        } else if v < -Self::LIMIT {
            -Self::LIMIT
        } else {
            v
        })
    }

    /// The inclusive row/column span an axis-aligned loop should cover, clipped
    /// to the canvas. Nothing outside it can draw, so clipping here is what
    /// makes every loop below finite for any input — infinite, enormous or NaN.
    fn span(&self, a: f64, b: f64, limit: usize) -> (i64, i64) {
        let lo = js_min(a, b);
        let hi = js_max(a, b);
        if !(lo <= hi) {
            return (0, -1);
        }
        let start = js_max(0.0, lo.ceil());
        let end = js_min(limit as f64 - 1.0, hi.floor());
        (start as i64, end as i64)
    }

    /// Liang-Barsky. Clipping before the walk — rather than clamping the
    /// endpoints, which would change the slope — keeps the line where it
    /// belongs and bounds the number of steps to the canvas.
    fn clip(&self, x0: f64, y0: f64, x1: f64, y1: f64) -> Option<(f64, f64, f64, f64)> {
        let fx0 = Self::finite(x0)?;
        let fy0 = Self::finite(y0)?;
        let fx1 = Self::finite(x1)?;
        let fy1 = Self::finite(y1)?;
        let dx = fx1 - fx0;
        let dy = fy1 - fy0;
        let mut t0 = 0.0f64;
        let mut t1 = 1.0f64;
        let edges = [
            (-dx, fx0),
            (dx, self.width as f64 - 1.0 - fx0),
            (-dy, fy0),
            (dy, self.height as f64 - 1.0 - fy0),
        ];
        for (p, q) in edges {
            if p == 0.0 {
                if q < 0.0 {
                    return None;
                }
                continue;
            }
            let r = q / p;
            if p < 0.0 {
                if r > t1 {
                    return None;
                }
                if r > t0 {
                    t0 = r;
                }
            } else {
                if r < t0 {
                    return None;
                }
                if r < t1 {
                    t1 = r;
                }
            }
        }
        Some((fx0 + t0 * dx, fy0 + t0 * dy, fx0 + t1 * dx, fy0 + t1 * dy))
    }

    /// Bresenham. Used for every line graph in the library.
    pub fn line(&mut self, x0: f64, y0: f64, x1: f64, y1: f64) {
        // The walk below only ends at `x == ex && y == ey`. Testing the
        // endpoints for finiteness is not enough to guarantee it gets there:
        // the deltas are derived from them and overflow, and past 2^53 `x += 1`
        // does not advance at all. Clipping to the canvas bounds the walk for
        // every input.
        let (mut ax, mut ay, mut bx, mut by) = match (
            Self::finite(x0),
            Self::finite(y0),
            Self::finite(x1),
            Self::finite(y1),
        ) {
            (Some(a), Some(b), Some(c), Some(d)) => (a, b, c, d),
            _ => return,
        };
        if js_max((bx - ax).abs(), (by - ay).abs()) > Self::MAX_WALK {
            match self.clip(ax, ay, bx, by) {
                Some((a, b, c, d)) => {
                    ax = a;
                    ay = b;
                    bx = c;
                    by = d;
                }
                None => return,
            }
        }

        let mut x = round_half_up(ax) as i64;
        let mut y = round_half_up(ay) as i64;
        let ex = round_half_up(bx) as i64;
        let ey = round_half_up(by) as i64;
        let dx = (ex - x).abs();
        let dy = -(ey - y).abs();
        let sx: i64 = if x < ex { 1 } else { -1 };
        let sy: i64 = if y < ey { 1 } else { -1 };
        let mut err = dx + dy;
        loop {
            self.pixel(x as f64, y as f64);
            if x == ex && y == ey {
                break;
            }
            let e2 = 2 * err;
            if e2 >= dy {
                err += dy;
                x += sx;
            }
            if e2 <= dx {
                err += dx;
                y += sy;
            }
        }
    }

    pub fn polyline(&mut self, points: &[(f64, f64)]) {
        for i in 1..points.len() {
            self.line(points[i - 1].0, points[i - 1].1, points[i].0, points[i].1);
        }
    }

    pub fn vline(&mut self, x: f64, y0: f64, y1: f64) {
        let (a, b) = self.span(y0, y1, self.height);
        for y in a..=b {
            self.pixel(x, y as f64);
        }
    }

    pub fn hline(&mut self, y: f64, x0: f64, x1: f64) {
        let (a, b) = self.span(x0, x1, self.width);
        for x in a..=b {
            self.pixel(x as f64, y);
        }
    }

    pub fn rect(&mut self, x0: f64, y0: f64, x1: f64, y1: f64) {
        self.hline(y0, x0, x1);
        self.hline(y1, x0, x1);
        self.vline(x0, y0, y1);
        self.vline(x1, y0, y1);
    }

    pub fn fill_rect(&mut self, x0: f64, y0: f64, x1: f64, y1: f64) {
        let (a, b) = self.span(y0, y1, self.height);
        for y in a..=b {
            self.hline(y as f64, x0, x1);
        }
    }

    /// Fill the area under a series — the shaded region of an area graph.
    pub fn fill_under(&mut self, points: &[(f64, f64)], baseline: f64) {
        for i in 1..points.len() {
            let (x0, y0) = points[i - 1];
            let (x1, y1) = points[i];
            // Bounded by the canvas: a span wider than it cannot add a column.
            let raw = round_half_up((x1 - x0).abs());
            let raw = if raw == 0.0 { 1.0 } else { raw };
            let steps = js_max(1.0, js_min(self.width as f64, raw));
            let steps_i = steps as i64;
            for s in 0..=steps_i {
                let t = s as f64 / steps;
                let x = x0 + (x1 - x0) * t;
                let y = y0 + (y1 - y0) * t;
                self.vline(x, y, baseline);
            }
        }
    }

    pub fn circle(&mut self, cx: f64, cy: f64, radius: f64) {
        // A radius larger than the canvas draws the same arc as one exactly its
        // size, and an unbounded one never finishes the `x >= y` walk.
        let r = match Self::finite(radius) {
            Some(r) => r,
            None => return,
        };
        let mut x = round_half_up(js_min(r.abs(), (self.width + self.height) as f64)) as i64;
        let mut y = 0i64;
        let mut err = 1 - x;
        while x >= y {
            let (fx, fy) = (x as f64, y as f64);
            self.pixel(cx + fx, cy + fy);
            self.pixel(cx + fy, cy + fx);
            self.pixel(cx - fy, cy + fx);
            self.pixel(cx - fx, cy + fy);
            self.pixel(cx - fx, cy - fy);
            self.pixel(cx - fy, cy - fx);
            self.pixel(cx + fy, cy - fx);
            self.pixel(cx + fx, cy - fy);
            y += 1;
            if err < 0 {
                err += 2 * y + 1;
            } else {
                x -= 1;
                err += 2 * (y - x) + 1;
            }
        }
    }

    /// The Braille codepoint for one cell, or 0 when the cell is empty.
    pub fn cell(&self, col: usize, row: usize) -> u32 {
        if col >= self.cols || row >= self.rows {
            return 0;
        }
        let bits = self.dots[row * self.cols + col];
        if bits == 0 {
            0
        } else {
            BRAILLE_BASE | bits as u32
        }
    }

    /// Rows of Braille text — handy for tests and for the HTML renderer.
    pub fn to_lines(&self) -> Vec<String> {
        (0..self.rows)
            .map(|row| {
                (0..self.cols)
                    .map(|col| match self.cell(col, row) {
                        0 => ' ',
                        c => char::from_u32(c).unwrap_or(' '),
                    })
                    .collect()
            })
            .collect()
    }
}
