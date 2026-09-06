//! The screen is one grid of cells, not a tree of widgets. Four parallel
//! vectors keep a frame allocation-free: no object is created per cell, ever.

use std::ops::{BitAnd, BitOr, BitOrAssign, Not};

use crate::color::Color;
use crate::unicode::{
    cell_text, cell_width, graphemes, is_unsafe_codepoint, Cell, CONTINUATION, REPLACEMENT,
};

/// Style attribute bits packed into the cell's 16-bit attribute slot.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub struct Attrs(u16);

impl Attrs {
    pub const NONE: Attrs = Attrs(0);
    pub const BOLD: Attrs = Attrs(1 << 0);
    pub const DIM: Attrs = Attrs(1 << 1);
    pub const ITALIC: Attrs = Attrs(1 << 2);
    pub const UNDERLINE: Attrs = Attrs(1 << 3);
    pub const BLINK: Attrs = Attrs(1 << 4);
    pub const REVERSE: Attrs = Attrs(1 << 5);
    pub const STRIKE: Attrs = Attrs(1 << 6);

    pub const fn bits(self) -> u16 {
        self.0
    }

    pub const fn from_bits(bits: u16) -> Attrs {
        Attrs(bits)
    }

    pub const fn contains(self, other: Attrs) -> bool {
        self.0 & other.0 == other.0
    }

    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }
}

impl BitOr for Attrs {
    type Output = Attrs;
    fn bitor(self, rhs: Attrs) -> Attrs {
        Attrs(self.0 | rhs.0)
    }
}

impl BitOrAssign for Attrs {
    fn bitor_assign(&mut self, rhs: Attrs) {
        self.0 |= rhs.0;
    }
}

impl BitAnd for Attrs {
    type Output = Attrs;
    fn bitand(self, rhs: Attrs) -> Attrs {
        Attrs(self.0 & rhs.0)
    }
}

impl Not for Attrs {
    type Output = Attrs;
    fn not(self) -> Attrs {
        Attrs(!self.0)
    }
}

/// A partial style. `None` on a field means "leave whatever is already there",
/// which is what lets a widget set only the foreground of a region.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Style {
    pub fg: Option<Color>,
    pub bg: Option<Color>,
    pub attrs: Option<Attrs>,
}

impl Style {
    /// Changes nothing.
    pub const NONE: Style = Style { fg: None, bg: None, attrs: None };

    pub const fn new() -> Style {
        Style::NONE
    }

    pub const fn with_fg(mut self, fg: Color) -> Style {
        self.fg = Some(fg);
        self
    }

    pub const fn with_bg(mut self, bg: Color) -> Style {
        self.bg = Some(bg);
        self
    }

    pub const fn with_attrs(mut self, attrs: Attrs) -> Style {
        self.attrs = Some(attrs);
        self
    }

    /// Fill in anything this style leaves unset from `other`.
    pub fn or(self, other: Style) -> Style {
        Style {
            fg: self.fg.or(other.fg),
            bg: self.bg.or(other.bg),
            attrs: self.attrs.or(other.attrs),
        }
    }
}

/// A grid of styled cells. This is the only thing the encoder ever reads.
#[derive(Clone, Debug)]
pub struct FrameBuffer {
    pub width: usize,
    pub height: usize,
    pub chars: Vec<Cell>,
    pub fg: Vec<Color>,
    pub bg: Vec<Color>,
    pub attrs: Vec<Attrs>,
}

impl FrameBuffer {
    pub fn new(width: usize, height: usize) -> FrameBuffer {
        let n = width * height;
        let mut buffer = FrameBuffer {
            width,
            height,
            chars: vec![32; n],
            fg: vec![Color::DEFAULT; n],
            bg: vec![Color::DEFAULT; n],
            attrs: vec![Attrs::NONE; n],
        };
        buffer.clear(Color::DEFAULT, Color::DEFAULT);
        buffer
    }

    /// Resize, reusing the existing allocation when it is large enough.
    pub fn resize(&mut self, width: usize, height: usize) {
        if width == self.width && height == self.height {
            return;
        }
        let n = width * height;
        if n > self.chars.len() {
            self.chars.resize(n, 32);
            self.fg.resize(n, Color::DEFAULT);
            self.bg.resize(n, Color::DEFAULT);
            self.attrs.resize(n, Attrs::NONE);
        }
        self.width = width;
        self.height = height;
        self.clear(Color::DEFAULT, Color::DEFAULT);
    }

