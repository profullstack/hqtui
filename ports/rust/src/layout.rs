//! Sizes are resolved once per frame with a single pass. No manual coordinate
//! arithmetic should ever appear in application code.
//!
//! ```text
//! Size::Cells(12)     12 columns/rows
//! Size::Percent(40.0) 40% of the container
//! Size::Fr(2.0)       two shares of whatever is left over
//! Size::Auto          whatever the widget says it needs
//! Size::Fill          same as Fr(1.0)
//! ```
//!
//! The reference implementation spells these as numbers and strings (`"2fr"`,
//! `"40%"`). Both spellings work here: `Size::from(12)`, `Size::from("2fr")`.

use crate::color::round_half_up;

/// How much space an item wants along the main axis.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Size {
    Cells(i64),
    Percent(f64),
    Fr(f64),
    Auto,
    Fill,
}

impl Default for Size {
    fn default() -> Size {
        Size::Auto
    }
}

impl Size {
    /// Parse the string spelling the TypeScript API uses. Anything
    /// unrecognisable becomes zero cells, matching `Number.parseFloat`'s NaN
    /// fallback there.
    pub fn parse(spec: &str) -> Size {
        let s = spec.trim();
        if s == "auto" {
            return Size::Auto;
        }
        if s == "fill" {
            return Size::Fill;
        }
        if let Some(rest) = s.strip_suffix('%') {
            return Size::Percent(rest.trim().parse::<f64>().unwrap_or(0.0));
        }
        if let Some(rest) = s.strip_suffix("fr") {
            let n = rest.trim().parse::<f64>().unwrap_or(1.0);
            return Size::Fr(if n > 0.0 { n } else { 1.0 });
        }
        Size::Cells(leading_float(s).unwrap_or(0.0) as i64)
    }
}

/// `Number.parseFloat` semantics: read as much of a leading number as parses.
fn leading_float(s: &str) -> Option<f64> {
    let mut end = 0usize;
    let bytes = s.as_bytes();
    let mut seen_digit = false;
    let mut seen_dot = false;
    while end < bytes.len() {
        let c = bytes[end] as char;
        match c {
            '+' | '-' if end == 0 => {}
            '0'..='9' => seen_digit = true,
            '.' if !seen_dot => seen_dot = true,
            _ => break,
        }
        end += 1;
    }
    if !seen_digit {
        return None;
    }
    s[..end].parse::<f64>().ok()
}

impl From<i64> for Size {
    fn from(n: i64) -> Size {
        Size::Cells(n)
    }
}

impl From<i32> for Size {
    fn from(n: i32) -> Size {
        Size::Cells(n as i64)
    }
}

impl From<usize> for Size {
    fn from(n: usize) -> Size {
        Size::Cells(n as i64)
    }
}

impl From<&str> for Size {
    fn from(s: &str) -> Size {
        Size::parse(s)
    }
}

/// What one item contributes to a layout solve.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Constraint {
    pub size: Option<Size>,
    pub min: Option<usize>,
    pub max: Option<usize>,
    /// Natural size, used by `Auto` and as the floor for flexible items.
    pub intrinsic: Option<usize>,
}

impl Constraint {
    pub fn new(size: impl Into<Size>) -> Constraint {
        Constraint { size: Some(size.into()), ..Default::default() }
    }

    pub fn fixed(n: usize) -> Constraint {
        Constraint::new(Size::Cells(n as i64))
    }

    pub fn fill() -> Constraint {
        Constraint::new(Size::Fill)
    }

    pub fn flex(n: f64) -> Constraint {
        Constraint::new(Size::Fr(n))
    }

    pub fn auto(intrinsic: usize) -> Constraint {
        Constraint { size: Some(Size::Auto), intrinsic: Some(intrinsic), ..Default::default() }
    }

    pub fn minmax(min: usize, max: usize) -> Constraint {
        Constraint {
            size: Some(Size::Fill),
            min: Some(min),
            max: Some(max),
            intrinsic: None,
        }
    }

    pub fn with_min(mut self, min: usize) -> Constraint {
        self.min = Some(min);
        self
    }

    pub fn with_max(mut self, max: usize) -> Constraint {
        self.max = Some(max);
        self
    }

