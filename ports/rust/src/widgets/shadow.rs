//! A drop shadow cast by a region onto whatever is behind it.
//!
//! The point is that it dims what it covers rather than painting over it: a
//! shadow that filled its band with a flat colour would erase the dashboard
//! underneath, which is the opposite of what a shadow is for. Every covered cell
//! keeps its own character and its own hue, and only loses some of its light.

use crate::buffer::Style;
use crate::color::Color;
use crate::layout::Rect;
use crate::surface::Surface;

#[derive(Clone, Copy, Debug)]
pub struct ShadowOptions {
    /// How far the shadow falls. Default one cell right and one down.
    pub offset_x: isize,
    pub offset_y: isize,
    /// 0-1: how much light the covered cells lose.
    pub amount: f64,
    /// Paint this colour instead of dimming what is underneath.
    ///
    /// For a shadow falling on empty background, where there is nothing to dim
    /// and a flat colour is cheaper and reads the same.
    pub color: Option<Color>,
}

impl Default for ShadowOptions {
    fn default() -> ShadowOptions {
        ShadowOptions { offset_x: 1, offset_y: 1, amount: 0.55, color: None }
    }
}

/// Darken every cell in a region, keeping its character and its hue.
///
/// Towards black rather than towards the theme's background: on a light theme
/// the background *is* the light, so dimming towards it would make the shadow
/// brighter than the page it falls on.
pub fn dim_rect(surface: &Surface, x: isize, y: isize, width: usize, height: usize, amount: f64) {
    let t = amount.clamp(0.0, 1.0);
    let black = Color::rgb(0, 0, 0);
    for row in 0..height as isize {
        for col in 0..width as isize {
            let ax = surface.rect.x + x + col;
            let ay = surface.rect.y + y + row;
            if ax < surface.clip.x
                || ay < surface.clip.y
                || ax >= surface.clip.x + surface.clip.width as isize
                || ay >= surface.clip.y + surface.clip.height as isize
            {
                continue;
            }
            let mut buffer = surface.buffer_mut();
            let i = buffer.index(ax as usize, ay as usize);
            buffer.fg[i] = buffer.fg[i].mix(black, t);
            buffer.bg[i] = buffer.bg[i].mix(black, t);
        }
    }
}

/// Cast a shadow from `rect` onto `surface`.
///
/// The shadow is the band the region would cover if it were moved by the offset,
/// minus the region itself -- an L along the two trailing edges. Drawn before
/// the region is, so it never falls on top of it.
pub fn draw_shadow(surface: &Surface, rect: Rect, options: &ShadowOptions) {
    if surface.is_empty() {
        return;
    }
    let (dx, dy) = (options.offset_x, options.offset_y);
    if dx == 0 && dy == 0 {
        return;
    }

    let paint = |x: isize, y: isize, w: isize, h: isize| {
        if w <= 0 || h <= 0 {
            return;
        }
        match options.color {
            Some(color) => surface.fill_rect(
                x,
                y,
                w as usize,
                h as usize,
                &Style { fg: None, bg: Some(color), attrs: None },
                32,
            ),
            None => dim_rect(surface, x, y, w as usize, h as usize, options.amount),
        }
    };

    // The shadow is the moved region minus the original, which splits into two
    // rectangles that do not touch: the rows the move added, at the moved
    // region's full width, and then the columns it added over the rows the two
    // still share. Cutting it any other way overlaps at the corner, and a
    // corner dimmed twice reads as a smudge rather than an edge.
    let rw = rect.width as isize;
    let rh = rect.height as isize;
    let tx = rect.x + dx;
    let ty = rect.y + dy;
    if dy > 0 {
        paint(tx, rect.y + rh, rw, dy);
    } else if dy < 0 {
        paint(tx, ty, rw, -dy);
    }

    let y0 = rect.y.max(ty);
    let shared = (rect.y + rh).min(ty + rh) - y0;
    if shared > 0 {
        if dx > 0 {
            paint(rect.x + rw, y0, dx, shared);
        } else if dx < 0 {
            paint(tx, y0, -dx, shared);
        }
    }
}
