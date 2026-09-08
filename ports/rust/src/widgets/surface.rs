//! Two primitives for the space behind a widget rather than the widget itself.
//!
//! `modal` already blanks the region it is about to draw into, but it does it
//! privately, so anything else that floats -- a custom overlay, a popover, a
//! tooltip somebody wrote themselves -- has no way to say "this region is mine
//! now". These make that sayable.

use crate::buffer::{Attrs, Style};
use crate::color::Color;
use crate::surface::Surface;
use crate::unicode::string_width;

#[derive(Clone, Copy, Debug, Default)]
pub struct ClearOptions {
    /// What to leave behind. Defaults to the theme's background.
    pub background: Option<Color>,
}

/// Reset a region to empty, so an overlay can draw over what was there.
///
/// Without this an overlay is drawn *into* whatever it lands on: the cells it
/// does not touch keep the widget underneath, and a dialog ends up with someone
/// else's table showing through the gaps between its words.
pub fn draw_clear(surface: &Surface, options: &ClearOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    surface.fill(&Style {
        fg: Some(theme.foreground),
        bg: Some(options.background.unwrap_or(theme.background)),
        attrs: Some(Attrs::default()),
    });
}

#[derive(Clone, Debug)]
pub struct FillOptions {
    /// The symbol to repeat. A wide one is stepped over rather than written per
    /// column, since each glyph owns a continuation cell.
    pub symbol: String,
    pub fg: Option<Color>,
    pub bg: Option<Color>,
    pub attrs: Option<Attrs>,
}

impl Default for FillOptions {
    fn default() -> FillOptions {
        FillOptions { symbol: " ".into(), fg: None, bg: None, attrs: None }
    }
}

/// Flood a region with one repeated symbol and style.
pub fn draw_fill(surface: &Surface, options: &FillOptions) {
    if surface.is_empty() {
        return;
    }
    let style = Style { fg: options.fg, bg: options.bg, attrs: options.attrs };
    let glyph = options.symbol.chars().next().unwrap_or(' ');
    let glyph_width = string_width(&options.symbol).max(1);
    // A one-cell symbol is what `fill` is for. Anything wider has to be stepped
    // over rather than written per column: each glyph owns a continuation cell,
    // and writing the next one on top of it leaves a row of half-characters.
    if glyph_width == 1 {
        surface.fill_rect(0, 0, surface.width(), surface.height(), &style, glyph as u32);
        return;
    }
    for y in 0..surface.height() {
        // The last glyph is dropped rather than clipped when the region does
        // not divide evenly: half a wide character is not a fill, it is damage.
        let mut x = 0usize;
        while x + glyph_width <= surface.width() {
            surface.glyph(x as isize, y as isize, glyph, &style);
            x += glyph_width;
        }
    }
}