    pub fn with_intrinsic(mut self, intrinsic: usize) -> Constraint {
        self.intrinsic = Some(intrinsic);
        self
    }
}

/// A rectangle in absolute buffer coordinates.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Rect {
    pub x: isize,
    pub y: isize,
    pub width: usize,
    pub height: usize,
}

impl Rect {
    pub const fn new(x: isize, y: isize, width: usize, height: usize) -> Rect {
        Rect { x, y, width, height }
    }

    pub const fn is_empty(&self) -> bool {
        self.width == 0 || self.height == 0
    }

    pub fn contains(&self, x: isize, y: isize) -> bool {
        x >= self.x
            && y >= self.y
            && x < self.x + self.width as isize
            && y < self.y + self.height as isize
    }

    /// Shrink by padding, never past zero.
    pub fn inset(&self, padding: Padding) -> Rect {
        let (t, r, b, l) = padding.resolve();
        Rect {
            x: self.x + l as isize,
            y: self.y + t as isize,
            width: self.width.saturating_sub(l + r),
            height: self.height.saturating_sub(t + b),
        }
    }

    pub fn intersect(&self, other: Rect) -> Rect {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let x2 = (self.x + self.width as isize).min(other.x + other.width as isize);
        let y2 = (self.y + self.height as isize).min(other.y + other.height as isize);
        Rect {
            x,
            y,
            width: (x2 - x).max(0) as usize,
            height: (y2 - y).max(0) as usize,
        }
    }
}

/// Padding in the CSS shorthand orders: one value, vertical/horizontal, or all
/// four clockwise from the top.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Padding {
    #[default]
    None,
    All(usize),
    /// `(vertical, horizontal)`
    Axes(usize, usize),
    /// `(top, right, bottom, left)`
    Sides(usize, usize, usize, usize),
}

impl Padding {
    pub const fn resolve(self) -> (usize, usize, usize, usize) {
        match self {
            Padding::None => (0, 0, 0, 0),
            Padding::All(v) => (v, v, v, v),
            Padding::Axes(v, h) => (v, h, v, h),
            Padding::Sides(t, r, b, l) => (t, r, b, l),
        }
    }
}

impl From<usize> for Padding {
    fn from(v: usize) -> Padding {
        Padding::All(v)
    }
}

impl From<(usize, usize)> for Padding {
    fn from(v: (usize, usize)) -> Padding {
        Padding::Axes(v.0, v.1)
    }
}

/// Which way a container lays its children out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Row,
    Column,
}

#[derive(Clone, Copy)]
struct Resolved {
    value: f64,
    fr: f64,
    min: f64,
    max: f64,
}

fn parse_constraint(c: &Constraint, total: usize) -> Resolved {
    let min = c.min.unwrap_or(0) as f64;
    let max = c.max.map(|m| m as f64).unwrap_or(f64::INFINITY);
    match c.size.unwrap_or(Size::Auto) {
        Size::Cells(n) => Resolved { value: n as f64, fr: 0.0, min, max },
        Size::Auto => Resolved { value: c.intrinsic.unwrap_or(0) as f64, fr: 0.0, min, max },
        Size::Fill => Resolved { value: 0.0, fr: 1.0, min, max },
        Size::Percent(p) => {
            let pct = p / 100.0;
            let pct = if pct.is_finite() { pct } else { 0.0 };
            Resolved { value: round_half_up(total as f64 * pct), fr: 0.0, min, max }
        }
        Size::Fr(n) => Resolved {
            value: 0.0,
            fr: if n.is_finite() && n > 0.0 { n } else { 1.0 },
            min,
            max,
        },
    }
}

fn clamp(v: f64, min: f64, max: f64) -> f64 {
    v.min(max).max(min)
}

/// Distribute `total` across `items`, honouring gaps, fractions and min/max.
/// Always returns non-negative sizes that sum to at most `total`.
pub fn solve(total: usize, items: &[Constraint], gap: usize) -> Vec<usize> {
    let seams = vec![gap as isize; items.len().saturating_sub(1)];
    solve_with_gaps(total, items, &seams)
}

