//! Turns two framebuffers into the smallest practical stream of escape
//! sequences. The encoder keeps a model of the terminal's current pen so no
//! redundant SGR is emitted.

use crate::ansi;
use crate::buffer::{Attrs, FrameBuffer};
use crate::capabilities::ColorDepth;
use crate::color::Color;
use crate::unicode::{cell_text, cell_width, CONTINUATION};

/// Rewriting up to this many unchanged cells is cheaper than the escape
/// sequence needed to jump over them, so neighbouring dirty spans get merged.
const GAP_MERGE: usize = 5;

#[derive(Clone, Copy)]
struct TerminalState {
    x: i64,
    y: i64,
    /// False after anything that makes the cursor position unknowable.
    known: bool,
    fg: Color,
    bg: Color,
    attrs: Attrs,
}

impl Default for TerminalState {
    fn default() -> TerminalState {
        TerminalState {
            x: -1,
            y: -1,
            known: false,
            fg: Color::DEFAULT,
            bg: Color::DEFAULT,
            attrs: Attrs::NONE,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EncodeResult {
    /// The bytes to hand to stdout.
    pub output: String,
    pub changed_cells: usize,
    /// Rows that contained at least one change.
    pub dirty_rows: usize,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct EncoderOptions {
    pub colors: Option<ColorDepth>,
    /// Drain all color, keeping attributes.
    pub monochrome: bool,
}

pub struct Encoder {
    state: TerminalState,
    parts: String,
    pub colors: ColorDepth,
    pub monochrome: bool,
}

impl Default for Encoder {
    fn default() -> Encoder {
        Encoder::new(EncoderOptions::default())
    }
}

impl Encoder {
    pub fn new(options: EncoderOptions) -> Encoder {
        Encoder {
            state: TerminalState::default(),
            parts: String::new(),
            colors: options.colors.unwrap_or(ColorDepth::TrueColor),
            monochrome: options.monochrome,
        }
    }

    /// Forget what we believe about the terminal; the next write re-states
    /// everything.
    pub fn invalidate_state(&mut self) {
        self.state = TerminalState::default();
        self.parts.push_str("\x1b[0m");
    }

    fn fg_seq(&self, c: Color) -> String {
        if self.colors == ColorDepth::None {
            return String::new();
        }
        if c.is_default() {
            return ansi::FG_DEFAULT.to_string();
        }
        let col = if self.monochrome { c.grayscale() } else { c };
        match self.colors {
            ColorDepth::TrueColor => ansi::fg_true(col.red(), col.green(), col.blue()),
            ColorDepth::Ansi256 => ansi::fg_256(col.to_256()),
            _ => ansi::fg_16(col.to_16()),
        }
    }

    fn bg_seq(&self, c: Color) -> String {
        if self.colors == ColorDepth::None {
            return String::new();
        }
        if c.is_default() {
            return ansi::BG_DEFAULT.to_string();
        }
        let col = if self.monochrome { c.grayscale() } else { c };
        match self.colors {
            ColorDepth::TrueColor => ansi::bg_true(col.red(), col.green(), col.blue()),
            ColorDepth::Ansi256 => ansi::bg_256(col.to_256()),
            _ => ansi::bg_16(col.to_16()),
        }
    }

    fn apply_style(&mut self, fg: Color, bg: Color, attrs: Attrs) {
        if self.state.fg == fg && self.state.bg == bg && self.state.attrs == attrs {
            return;
        }

        // Attributes can only be added cheaply; removing one means a full reset.
        let removed = self.state.attrs & !attrs;
        if !removed.is_empty() {
            self.parts.push_str("\x1b[0m");
            self.state.attrs = Attrs::NONE;
            self.state.fg = Color::DEFAULT;
            self.state.bg = Color::DEFAULT;
        }

        let added = attrs & !self.state.attrs;
        if !added.is_empty() {
            let mut codes: Vec<u8> = Vec::new();
            if added.contains(Attrs::BOLD) {
                codes.push(1);
            }
            if added.contains(Attrs::DIM) {
                codes.push(2);
            }
            if added.contains(Attrs::ITALIC) {
                codes.push(3);
            }
            if added.contains(Attrs::UNDERLINE) {
                codes.push(4);
            }
            if added.contains(Attrs::BLINK) {
                codes.push(5);
            }
            if added.contains(Attrs::REVERSE) {
                codes.push(7);
            }
            if added.contains(Attrs::STRIKE) {
                codes.push(9);
            }
            if !codes.is_empty() {
                self.parts.push_str("\x1b[");
                for (i, code) in codes.iter().enumerate() {
                    if i > 0 {
                        self.parts.push(';');
                    }
                    self.parts.push_str(&code.to_string());
                }
                self.parts.push('m');
            }
            self.state.attrs = attrs;
        }

        if self.state.fg != fg {
            let seq = self.fg_seq(fg);
            self.parts.push_str(&seq);
            self.state.fg = fg;
        }
        if self.state.bg != bg {
            let seq = self.bg_seq(bg);
            self.parts.push_str(&seq);
            self.state.bg = bg;
        }
    }

    fn move_cursor(&mut self, x: usize, y: usize) {
        let (xi, yi) = (x as i64, y as i64);
        if self.state.known && self.state.y == yi {
            if self.state.x == xi {
                return;
            }
            if xi > self.state.x && xi - self.state.x <= 3 {
                // Short hop: cheaper than a full CUP, and never repaints cells.
                self.parts.push_str(&ansi::move_right((xi - self.state.x) as usize));
            } else if x == 0 {
                self.parts.push('\r');
            } else {
                self.parts.push_str(&ansi::move_to_column(x));
            }
        } else {
            self.parts.push_str(&ansi::move_to(x, y));
        }
        self.state.x = xi;
        self.state.y = yi;
        self.state.known = true;
    }

    /// Encode the difference between `prev` and `next`. Pass `full` to repaint
    /// every cell (first frame, resize, or after a redraw request).
    pub fn encode(&mut self, prev: &FrameBuffer, next: &FrameBuffer, full: bool) -> EncodeResult {
        self.parts.clear();
        let mut changed = 0usize;
        let mut dirty_rows = 0usize;

        let w = next.width;
        let h = next.height;
        let same_size = prev.width == w && prev.height == h;
        let repaint = full || !same_size;
        if repaint {
            self.invalidate_state();
        }

        // Whether this cell actually differs from the previous frame. When the
        // sizes disagree the previous frame cannot be indexed with this frame's
        // stride, so every cell counts as different.
        let differs = |i: usize| -> bool {
            if !same_size {
                return true;
            }
            next.chars[i] != prev.chars[i]
                || next.fg[i] != prev.fg[i]
                || next.bg[i] != prev.bg[i]
                || next.attrs[i] != prev.attrs[i]
        };
        // Whether this cell needs emitting, which a full repaint forces even
        // for cells that are unchanged. The two are deliberately separate:
        // `changed_cells` reports real churn, not repaint volume.
        let dirty_at = |i: usize| -> bool { repaint || differs(i) };

        for y in 0..h {
            let row_start = y * w;
            let mut x = 0usize;
            let mut row_dirty = false;

            while x < w {
                if !dirty_at(row_start + x) {
                    x += 1;
                    continue;
                }

                // Walk left onto the lead cell if we landed on a wide char's tail.
                let mut start = x;
                while start > 0 && next.chars[row_start + start] == CONTINUATION {
                    start -= 1;
                }

                // Extend the run while cells are dirty, tolerating short gaps.
                let mut end = start;
                let mut clean = 0usize;
                let mut probe = start;
                while probe < w {
                    if dirty_at(row_start + probe) {
                        end = probe;
                        clean = 0;
                    } else {
                        clean += 1;
                        if clean > GAP_MERGE {
                            break;
                        }
                    }
                    probe += 1;
                }

                self.move_cursor(start, y);
                for cx in start..=end {
                    let j = row_start + cx;
                    let value = next.chars[j];
                    if value == CONTINUATION {
                        continue; // emitted with its lead cell
                    }
                    self.apply_style(next.fg[j], next.bg[j], next.attrs[j]);
                    if value == 0 {
                        self.parts.push(' ');
                    } else {
                        self.parts.push_str(&cell_text(value));
                    }
                    self.state.x += cell_width(value).max(1) as i64;
                    if differs(j) {
                        changed += 1;
                    }
                }
                // Writing the final column may have triggered autowrap; stop
                // trusting x.
                if self.state.x >= w as i64 {
                    self.state.known = false;
                }
                row_dirty = true;
                x = end + 1;
            }
            if row_dirty {
                dirty_rows += 1;
            }
        }

        EncodeResult {
            output: std::mem::take(&mut self.parts),
            changed_cells: changed,
            dirty_rows,
        }
    }
}

/// One-shot encode of a whole buffer, e.g. for rendering a screenshot.
pub fn encode_full(buffer: &FrameBuffer, options: EncoderOptions) -> String {
    let empty = FrameBuffer::new(buffer.width, buffer.height);
    Encoder::new(options).encode(&empty, buffer, true).output
}
