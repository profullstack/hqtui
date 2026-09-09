//! A world map you can click.
//!
//! The drawing is the canvas doing what it already does -- polylines in the
//! caller's own coordinates, which for a map are degrees. What this adds is the
//! other direction: turning a click back into a country.

use crate::color::Color;
use crate::graphics::canvas::{draw_canvas, Bounds, CanvasOptions};
use crate::graphics::world::{
    country_at, degrees_at, world_shapes, WorldShapeOptions, WORLD_X, WORLD_Y,
};
use crate::graphics::world_data::CountryOutline;
use crate::surface::Surface;

#[derive(Clone, Debug, Default)]
pub struct WorldMapOptions {
    /// The window on the globe. Defaults to all of it.
    pub x: Option<Bounds>,
    pub y: Option<Bounds>,
    /// Coastline colour.
    pub color: Option<Color>,
    /// Countries to pick out, by name or ISO code.
    pub highlight: Vec<String>,
    pub highlight_color: Option<Color>,
    pub background: Option<Color>,
    pub grid: bool,
}

pub fn draw_world_map(surface: &Surface, options: &WorldMapOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    draw_canvas(
        surface,
        &CanvasOptions {
            shapes: world_shapes(&WorldShapeOptions {
                color: Some(options.color.unwrap_or(theme.border)),
                highlight: options.highlight.clone(),
                highlight_color: Some(options.highlight_color.unwrap_or(theme.accent)),
            }),
            x: Some(options.x.unwrap_or(WORLD_X)),
            y: Some(options.y.unwrap_or(WORLD_Y)),
            background: options.background,
            grid: options.grid,
            ..Default::default()
        },
    );
}

/// The country under a cell of a map drawn with these bounds.
///
/// Exposed so a caller can answer a hover as well as a click, and so the
/// arithmetic that has to agree with the drawing lives in one place.
pub fn country_at_cell(
    column: usize,
    row: usize,
    width: usize,
    height: usize,
    options: &WorldMapOptions,
) -> Option<&'static CountryOutline> {
    let (lon, lat) = degrees_at(
        column,
        row,
        width,
        height,
        options.x.unwrap_or(WORLD_X),
        options.y.unwrap_or(WORLD_Y),
    )?;
    country_at(lon, lat)
}