/// As `solve`, but with a gap per seam, which may be negative.
///
/// A negative seam is how collapsed borders work: two panels overlap by the
/// column their borders share, so the pair occupies one column less than the
/// sum of their widths.
pub fn solve_with_gaps(total: usize, items: &[Constraint], gaps: &[isize]) -> Vec<usize> {
    let n = items.len();
    if n == 0 {
        return Vec::new();
    }
    let gap_total: isize = gaps.iter().take(n - 1).sum();
    let available = (total as isize - gap_total).max(0) as usize;
    let parsed: Vec<Resolved> = items.iter().map(|c| parse_constraint(c, available)).collect();

    let mut used = 0i64;
    let mut fr_total = 0.0f64;
    // -1 marks an item resolved in the flexible pass below.
    let mut out = vec![-1i64; n];

    for i in 0..n {
        let p = parsed[i];
        if p.fr > 0.0 {
            fr_total += p.fr;
        } else {
            let v = clamp(round_half_up(p.value), p.min, p.max.min(available as f64));
            out[i] = v as i64;
            used += out[i];
        }
    }

    let free = (available as i64 - used).max(0) as f64;
    if fr_total > 0.0 {
        // Two passes: clamped items give their surplus back to the rest.
        let mut remaining_fr = fr_total;
        let mut pool = free;
        let mut pending: Vec<usize> = (0..n).filter(|&i| out[i] == -1).collect();

        let mut changed = true;
        while changed && !pending.is_empty() {
            changed = false;
            for i in pending.clone() {
                let p = parsed[i];
                let share = if remaining_fr > 0.0 { pool * p.fr / remaining_fr } else { 0.0 };
                let clamped = clamp(share, p.min, p.max);
                if clamped != share {
                    out[i] = round_half_up(clamped) as i64;
                    pool -= out[i] as f64;
                    remaining_fr -= p.fr;
                    pending.retain(|&j| j != i);
                    changed = true;
                }
            }
        }

        // Distribute what is left, giving the rounding remainder to the last.
        let mut assigned = 0i64;
        let count = pending.len();
        for (k, &i) in pending.iter().enumerate() {
            let p = parsed[i];
            let exact = if remaining_fr > 0.0 { pool * p.fr / remaining_fr } else { 0.0 };
            let v = if k == count - 1 {
                (pool as i64 - assigned).max(0)
            } else {
                exact.floor() as i64
            };
            out[i] = v;
            assigned += v;
        }
    }

    // Overflow: shrink from the end until it fits rather than drawing outside.
    let mut sum: i64 = out.iter().sum();
    let avail = available as i64;
    if sum > avail {
        for i in (0..n).rev() {
            if sum <= avail {
                break;
            }
            let shrink = (out[i] - parsed[i].min as i64).min(sum - avail);
            if shrink > 0 {
                out[i] -= shrink;
                sum -= shrink;
            }
        }
        for i in (0..n).rev() {
            if sum <= avail {
                break;
            }
            let shrink = out[i].min(sum - avail);
            out[i] -= shrink;
            sum -= shrink;
        }
    }

    out.into_iter().map(|v| v.max(0) as usize).collect()
}

/// Lay children out along one axis inside `rect`.
pub fn stack(rect: Rect, items: &[Constraint], direction: Direction, gap: usize) -> Vec<Rect> {
    let seams = vec![gap as isize; items.len().saturating_sub(1)];
    stack_with_gaps(rect, items, direction, &seams)
}

/// As `stack`, but with a gap per seam, which may be negative.
pub fn stack_with_gaps(
    rect: Rect,
    items: &[Constraint],
    direction: Direction,
    gaps: &[isize],
) -> Vec<Rect> {
    let horizontal = direction == Direction::Row;
    let sizes = solve_with_gaps(if horizontal { rect.width } else { rect.height }, items, gaps);
    let mut out = Vec::with_capacity(sizes.len());
    let mut offset = if horizontal { rect.x } else { rect.y };
    for (i, size) in sizes.into_iter().enumerate() {
        out.push(if horizontal {
            Rect { x: offset, y: rect.y, width: size, height: rect.height }
        } else {
            Rect { x: rect.x, y: offset, width: rect.width, height: size }
        });
        offset += size as isize + gaps.get(i).copied().unwrap_or(0);
    }
    out
}
