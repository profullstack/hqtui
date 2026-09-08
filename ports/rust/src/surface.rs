//! A clipped, translated view onto the framebuffer. Widgets only ever see a
//! `Surface`, so nothing can draw outside the rectangle it was given.

use std::cell::RefCell;
use std::rc::Rc;

use crate::buffer::{Attrs, FrameBuffer, Style};
use crate::color::Color;
use crate::layout::{Padding, Rect};
use crate::theme::Theme;
use crate::unicode::{fit, graphemes, string_width, truncate, Align, Cell};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum BorderStyle {
    #[default]
    Rounded,
    Single,
    Double,
    Thick,
    Dashed,
    Ascii,
    None,
}

#[derive(Clone, Copy, Debug)]
pub struct BorderChars {
    pub tl: char,
    pub tr: char,
    pub bl: char,
    pub br: char,
    pub h: char,
    pub v: char,
    pub ml: char,
    pub mr: char,
    pub mt: char,
    pub mb: char,
    pub cross: char,
}

/// Edge bits for a border glyph: 1 up, 2 right, 4 down, 8 left.
///
/// Collapsing two panel borders is the union of their edges. A panel's
/// top-right corner (down + left) landing on its neighbour's top-left
/// (down + right) is down + left + right, which is the T that makes the two
/// read as one frame.
pub const EDGE_UP: u8 = 1;
pub const EDGE_RIGHT: u8 = 2;
pub const EDGE_DOWN: u8 = 4;
pub const EDGE_LEFT: u8 = 8;

/// The edges each part of a border carries.
const PART_BITS: [u8; 11] = [
    EDGE_RIGHT | EDGE_DOWN,               // tl
    EDGE_LEFT | EDGE_DOWN,                // tr
    EDGE_UP | EDGE_RIGHT,                 // bl
    EDGE_UP | EDGE_LEFT,                  // br
    EDGE_LEFT | EDGE_RIGHT,               // h
    EDGE_UP | EDGE_DOWN,                  // v
    EDGE_UP | EDGE_DOWN | EDGE_RIGHT,     // ml
    EDGE_UP | EDGE_DOWN | EDGE_LEFT,      // mr
    EDGE_LEFT | EDGE_RIGHT | EDGE_DOWN,   // mt
    EDGE_LEFT | EDGE_RIGHT | EDGE_UP,     // mb
    0b1111,                               // cross
];

impl BorderChars {
    fn parts(&self) -> [char; 11] {
        [self.tl, self.tr, self.bl, self.br, self.h, self.v, self.ml, self.mr, self.mt, self.mb, self.cross]
    }
}

const ALL_STYLES: [BorderStyle; 6] = [
    BorderStyle::Rounded,
    BorderStyle::Single,
    BorderStyle::Double,
    BorderStyle::Thick,
    BorderStyle::Dashed,
    BorderStyle::Ascii,
];

/// The edges of a border glyph, or `None` when it is not one.
///
/// ASCII borders collide (every corner is `+`) and the first match wins, which
/// is right: the union of anything with a `+` is a `+`.
pub fn border_bits(ch: char) -> Option<u8> {
    for style in ALL_STYLES {
        if let Some(chars) = style.chars() {
            for (i, part) in chars.parts().into_iter().enumerate() {
                if part == ch {
                    return Some(PART_BITS[i]);
                }
            }
        }
    }
    None
}

/// The glyph in `style` with exactly these edges, or `None` if there is none.
/// The glyph for a cell where two edges meet, given which of them are drawn.
///
/// A single edge has no glyph of its own, so the plain rule stands in: that
/// cell is part of a run, not a corner.
pub fn side_glyph(style: BorderStyle, bits: u8) -> Option<char> {
    if bits == 0 {
        return None;
    }
    if let Some(glyph) = border_glyph(style, bits) {
        return Some(glyph);
    }
    let chars = style.chars()?;
    Some(if bits & (EDGE_LEFT | EDGE_RIGHT) != 0 { chars.h } else { chars.v })
}

