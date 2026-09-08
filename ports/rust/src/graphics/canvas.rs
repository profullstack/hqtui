//! A canvas you can draw on in your own coordinates.
//!
//! `BrailleCanvas` works in pixels: good primitives, but the caller does every
//! unit conversion, and a drawing written for one panel size is wrong in the
//! next. This wraps it with a domain per axis and a list of shapes placed in
//! that domain, so the same drawing fits whatever region it is given.
//!
//! Y increases upwards, as it does on paper and in every plot, rather than
//! downwards as it does in a terminal. A canvas is for drawing things that have
//! their own geometry; making the caller flip every y would be handing them
//! back the conversion this exists to take away.

use crate::color::Color;
use crate::graphics::braille::BrailleCanvas;
use crate::graphics::plot::blit;
use crate::surface::Surface;
use crate::buffer::Style;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub min: f64,
    pub max: f64,
}

impl Bounds {
    pub fn new(min: f64, max: f64) -> Bounds {
        Bounds { min, max }
    }
}

impl Default for Bounds {
    fn default() -> Bounds {
        Bounds { min: 0.0, max: 1.0 }
    }
}

#[derive(Clone, Debug)]
pub enum Shape {
    Line { x1: f64, y1: f64, x2: f64, y2: f64, color: Option<Color> },
    Polyline { points: Vec<(f64, f64)>, color: Option<Color> },
    Points { points: Vec<(f64, f64)>, color: Option<Color> },
    Circle { x: f64, y: f64, radius: f64, color: Option<Color> },
    Rect { x: f64, y: f64, width: f64, height: f64, fill: bool, color: Option<Color> },
}

impl Shape {
    fn color(&self) -> Option<Color> {
        match self {
            Shape::Line { color, .. }
            | Shape::Polyline { color, .. }
            | Shape::Points { color, .. }
            | Shape::Circle { color, .. }
            | Shape::Rect { color, .. } => *color,
        }
    }

