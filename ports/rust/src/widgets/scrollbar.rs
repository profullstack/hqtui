//! A scrollbar, on its own.
//!
//! The renderer used to live inside the table and was reachable only by being a
//! table, list, tree or log. Anything else that scrolls -- a wrapped paragraph,
//! a canvas, a `draw()` somebody wrote themselves -- could not show one.
//!
//! This is the same drawing, lifted out and given the four edges plus state the
//! caller owns. The dense widgets route through it, so there is one
//! implementation and one appearance.

use crate::buffer::Style;
use crate::color::round_half_up;
use crate::surface::Surface;

/// Which edge the bar sits on, and therefore which way it runs.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ScrollbarOrientation {
    #[default]
    Right,
    Left,
    Bottom,
    Top,
}

impl ScrollbarOrientation {
    pub fn is_vertical(self) -> bool {
        matches!(self, ScrollbarOrientation::Right | ScrollbarOrientation::Left)
    }
}

/// The state the caller owns: how much there is, how much of it is visible, and
/// how far through it we are.
#[derive(Clone, Copy, Debug, Default)]
pub struct ScrollbarOptions {
    pub total: usize,
    pub viewport: usize,
    pub offset: usize,
    pub orientation: ScrollbarOrientation,
}

/// Where the thumb sits and how long it is, in cells along the track.
///
/// Split out because it is the whole of the behaviour: everything else is
/// putting characters in a line. A thumb is never shorter than one cell, or it
/// would vanish on a long document, and never starts past the end of the track.
///
/// The thumb is as long as the visible fraction, so it needs the viewport as
/// well as the track. For a table those are the same number -- the bar is
/// exactly as tall as the rows it describes. A bar you place yourself has no
/// such guarantee, so pass the window it describes; `thumb_of` keeps the
/// track-is-the-viewport form the dense widgets use.
pub fn thumb(track: usize, total: usize, offset: usize, viewport: usize) -> (usize, usize) {
    if track == 0 || total == 0 {
        return (0, 0);
    }
    let visible = if viewport > 0 { viewport } else { track };
    if total <= visible {
        return (0, track);
    }
    let size = ((round_half_up(visible as f64 / total as f64 * track as f64) as i64).max(1)
        as usize)
        .min(track);
    let max_offset = (total - visible).max(1);
    let clamped = offset.min(max_offset);
    let start = round_half_up(clamped as f64 / max_offset as f64 * (track - size) as f64) as i64;
    (start.clamp(0, (track - size) as i64) as usize, size)
}

/// `thumb` for a bar whose track is exactly the window it describes.
pub fn thumb_of(track: usize, total: usize, offset: usize) -> (usize, usize) {
    thumb(track, total, offset, track)
}

/// The original signature, kept because the table, list, tree and log all call
/// it this way and their fixtures pin the result.
pub fn draw_scrollbar(
    surface: &Surface,
    x: isize,
    y: isize,
    height: usize,
    total: usize,
    offset: usize,
) {
    let theme = surface.theme.clone();
    let track = theme.background.mix(theme.border, 0.7);
    let (start, size) = thumb_of(height, total, offset);
    for i in 0..height {
        let in_thumb = i >= start && i < start + size;
        surface.glyph(
            x,
            y + i as isize,
            if in_thumb { '█' } else { '│' },
            &Style::new().with_fg(if in_thumb { theme.accent } else { track }),
        );
    }
}

/// A scrollbar filling the surface it is given, on whichever edge.
///
/// A horizontal bar uses the half-height glyphs rather than the full block: a
/// run of full blocks across a row reads as a solid rule, which is not what a
/// thumb is meant to look like.
pub fn draw_scrollbar_widget(surface: &Surface, options: &ScrollbarOptions) {
    if surface.width() == 0 || surface.height() == 0 {
        return;
    }
    let vertical = options.orientation.is_vertical();
    let theme = surface.theme.clone();
    let track_color = theme.background.mix(theme.border, 0.7);

    let length = if vertical { surface.height() } else { surface.width() };
    let viewport = if options.viewport > 0 { options.viewport } else { length };
    let (start, size) = thumb(length, options.total, options.offset, viewport);

    let line = if vertical {
        if options.orientation == ScrollbarOrientation::Right {
            surface.width() as isize - 1
        } else {
            0
        }
    } else if options.orientation == ScrollbarOrientation::Bottom {
        surface.height() as isize - 1
    } else {
        0
    };

    for i in 0..length {
        let in_thumb = i >= start && i < start + size;
        let glyph = match (vertical, in_thumb) {
            (true, true) => '█',
            (true, false) => '│',
            (false, true) => '━',
            (false, false) => '─',
        };
        let style = Style::new().with_fg(if in_thumb { theme.accent } else { track_color });
        if vertical {
            surface.glyph(line, i as isize, glyph, &style);
        } else {
            surface.glyph(i as isize, line, glyph, &style);
        }
    }
}

/// Which offset a click at `position` along the track means.
///
/// The thumb centres on the click, which is what every scrollbar does and what
/// makes dragging feel like dragging rather than nudging.
pub fn offset_for_position(position: usize, track: usize, total: usize, viewport: usize) -> usize {
    let visible = if viewport > 0 { viewport } else { track };
    if track == 0 || total <= visible {
        return 0;
    }
    let (_, size) = thumb(track, total, 0, visible);
    let usable = track.saturating_sub(size).max(1);
    let at = position.saturating_sub(size / 2).min(usable);
    round_half_up(at as f64 / usable as f64 * (total - visible) as f64) as usize
}