pub fn border_glyph(style: BorderStyle, bits: u8) -> Option<char> {
    let chars = style.chars()?;
    let parts = chars.parts();
    PART_BITS.iter().position(|b| *b == bits).map(|i| parts[i])
}

impl BorderStyle {
    pub fn chars(self) -> Option<BorderChars> {
        Some(match self {
            BorderStyle::Rounded => BorderChars {
                tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│',
                ml: '├', mr: '┤', mt: '┬', mb: '┴', cross: '┼',
            },
            BorderStyle::Single => BorderChars {
                tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│',
                ml: '├', mr: '┤', mt: '┬', mb: '┴', cross: '┼',
            },
            BorderStyle::Double => BorderChars {
                tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║',
                ml: '╠', mr: '╣', mt: '╦', mb: '╩', cross: '╬',
            },
            BorderStyle::Thick => BorderChars {
                tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃',
                ml: '┣', mr: '┫', mt: '┳', mb: '┻', cross: '╋',
            },
            BorderStyle::Dashed => BorderChars {
                tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '╌', v: '╎',
                ml: '├', mr: '┤', mt: '┬', mb: '┴', cross: '┼',
            },
            BorderStyle::Ascii => BorderChars {
                tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|',
                ml: '+', mr: '+', mt: '+', mb: '+', cross: '+',
            },
            BorderStyle::None => return None,
        })
    }

    pub fn parse(name: &str) -> BorderStyle {
        match name {
            "single" => BorderStyle::Single,
            "double" => BorderStyle::Double,
            "thick" => BorderStyle::Thick,
            "dashed" => BorderStyle::Dashed,
            "ascii" => BorderStyle::Ascii,
            "none" => BorderStyle::None,
            _ => BorderStyle::Rounded,
        }
    }
}

/// How a run of text is drawn into a surface.
#[derive(Clone, Debug, Default)]
pub struct TextOptions {
    pub fg: Option<Color>,
    pub bg: Option<Color>,
    pub attrs: Option<Attrs>,
    pub align: Option<Align>,
    /// Truncate with an ellipsis instead of clipping mid-word. Defaults to on.
    pub ellipsis: Option<bool>,
    pub max_width: Option<usize>,
}

impl TextOptions {
    pub fn new() -> TextOptions {
        TextOptions::default()
    }

    pub fn fg(mut self, c: Color) -> TextOptions {
        self.fg = Some(c);
        self
    }

    pub fn bg(mut self, c: Color) -> TextOptions {
        self.bg = Some(c);
        self
    }

    pub fn attrs(mut self, a: Attrs) -> TextOptions {
        self.attrs = Some(a);
        self
    }

    pub fn align(mut self, a: Align) -> TextOptions {
        self.align = Some(a);
        self
    }

    pub fn max_width(mut self, w: usize) -> TextOptions {
        self.max_width = Some(w);
        self
    }

    fn style(&self) -> Style {
        Style { fg: self.fg, bg: self.bg, attrs: self.attrs }
    }
}

impl From<Style> for TextOptions {
    fn from(s: Style) -> TextOptions {
        TextOptions { fg: s.fg, bg: s.bg, attrs: s.attrs, ..Default::default() }
    }
}

/// Which edges of a box to draw, as flags. All four is what a box was before
/// this existed; none draws no rule and insets nothing, the same as a border
/// style of `None`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sides {
    pub top: bool,
    pub right: bool,
    pub bottom: bool,
    pub left: bool,
}

impl Default for Sides {
    fn default() -> Self {
        Sides::all()
    }
}

impl Sides {
    pub fn all() -> Sides {
        Sides { top: true, right: true, bottom: true, left: true }
    }

    pub fn none() -> Sides {
        Sides { top: false, right: false, bottom: false, left: false }
    }

