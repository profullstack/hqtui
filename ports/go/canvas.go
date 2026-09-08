package hqtui

import "math"

// A canvas you can draw on in your own coordinates.
//
// BrailleCanvas works in pixels: good primitives, but the caller does every
// unit conversion, and a drawing written for one panel size is wrong in the
// next. This wraps it with a domain per axis and a list of shapes placed in
// that domain, so the same drawing fits whatever region it is given.
//
// Y increases upwards, as it does on paper and in every plot, rather than
// downwards as it does in a terminal. A canvas is for drawing things that have
// their own geometry; making the caller flip every y would be handing them back
// the conversion this exists to take away.

type Bounds struct{ Min, Max float64 }

// ShapeKind is which of the shapes a Shape is.
type ShapeKind int

const (
	ShapeLine ShapeKind = iota
	ShapePolyline
	ShapePoints
	ShapeCircle
	ShapeRect
)

type Shape struct {
	Kind ShapeKind
	// Line: the two ends. Circle and Rect: the centre or corner in X, Y.
	X1, Y1, X2, Y2 float64
	// Points and Polyline.
	Points []Point
	// Circle.
	Radius float64
	// Rect.
	Width, Height float64
	Fill          bool
	Color         *Color
}

type CanvasOptions struct {
	Shapes []Shape
	// X and Y are the span the drawing is in. Nil means 0-1.
	X *Bounds
	Y *Bounds
	// Color is for shapes that do not name their own.
	Color      *Color
	Background *Color
	// Grid draws a faint dotted grid behind the shapes.
	Grid      bool
	GridColor *Color
}

// canvasSpan is a usable span: a zero-width one cannot be mapped onto anything.
func canvasSpan(b *Bounds) Bounds {
	if b == nil || math.IsNaN(b.Min) || math.IsNaN(b.Max) || math.IsInf(b.Min, 0) ||
		math.IsInf(b.Max, 0) || !(b.Max > b.Min) {
		return Bounds{Min: 0, Max: 1}
	}
	return *b
}

// Projection maps the caller's coordinates onto the canvas's pixels.
//
// Handed out so a caller can place their own labels against the same drawing:
// a chart axis or a map legend has to agree with the shapes, and re-deriving
// the mapping by hand is exactly the arithmetic this is here to remove.
type Projection struct {
	width, height    float64
	xBounds, yBounds Bounds
}

func (p Projection) X(value float64) float64 {
	return (value - p.xBounds.Min) / (p.xBounds.Max - p.xBounds.Min) * p.width
}

// Y is flipped: the caller's y goes up, the canvas's goes down.
func (p Projection) Y(value float64) float64 {
	return (1 - (value-p.yBounds.Min)/(p.yBounds.Max-p.yBounds.Min)) * p.height
}

func NewProjection(canvas *BrailleCanvas, x, y Bounds) Projection {
	return Projection{
		width:   float64(max(2, canvas.Width) - 1),
		height:  float64(max(2, canvas.Height) - 1),
		xBounds: x,
		yBounds: y,
	}
}

// allFinite is spelled out rather than reusing braille.go's finite, which
// answers a different question: that one normalises a single coordinate, this
// one asks whether a whole shape is drawable.
func allFinite(values ...float64) bool {
	for _, v := range values {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return true
}

// usable reports whether a shape has anything finite to draw.
func (s Shape) usable() bool {
	switch s.Kind {
	case ShapeLine:
		return allFinite(s.X1, s.Y1, s.X2, s.Y2)
	case ShapeCircle:
		return allFinite(s.X1, s.Y1, s.Radius)
	case ShapeRect:
		return allFinite(s.X1, s.Y1, s.Width, s.Height)
	default:
		for _, p := range s.Points {
			if allFinite(p.X, p.Y) {
				return true
			}
		}
		return false
	}
}

func drawCanvasGrid(s Surface, color Color, bg *Color) {
	w, h := s.Width(), s.Height()
	step := h / 4
	if step < 2 {
		step = 2
	}
	for y := 0; y < h; y += step {
		for x := 0; x < w; x += 2 {
			s.Glyph(x, y, '·', Style{Fg: &color, Bg: bg})
		}
	}
}

func DrawCanvas(s Surface, o CanvasOptions) {
	if s.IsEmpty() || len(o.Shapes) == 0 {
		return
	}
	theme := s.Theme
	bg := o.Background
	xb := canvasSpan(o.X)
	yb := canvasSpan(o.Y)

	if o.Grid {
		color := theme.Border.Mix(theme.Background, 0.4)
		if o.GridColor != nil {
			color = *o.GridColor
		}
		drawCanvasGrid(s, color, bg)
	}

	canvas := NewBrailleCanvas(s.Width(), s.Height())
	at := NewProjection(canvas, xb, yb)
	base := theme.Accent
	if o.Color != nil {
		base = *o.Color
	}

	// One shape at a time, blitted before the next is drawn, so each keeps its
	// own colour. A shared canvas would make the last colour win everywhere the
	// shapes overlap.
	for _, shape := range o.Shapes {
		if !shape.usable() {
			continue
		}
		canvas.Clear()
		switch shape.Kind {
		case ShapeLine:
			canvas.Line(at.X(shape.X1), at.Y(shape.Y1), at.X(shape.X2), at.Y(shape.Y2))
		case ShapePolyline:
			pixels := make([]Point, 0, len(shape.Points))
			for _, p := range shape.Points {
				if allFinite(p.X, p.Y) {
					pixels = append(pixels, Point{X: at.X(p.X), Y: at.Y(p.Y)})
				}
			}
			if len(pixels) == 1 {
				canvas.Pixel(pixels[0].X, pixels[0].Y)
			} else {
				canvas.Polyline(pixels)
			}
		case ShapePoints:
			for _, p := range shape.Points {
				if allFinite(p.X, p.Y) {
					canvas.Pixel(at.X(p.X), at.Y(p.Y))
				}
			}
		case ShapeCircle:
			// A radius is a distance, not a position, so it is scaled by the
			// span rather than projected. The two axes rarely scale alike in a
			// terminal cell, and the x one is what a circle is measured against.
			scale := float64(max(2, canvas.Width)-1) / (xb.Max - xb.Min)
			canvas.Circle(at.X(shape.X1), at.Y(shape.Y1), math.Abs(shape.Radius)*scale)
		case ShapeRect:
			// Given as a corner and a size, in the caller's own direction: a
			// positive height goes up, because their y does.
			x0 := at.X(shape.X1)
			x1 := at.X(shape.X1 + shape.Width)
			y0 := at.Y(shape.Y1)
			y1 := at.Y(shape.Y1 + shape.Height)
			if shape.Fill {
				canvas.FillRect(x0, math.Min(y0, y1), x1, math.Max(y0, y1))
			} else {
				canvas.Rect(x0, math.Min(y0, y1), x1, math.Max(y0, y1))
			}
		}
		color := base
		if shape.Color != nil {
			color = *shape.Color
		}
		c := color
		Blit(s, canvas, func(col, row int) Color { return c }, bg)
	}
}