    /// Whether the shape has anything finite to draw.
    fn usable(&self) -> bool {
        match self {
            Shape::Line { x1, y1, x2, y2, .. } => {
                x1.is_finite() && y1.is_finite() && x2.is_finite() && y2.is_finite()
            }
            Shape::Circle { x, y, radius, .. } => {
                x.is_finite() && y.is_finite() && radius.is_finite()
            }
            Shape::Rect { x, y, width, height, .. } => {
                x.is_finite() && y.is_finite() && width.is_finite() && height.is_finite()
            }
            Shape::Polyline { points, .. } | Shape::Points { points, .. } => {
                points.iter().any(|p| p.0.is_finite() && p.1.is_finite())
            }
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct CanvasOptions {
    pub shapes: Vec<Shape>,
    /// The span the drawing is in. Defaults to 0-1 on both axes.
    pub x: Option<Bounds>,
    pub y: Option<Bounds>,
    /// Colour for shapes that do not name their own.
    pub color: Option<Color>,
    pub background: Option<Color>,
    /// A faint dotted grid behind the shapes.
    pub grid: bool,
    pub grid_color: Option<Color>,
}

/// A usable span: a zero-width one cannot be mapped onto anything.
fn span(bounds: Option<Bounds>) -> Bounds {
    match bounds {
        Some(b) if b.min.is_finite() && b.max.is_finite() && b.max > b.min => b,
        _ => Bounds::default(),
    }
}

/// A projection from the caller's coordinates onto the canvas's pixels.
///
/// Handed out so a caller can place their own labels against the same drawing:
/// a chart axis or a map legend has to agree with the shapes, and re-deriving
/// the mapping by hand is exactly the arithmetic this is here to remove.
#[derive(Clone, Copy, Debug)]
pub struct Projection {
    width: f64,
    height: f64,
    x_bounds: Bounds,
    y_bounds: Bounds,
}

impl Projection {
    pub fn x(&self, value: f64) -> f64 {
        (value - self.x_bounds.min) / (self.x_bounds.max - self.x_bounds.min) * self.width
    }

    /// Flipped: the caller's y goes up, the canvas's goes down.
    pub fn y(&self, value: f64) -> f64 {
        (1.0 - (value - self.y_bounds.min) / (self.y_bounds.max - self.y_bounds.min)) * self.height
    }
}

pub fn projection(canvas: &BrailleCanvas, x_bounds: Bounds, y_bounds: Bounds) -> Projection {
    Projection {
        width: (canvas.width.max(2) - 1) as f64,
        height: (canvas.height.max(2) - 1) as f64,
        x_bounds,
        y_bounds,
    }
}

fn draw_grid(surface: &Surface, color: Color, bg: Option<Color>) {
    let w = surface.width();
    let h = surface.height();
    let step = std::cmp::max(2, h / 4);
    let mut y = 0;
    while y < h {
        let mut x = 0;
        while x < w {
            surface.glyph(x as isize, y as isize, '·', &Style { fg: Some(color), bg, attrs: None });
            x += 2;
        }
        y += step;
    }
}

pub fn draw_canvas(surface: &Surface, options: &CanvasOptions) {
    if surface.is_empty() || options.shapes.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let bg = options.background;
    let xb = span(options.x);
    let yb = span(options.y);

    if options.grid {
        let color = options
            .grid_color
            .unwrap_or_else(|| theme.border.mix(theme.background, 0.4));
        draw_grid(surface, color, bg);
    }

    let mut canvas = BrailleCanvas::new(surface.width(), surface.height());
    let at = projection(&canvas, xb, yb);
    let base = options.color.unwrap_or(theme.accent);

    // One shape at a time, blitted before the next is drawn, so each keeps its
    // own colour. A shared canvas would make the last colour win everywhere the
    // shapes overlap.
    for shape in &options.shapes {
        if !shape.usable() {
            continue;
        }
        canvas.clear();
        match shape {
            Shape::Line { x1, y1, x2, y2, .. } => {
                canvas.line(at.x(*x1), at.y(*y1), at.x(*x2), at.y(*y2));
            }
            Shape::Polyline { points, .. } => {
                let pixels: Vec<(f64, f64)> = points
                    .iter()
                    .filter(|p| p.0.is_finite() && p.1.is_finite())
                    .map(|p| (at.x(p.0), at.y(p.1)))
                    .collect();
                if pixels.len() == 1 {
                    canvas.pixel(pixels[0].0, pixels[0].1);
                } else {
                    canvas.polyline(&pixels);
                }
            }
            Shape::Points { points, .. } => {
                for p in points {
                    if p.0.is_finite() && p.1.is_finite() {
                        canvas.pixel(at.x(p.0), at.y(p.1));
                    }
                }
            }
            Shape::Circle { x, y, radius, .. } => {
                // A radius is a distance, not a position, so it is scaled by the
                // span rather than projected. The two axes rarely scale alike in
                // a terminal cell, and the x one is what a circle is measured
                // against.
                let scale = (canvas.width.max(2) - 1) as f64 / (xb.max - xb.min);
                canvas.circle(at.x(*x), at.y(*y), radius.abs() * scale);
            }
            Shape::Rect { x, y, width, height, fill, .. } => {
                // Given as a corner and a size, in the caller's own direction: a
                // positive height goes up, because their y does.
                let x0 = at.x(*x);
                let x1 = at.x(*x + *width);
                let y0 = at.y(*y);
                let y1 = at.y(*y + *height);
                if *fill {
                    canvas.fill_rect(x0, y0.min(y1), x1, y0.max(y1));
                } else {
                    canvas.rect(x0, y0.min(y1), x1, y0.max(y1));
                }
            }
        }
        let color = shape.color().unwrap_or(base);
        blit(surface, &canvas, |_, _| color, bg);
    }
}