    pub fn any(&self) -> bool {
        self.top || self.right || self.bottom || self.left
    }

    /// Parse the spelling the reference API uses: "all", "none", or a
    /// comma-separated list of sides.
    pub fn parse(spec: &str) -> Sides {
        match spec.trim() {
            "" | "all" => Sides::all(),
            "none" => Sides::none(),
            list => {
                let has = |name: &str| list.split(',').any(|part| part.trim() == name);
                Sides {
                    top: has("top"),
                    right: has("right"),
                    bottom: has("bottom"),
                    left: has("left"),
                }
            }
        }
    }
}

/// A bordered box: the workhorse behind every panel in the library.
#[derive(Clone, Debug, Default)]
pub struct BoxOptions {
    pub fg: Option<Color>,
    pub bg: Option<Color>,
    pub border: Option<BorderStyle>,
    pub border_color: Option<Color>,
    pub title: Option<String>,
    pub title_align: Option<Align>,
    pub title_color: Option<Color>,
    /// Right-aligned text on the top border, e.g. a value or a hint.
    pub subtitle: Option<String>,
    pub subtitle_color: Option<Color>,
    /// Paint the interior with `bg` before drawing. Defaults to on when `bg` is set.
    pub fill: Option<bool>,
    /// Merge this border with one already drawn in the same cell rather than
    /// overwriting it. Set for you by the container when the app asks for
    /// collapsed borders; there is no reason to pass it by hand.
    pub collapse: bool,
    /// Which edges to draw. The interior follows the sides actually drawn, so a
    /// top-only box costs one row rather than two.
    pub sides: Sides,
    pub footer: Option<String>,
    pub footer_color: Option<Color>,
}

impl BoxOptions {
    pub fn new() -> BoxOptions {
        BoxOptions::default()
    }

    pub fn title(mut self, t: impl Into<String>) -> BoxOptions {
        self.title = Some(t.into());
        self
    }

    pub fn subtitle(mut self, t: impl Into<String>) -> BoxOptions {
        self.subtitle = Some(t.into());
        self
    }

    pub fn footer(mut self, t: impl Into<String>) -> BoxOptions {
        self.footer = Some(t.into());
        self
    }

    pub fn border(mut self, b: BorderStyle) -> BoxOptions {
        self.border = Some(b);
        self
    }

    pub fn border_color(mut self, c: Color) -> BoxOptions {
        self.border_color = Some(c);
        self
    }

    pub fn title_align(mut self, a: Align) -> BoxOptions {
        self.title_align = Some(a);
        self
    }

    pub fn bg(mut self, c: Color) -> BoxOptions {
        self.bg = Some(c);
        self
    }
}

/// Shared ownership of the framebuffer.
///
/// The reference implementation hands every `Surface` the same mutable
/// framebuffer, and the whole widget API is built on surfaces creating clipped
/// children of themselves while the parent stays usable. `Rc<RefCell<..>>` is
/// the direct translation; the borrow is always taken and released inside one
/// method, so it never overlaps.
pub type SharedBuffer = Rc<RefCell<FrameBuffer>>;

#[derive(Clone)]
pub struct Surface {
    buffer: SharedBuffer,
    pub rect: Rect,
    pub clip: Rect,
    pub theme: Rc<Theme>,
}