    #[inline]
    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.width + x
    }

    pub fn clear(&mut self, bg: Color, fg: Color) {
        let n = self.width * self.height;
        self.chars[..n].fill(32);
        self.fg[..n].fill(fg);
        self.bg[..n].fill(bg);
        self.attrs[..n].fill(Attrs::NONE);
    }

    #[inline]
    pub fn in_bounds(&self, x: isize, y: isize) -> bool {
        x >= 0 && y >= 0 && (x as usize) < self.width && (y as usize) < self.height
    }

    fn apply_style(&mut self, i: usize, style: &Style) {
        if let Some(fg) = style.fg {
            self.fg[i] = fg;
        }
        if let Some(bg) = style.bg {
            self.bg[i] = bg;
        }
        if let Some(attrs) = style.attrs {
            self.attrs[i] = attrs;
        }
    }

    /// Write one already-decoded cell value. Returns columns consumed.
    ///
    /// This is the only path that writes a character into the grid, and the
    /// encoder hands cell text straight to the terminal. Refusing unsafe values
    /// here means the buffer *cannot* hold a live escape, whatever the caller
    /// passes — including the low-level escape hatch.
    pub fn set_cell(&mut self, x: isize, y: isize, value: Cell, style: &Style) -> usize {
        if !self.in_bounds(x, y) {
            return 0;
        }
        let (x, y) = (x as usize, y as usize);

        let mut value = value;
        // Ordered so printable ASCII costs one comparison. A lead-less
        // continuation is not writable either; it would silently eat a column.
        if value >= 0x7f {
            if is_unsafe_codepoint(value) || value == CONTINUATION {
                value = 32;
            } else if !is_valid_scalar(value) {
                value = REPLACEMENT;
            }
        } else if value < 0x20 {
            value = 32;
        }

        let w = cell_width(value);
        let i = self.index(x, y);
        // Overwriting the tail of a wide char to our left would orphan it.
        if self.chars[i] == CONTINUATION && x > 0 {
            self.chars[i - 1] = 32;
        }
        self.chars[i] = value;
        self.apply_style(i, style);

        if w == 2 {
            if x + 1 < self.width {
                let j = i + 1;
                self.chars[j] = CONTINUATION;
                self.apply_style(j, style);
            } else {
                // No room for the second half: draw a space rather than corrupt
                // the row.
                self.chars[i] = 32;
                return 1;
            }
        }
        w.max(1)
    }

    /// Write text left to right. Returns the number of columns written.
    pub fn write(&mut self, x: isize, y: isize, text: &str, style: &Style) -> usize {
        self.write_capped(x, y, text, style, usize::MAX)
    }

    pub fn write_capped(
        &mut self,
        x: isize,
        y: isize,
        text: &str,
        style: &Style,
        max_width: usize,
    ) -> usize {
        if y < 0 || y as usize >= self.height {
            return 0;
        }
        let mut cx = x;
        let mut used = 0usize;
        for g in graphemes(text) {
            if used + g.width > max_width {
                break;
            }
            if cx >= self.width as isize {
                break;
            }
            if cx + g.width as isize > self.width as isize {
                break;
            }
            if cx >= 0 {
                self.set_cell(cx, y, g.value, style);
            }
            cx += g.width as isize;
            used += g.width;
        }
        used
    }

    pub fn fill_rect(
        &mut self,
        x: isize,
        y: isize,
        w: usize,
        h: usize,
        ch: Cell,
        style: &Style,
    ) {
        let x0 = x.max(0) as usize;
        let y0 = y.max(0) as usize;
        let x1 = ((x + w as isize).max(0) as usize).min(self.width);
        let y1 = ((y + h as isize).max(0) as usize).min(self.height);
        for cy in y0..y1 {
            for cx in x0..x1 {
                self.set_cell(cx as isize, cy as isize, ch, style);
            }
        }
    }

    /// Restyle a region without touching its characters.
    pub fn style_rect(&mut self, x: isize, y: isize, w: usize, h: usize, style: &Style) {
        let x0 = x.max(0) as usize;
        let y0 = y.max(0) as usize;
        let x1 = ((x + w as isize).max(0) as usize).min(self.width);
        let y1 = ((y + h as isize).max(0) as usize).min(self.height);
        for cy in y0..y1 {
            for cx in x0..x1 {
                let i = self.index(cx, cy);
                self.apply_style(i, style);
            }
        }
    }

    /// Copy another buffer's contents into this one (same dimensions assumed).
    pub fn copy_from(&mut self, other: &FrameBuffer) {
        let n = (self.width * self.height).min(other.width * other.height);
        self.chars[..n].copy_from_slice(&other.chars[..n]);
        self.fg[..n].copy_from_slice(&other.fg[..n]);
        self.bg[..n].copy_from_slice(&other.bg[..n]);
        self.attrs[..n].copy_from_slice(&other.attrs[..n]);
    }

    /// Plain text of one row, for tests and headless rendering.
    pub fn row_text(&self, y: usize) -> String {
        if y >= self.height {
            return String::new();
        }
        let mut out = String::new();
        for x in 0..self.width {
            let v = self.chars[self.index(x, y)];
            if v == CONTINUATION {
                continue;
            }
            if v == 0 {
                out.push(' ');
            } else {
                out.push_str(&cell_text(v));
            }
        }
        out
    }

    /// Whole buffer as plain text, trailing whitespace trimmed per row.
    pub fn to_text(&self) -> String {
        (0..self.height)
            .map(|y| self.row_text(y).trim_end().to_string())
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Whole buffer as plain text, every row padded to the full width.
    pub fn to_text_untrimmed(&self) -> String {
        (0..self.height).map(|y| self.row_text(y)).collect::<Vec<_>>().join("\n")
    }
}

/// A cell value only holds a real character if it is a Unicode scalar. The
/// reference implementation reaches this check via lone surrogates, which a
/// `&str` cannot contain; a caller using the raw `set_cell` escape hatch still
/// can, so the guard stays.
fn is_valid_scalar(cp: u32) -> bool {
    char::from_u32(cp).is_some() || cp >= crate::unicode::CLUSTER_BASE
}
