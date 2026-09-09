//! The world, as shapes for the canvas, and the lookup that makes it clickable.
//!
//! The canvas already draws in the caller's own coordinates, and longitude and
//! latitude are just another pair of axes -- so a map is a list of polylines in
//! degrees, and nothing here needs a projection of its own beyond deciding
//! which window on the globe to show.
//!
//! The interesting half is the other direction. A click arrives as a terminal
//! cell, and a country is a polygon, so answering "what did they click" means
//! turning the cell back into degrees and testing it against the outlines.
//! Doing it that way rather than with bounding boxes is what makes the answer
//! right: Russia's bounding box covers most of the northern hemisphere, and
//! Chile's covers Argentina.

use crate::color::Color;
use crate::graphics::canvas::{Bounds, Shape};
use crate::graphics::world_data::{CountryOutline, WORLD_COUNTRIES};

/// The whole globe, which is what a map shows unless told otherwise.
pub const WORLD_X: Bounds = Bounds { min: -180.0, max: 180.0 };
pub const WORLD_Y: Bounds = Bounds { min: -90.0, max: 90.0 };

#[derive(Clone, Debug, Default)]
pub struct WorldShapeOptions {
    /// Colour for countries with nothing special about them.
    pub color: Option<Color>,
    /// Countries to pick out, by name or ISO code.
    pub highlight: Vec<String>,
    pub highlight_color: Option<Color>,
}

/// Match on either the name or the ISO code, case-insensitively.
fn matches(country: &CountryOutline, keys: &[String]) -> bool {
    keys.iter().any(|key| {
        !key.is_empty()
            && (country.name.eq_ignore_ascii_case(key)
                || (!country.iso.is_empty() && country.iso.eq_ignore_ascii_case(key)))
    })
}

/// The world as canvas shapes, one polyline per landmass.
///
/// Polylines rather than scattered points: the outlines are closed rings, so
/// joining them draws a coastline instead of a dotted suggestion of one, and it
/// reads at a fraction of the resolution dots would need.
pub fn world_shapes(options: &WorldShapeOptions) -> Vec<Shape> {
    let mut shapes = Vec::new();
    for country in WORLD_COUNTRIES {
        let picked = !options.highlight.is_empty() && matches(country, &options.highlight);
        let color = if picked { options.highlight_color.or(options.color) } else { options.color };
        for ring in country.rings {
            let mut points: Vec<(f64, f64)> = Vec::with_capacity(ring.len() / 2 + 1);
            let mut i = 0;
            while i + 1 < ring.len() {
                points.push((ring[i], ring[i + 1]));
                i += 2;
            }
            // Closed: the last point joins the first, or every country has a
            // gap in its coastline where the ring started.
            if let Some(first) = points.first().copied() {
                points.push(first);
            }
            shapes.push(Shape::Polyline { points, color });
        }
    }
    shapes
}

/// Whether a point is inside a ring, by ray casting.
///
/// The ring is a flat list of interleaved coordinates, so this walks it two at
/// a time rather than allocating a pair per vertex -- it runs once per country
/// per click, and there are a couple of thousand vertices.
fn inside_ring(ring: &[f64], lon: f64, lat: f64) -> bool {
    let mut inside = false;
    let n = ring.len() / 2;
    if n == 0 {
        return false;
    }
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (ring[i * 2], ring[i * 2 + 1]);
        let (xj, yj) = (ring[j * 2], ring[j * 2 + 1]);
        if (yi > lat) != (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// The country containing a point, or `None` for open water.
///
/// Where outlines overlap -- and at this resolution simplified borders do
/// overlap -- the first match wins, which is stable because the data is sorted
/// by name.
pub fn country_at(lon: f64, lat: f64) -> Option<&'static CountryOutline> {
    if !lon.is_finite() || !lat.is_finite() {
        return None;
    }
    WORLD_COUNTRIES
        .iter()
        .find(|country| country.rings.iter().any(|ring| inside_ring(ring, lon, lat)))
}

/// Look a country up by name or ISO code.
pub fn find_country(key: &str) -> Option<&'static CountryOutline> {
    let keys = [key.to_string()];
    WORLD_COUNTRIES.iter().find(|country| matches(country, &keys))
}

/// The window a country fills, with a little room around it.
///
/// For zooming a map to a country: the bounding box alone puts the coastline
/// flat against the edge of the panel, which reads as though the country has
/// been cut off rather than framed.
pub fn country_bounds(country: &CountryOutline, margin: f64) -> (Bounds, Bounds) {
    let mut min_lon = f64::INFINITY;
    let mut max_lon = f64::NEG_INFINITY;
    let mut min_lat = f64::INFINITY;
    let mut max_lat = f64::NEG_INFINITY;
    for ring in country.rings {
        let mut i = 0;
        while i + 1 < ring.len() {
            min_lon = min_lon.min(ring[i]);
            max_lon = max_lon.max(ring[i]);
            min_lat = min_lat.min(ring[i + 1]);
            max_lat = max_lat.max(ring[i + 1]);
            i += 2;
        }
    }
    if !min_lon.is_finite() {
        return (WORLD_X, WORLD_Y);
    }
    // A single-point country would give a zero-width window, which cannot be
    // mapped onto anything.
    let pad_x = ((max_lon - min_lon) * margin).max(1.0);
    let pad_y = ((max_lat - min_lat) * margin).max(1.0);
    (
        Bounds { min: min_lon - pad_x, max: max_lon + pad_x },
        Bounds { min: min_lat - pad_y, max: max_lat + pad_y },
    )
}

/// The degrees under a terminal cell, given the window the map was drawn with.
///
/// The inverse of what the canvas does on the way in, taken at the centre of
/// the cell: a click lands on a whole cell, and the centre is the only point in
/// it that is not arbitrarily nearer one neighbour than the other.
pub fn degrees_at(
    column: usize,
    row: usize,
    width: usize,
    height: usize,
    x: Bounds,
    y: Bounds,
) -> Option<(f64, f64)> {
    if width == 0 || height == 0 {
        return None;
    }
    // The canvas is 2x4 Braille pixels per cell, and it spans its bounds across
    // `pixels - 1`, so the inverse has to use the same denominators or a click
    // drifts from what was drawn.
    let px = (width * 2).saturating_sub(1).max(1) as f64;
    let py = (height * 4).saturating_sub(1).max(1) as f64;
    let lon = x.min + ((column * 2 + 1) as f64 / px) * (x.max - x.min);
    let lat = y.min + (1.0 - (row * 4 + 2) as f64 / py) * (y.max - y.min);
    Some((lon, lat))
}