impl Surface {
    /// The frame buffer this surface draws into.
    ///
    /// For effects that read a cell before writing it -- a shadow dims what is
    /// already there rather than painting over it, so it cannot go through the
    /// write-only drawing methods.
    pub fn buffer_mut(&self) -> std::cell::RefMut<'_, FrameBuffer> {
        self.buffer.borrow_mut()
    }

    pub fn new(buffer: SharedBuffer, rect: Rect, theme: Rc<Theme>, clip: Option<Rect>) -> Surface {
        let clip = match clip {
            Some(c) => rect.intersect(c),
            None => rect,
        };
        Surface { buffer, rect, clip, theme }
    }

    /// A surface covering a whole framebuffer.
    pub fn root(buffer: SharedBuffer, theme: Rc<Theme>) -> Surface {
        let rect = {
            let b = buffer.borrow();
            Rect::new(0, 0, b.width, b.height)
        };
        Surface::new(buffer, rect, theme, None)
    }

    pub fn buffer(&self) -> &SharedBuffer {
        &self.buffer
    }

    pub fn width(&self) -> usize {
        self.rect.width
    }

    pub fn height(&self) -> usize {
        self.rect.height
    }

    pub fn is_empty(&self) -> bool {
        self.rect.is_empty()
    }

    /// A child surface in local coordinates, clipped to this one.
    pub fn sub(&self, x: isize, y: isize, width: usize, height: usize) -> Surface {
        let abs = Rect { x: self.rect.x + x, y: self.rect.y + y, width, height };
        Surface::new(self.buffer.clone(), abs, self.theme.clone(), Some(self.clip))
    }

    /// A child surface from an absolute rect, as produced by the layout solver.
    pub fn region(&self, rect: Rect) -> Surface {
        Surface::new(self.buffer.clone(), rect, self.theme.clone(), Some(self.clip))
    }

    pub fn inset(&self, padding: Padding) -> Surface {
        self.region(self.rect.inset(padding))
    }

    /// Absolute rect of this surface, for hit-testing mouse events.
    pub fn hit_rect(&self) -> Rect {
        self.rect
    }

    fn visible(&self, abs_x: isize, abs_y: isize) -> bool {
        self.clip.contains(abs_x, abs_y)
    }

    pub fn char(&self, x: isize, y: isize, value: Cell, style: &Style) {
        let ax = self.rect.x + x;
        let ay = self.rect.y + y;
        if !self.visible(ax, ay) {
            return;
        }
        self.buffer.borrow_mut().set_cell(ax, ay, value, style);
    }

    /// Convenience for the common case of a literal glyph.
    pub fn glyph(&self, x: isize, y: isize, value: char, style: &Style) {
        self.char(x, y, value as u32, style);
    }

    /// Draw text at local (x, y). Returns columns written.
    pub fn text(&self, x: isize, y: isize, text: &str, options: &TextOptions) -> usize {
        let ay = self.rect.y + y;
        if ay < self.clip.y || ay >= self.clip.y + self.clip.height as isize {
            return 0;
        }
        let room = (self.width() as isize - x).max(0) as usize;
        let limit = options.max_width.unwrap_or(room).min(room);
        if limit == 0 {
            return 0;
        }

        let mut content = text.to_string();
        if options.ellipsis != Some(false) && string_width(&content) > limit {
            content = truncate(&content, limit);
        }
        if let Some(align) = options.align {
            if align != Align::Left {
                content = fit(&content, limit, align);
            }
        }

        let style = options.style();
        let mut cx = self.rect.x + x;
        let mut written = 0usize;
        let mut buffer = self.buffer.borrow_mut();
        for g in graphemes(&content) {
            if written + g.width > limit {
                break;
            }
            if cx >= self.clip.x && cx + g.width as isize <= self.clip.x + self.clip.width as isize {
                buffer.set_cell(cx, ay, g.value, &style);
            }
            cx += g.width as isize;
            written += g.width;
        }
        written
    }

    /// Text positioned within the full surface width.
    pub fn text_aligned(&self, y: isize, text: &str, align: Align, options: &TextOptions) {
        let padded = fit(&truncate(text, self.width()), self.width(), align);
        let mut o = options.clone();
        o.align = Some(Align::Left);
        self.text(0, y, &padded, &o);
    }

    pub fn fill(&self, style: &Style) {
        self.fill_rect(0, 0, self.width(), self.height(), style, 32);
    }

    pub fn fill_rect(&self, x: isize, y: isize, w: usize, h: usize, style: &Style, ch: Cell) {
        let abs = Rect { x: self.rect.x + x, y: self.rect.y + y, width: w, height: h }
            .intersect(self.clip);
        if abs.is_empty() {
            return;
        }
        self.buffer.borrow_mut().fill_rect(abs.x, abs.y, abs.width, abs.height, ch, style);
    }

    pub fn style_rect(&self, x: isize, y: isize, w: usize, h: usize, style: &Style) {
        let abs = Rect { x: self.rect.x + x, y: self.rect.y + y, width: w, height: h }
            .intersect(self.clip);
        if abs.is_empty() {
            return;
        }
        self.buffer.borrow_mut().style_rect(abs.x, abs.y, abs.width, abs.height, style);
    }

    pub fn hline(&self, x: isize, y: isize, length: usize, ch: char, style: &Style) {
        for i in 0..length {
            self.glyph(x + i as isize, y, ch, style);
        }
    }

    pub fn vline(&self, x: isize, y: isize, length: usize, ch: char, style: &Style) {
        for i in 0..length {
            self.glyph(x, y + i as isize, ch, style);
        }
    }

    /// Draw a bordered box with an optional title, and return the interior
    /// surface. Every panel in the library goes through here.
    /// Writes a border glyph, merging it with whatever border is already there.
    ///
    /// Only border glyphs merge. Anything else in the cell is overwritten,
    /// which keeps a panel drawn over a chart looking like a panel rather than
    /// growing junctions out of the data.
    fn merge_border(&self, x: isize, y: isize, ch: char, style: BorderStyle, cell_style: &Style) {
        let ax = self.rect.x + x;
        let ay = self.rect.y + y;
        if !self.visible(ax, ay) {
            return;
        }
        let existing = {
            let buffer = self.buffer.borrow();
            let i = buffer.index(ax as usize, ay as usize);
            buffer.chars.get(i).copied().and_then(char::from_u32)
        };
        let merged = match (existing.and_then(border_bits), border_bits(ch)) {
            (Some(before), Some(after)) if before != after => {
                border_glyph(style, before | after).unwrap_or(ch)
            }
            _ => ch,
        };
        self.glyph(x, y, merged, cell_style);
    }

    pub fn draw_box(&self, options: &BoxOptions) -> Surface {
        let style_kind = options.border.unwrap_or(BorderStyle::Rounded);
        let fg = options.border_color.unwrap_or(self.theme.border);
        let bg = options.bg;

        if options.fill != Some(false) {
            if let Some(bg) = bg {
                self.fill(&Style::new().with_bg(bg));
            }
        }

        let sides = options.sides;
        let chars = match style_kind.chars() {
            Some(c) if sides.any() && self.width() >= 2 && self.height() >= 1 => c,
            Some(_) if !sides.any() => return self.inset(Padding::None),
            Some(_) => return self.inset(Padding::All(1)),
            None => return self.inset(Padding::None),
        };

        let w = self.width();
        let h = self.height();
        let border_style = Style { fg: Some(fg), bg, attrs: None };

        // With collapsing on, a border glyph landing on another one becomes
        // the union of the two. Without it this is a plain write, so a screen
        // that never asks for collapsing renders byte for byte as it did.
        let put = |x: isize, y: isize, ch: char| {
            if options.collapse {
                self.merge_border(x, y, ch, style_kind, &border_style);
            } else {
                self.glyph(x, y, ch, &border_style);
            }
        };
        let put_h = |x: isize, y: isize, length: usize, ch: char| {
            for i in 0..length {
                put(x + i as isize, y, ch);
            }
        };
        let put_v = |x: isize, y: isize, length: usize, ch: char| {
            for i in 0..length {
                put(x, y + i as isize, ch);
            }
        };

        // A corner belongs to the two sides that meet there, so it exists only
        // when both are drawn; where one is, the rule runs straight through the
        // cell the corner would have occupied.
        let corner = |a: bool, a_bit: u8, b: bool, b_bit: u8| -> Option<char> {
            side_glyph(style_kind, (if a { a_bit } else { 0 }) | (if b { b_bit } else { 0 }))
        };

        if sides.top {
            put_h(1, 0, w - 2, chars.h);
        }
        if let Some(ch) = corner(sides.top, EDGE_RIGHT, sides.left, EDGE_DOWN) {
            put(0, 0, ch);
        }
        if let Some(ch) = corner(sides.top, EDGE_LEFT, sides.right, EDGE_DOWN) {
            put(w as isize - 1, 0, ch);
        }
        if h > 1 {
            if sides.bottom {
                put_h(1, h as isize - 1, w - 2, chars.h);
            }
            if let Some(ch) = corner(sides.bottom, EDGE_RIGHT, sides.left, EDGE_UP) {
                put(0, h as isize - 1, ch);
            }
            if let Some(ch) = corner(sides.bottom, EDGE_LEFT, sides.right, EDGE_UP) {
                put(w as isize - 1, h as isize - 1, ch);
            }
            if sides.left {
                put_v(0, 1, h - 2, chars.v);
            }
            if sides.right {
                put_v(w as isize - 1, 1, h - 2, chars.v);
            }
        }

        // Measured before the title is drawn: both share the top border row,
        // and the title used to be truncated against the full width and then
        // painted over by the subtitle.
        let subtitle = options.subtitle.as_ref().map(|s| format!(" {s} ")).unwrap_or_default();
        let subtitle_width = if !subtitle.is_empty() && string_width(&subtitle) + 4 < w {
            string_width(&subtitle)
        } else {
            0
        };

        if let Some(title) = &options.title {
            let title_color = options.title_color.unwrap_or(self.theme.title);
            let label = format!(" {title} ");
            // The title lives in [2, limit). Reserving the width is not enough
            // on its own: right- and centre-aligned titles are positioned from
            // the panel edge, so they would still be drawn over the subtitle —
            // and a wide glyph straddling the boundary bisects it, leaving an
            // orphaned half-character. Both labels carry a space of padding,
            // and those two spaces may share a column, so the region ends one
            // past the subtitle when there is one.
            let limit = if subtitle_width > 0 { w - 1 - subtitle_width } else { w - 2 };
            let room = limit.saturating_sub(2);
            let shown = truncate(&label, room);
            let tw = string_width(&shown);
            let tx = match options.title_align.unwrap_or(Align::Left) {
                Align::Left => 2isize,
                Align::Right => (limit as isize - tw as isize).max(2),
                Align::Center => {
                    ((limit as isize - tw as isize).min((w as isize - tw as isize) / 2)).max(2)
                }
            };
            self.text(
                tx,
                0,
                &shown,
                &TextOptions { fg: Some(title_color), bg, attrs: Some(Attrs::BOLD), ..Default::default() },
            );
        }

        if subtitle_width > 0 {
            self.text(
                w as isize - 2 - subtitle_width as isize,
                0,
                &subtitle,
                &TextOptions {
                    fg: Some(options.subtitle_color.unwrap_or(self.theme.muted)),
                    bg,
                    ..Default::default()
                },
            );
        }

        if let Some(footer) = &options.footer {
            if h > 2 {
                let foot = format!(" {footer} ");
                if string_width(&foot) + 4 < w {
                    self.text(
                        2,
                        h as isize - 1,
                        &foot,
                        &TextOptions {
                            fg: Some(options.footer_color.unwrap_or(self.theme.muted)),
                            bg,
                            ..Default::default()
                        },
                    );
                }
            }
        }

        // The interior follows the sides actually drawn.
        let left = usize::from(sides.left);
        let top = usize::from(sides.top);
        let shrink_x = left + usize::from(sides.right);
        let shrink_y = top + usize::from(sides.bottom);
        self.sub(left as isize, top as isize, w.saturating_sub(shrink_x), h.saturating_sub(shrink_y))
    }
}
