package hqtui

import "math"

// Braille turns every terminal cell into a 2x4 pixel matrix, which is why a
// terminal graph can look like a real plot instead of a bar chart of hashes.

const brailleBase = 0x2800

// Dot numbering is column-major and famously not sequential.
var dotBits = [4][2]uint8{{0x01, 0x08}, {0x02, 0x10}, {0x04, 0x20}, {0x40, 0x80}}

// jsMin and jsMax propagate NaN, where Go's math.Min and math.Max also do —
// but Go's return the *other* operand for some mixed cases, so the bounds tests
// below are written positively and these two keep the reference's semantics
// exactly.
func jsMin(a, b float64) float64 {
	if math.IsNaN(a) || math.IsNaN(b) {
		return math.NaN()
	}
	if a < b {
		return a
	}
	return b
}

func jsMax(a, b float64) float64 {
	if math.IsNaN(a) || math.IsNaN(b) {
		return math.NaN()
	}
	if a > b {
		return a
	}
	return b
}

type BrailleCanvas struct {
	// Width and Height are pixel dimensions (cols * 2 wide, rows * 4 tall).
	Width  int
	Height int
	Cols   int
	Rows   int
	dots   []uint8
}

// Coordinates are clamped to brailleLimit before anything iterates over them.
// It is far larger than any canvas and far below 2^53, where `x += 1` stops
// advancing and a Bresenham walk can never reach its endpoint.
const brailleLimit = 1e7

// Above this many Bresenham steps the walk is clipped to the canvas first.
// Clipping shifts which pixels a partly-offscreen line lands on, so it is
// reserved for walks long enough that their exact pattern cannot matter.
const brailleMaxWalk = 100000.0

func NewBrailleCanvas(cols, rows int) *BrailleCanvas {
	if cols < 0 {
		cols = 0
	}
	if rows < 0 {
		rows = 0
	}
	return &BrailleCanvas{
		Width: cols * 2, Height: rows * 4, Cols: cols, Rows: rows,
		dots: make([]uint8, cols*rows),
	}
}

func (c *BrailleCanvas) Clear() {
	for i := range c.dots {
		c.dots[i] = 0
	}
}

// locate resolves a pixel coordinate to a cell index and dot bit. The test is
// written positively so that NaN, which compares false against everything, is
// ignored rather than landing in cell 0.
func (c *BrailleCanvas) locate(x, y float64) (int, uint8, bool) {
	px, py := roundHalfUp(x), roundHalfUp(y)
	if !(px >= 0 && py >= 0 && px < float64(c.Width) && py < float64(c.Height)) {
		return 0, 0, false
	}
	ix, iy := int(px), int(py)
	return (iy>>2)*c.Cols + (ix >> 1), dotBits[iy&3][ix&1], true
}

// Pixel sets one pixel. Out-of-range coordinates are ignored, not clamped.
func (c *BrailleCanvas) Pixel(x, y float64) {
	if cell, bit, ok := c.locate(x, y); ok {
		c.dots[cell] |= bit
	}
}

func (c *BrailleCanvas) Unset(x, y float64) {
	if cell, bit, ok := c.locate(x, y); ok {
		c.dots[cell] &^= bit
	}
}

func (c *BrailleCanvas) Get(x, y float64) bool {
	if cell, bit, ok := c.locate(x, y); ok {
		return c.dots[cell]&bit != 0
	}
	return false
}

// finite is bounded and direction-preserving. NaN has no direction.
func finite(v float64) (float64, bool) {
	if math.IsNaN(v) {
		return 0, false
	}
	if v > brailleLimit {
		return brailleLimit, true
	}
	if v < -brailleLimit {
		return -brailleLimit, true
	}
	return v, true
}

// span is the inclusive row/column range an axis-aligned loop should cover,
// clipped to the canvas. Nothing outside it can draw, so clipping here is what
// makes every loop below finite for any input — infinite, enormous or NaN.
func (c *BrailleCanvas) span(a, b float64, limit int) (int, int) {
	lo, hi := jsMin(a, b), jsMax(a, b)
	if !(lo <= hi) {
		return 0, -1
	}
	start := jsMax(0, math.Ceil(lo))
	end := jsMin(float64(limit)-1, math.Floor(hi))
	return int(start), int(end)
}

// clip is Liang-Barsky. Clipping before the walk — rather than clamping the
// endpoints, which would change the slope — keeps the line where it belongs and
// bounds the number of steps to the canvas.
func (c *BrailleCanvas) clip(x0, y0, x1, y1 float64) (float64, float64, float64, float64, bool) {
	fx0, ok0 := finite(x0)
	fy0, ok1 := finite(y0)
	fx1, ok2 := finite(x1)
	fy1, ok3 := finite(y1)
	if !ok0 || !ok1 || !ok2 || !ok3 {
		return 0, 0, 0, 0, false
	}
	dx, dy := fx1-fx0, fy1-fy0
	t0, t1 := 0.0, 1.0
	edges := [4][2]float64{
		{-dx, fx0},
		{dx, float64(c.Width) - 1 - fx0},
		{-dy, fy0},
		{dy, float64(c.Height) - 1 - fy0},
	}
	for _, e := range edges {
		p, q := e[0], e[1]
		if p == 0 {
			if q < 0 {
				return 0, 0, 0, 0, false
			}
			continue
		}
		r := q / p
		if p < 0 {
			if r > t1 {
				return 0, 0, 0, 0, false
			}
			if r > t0 {
				t0 = r
			}
		} else {
			if r < t0 {
				return 0, 0, 0, 0, false
			}
			if r < t1 {
				t1 = r
			}
		}
	}
	return fx0 + t0*dx, fy0 + t0*dy, fx0 + t1*dx, fy0 + t1*dy, true
}

// Line is Bresenham. Used for every line graph in the library.
func (c *BrailleCanvas) Line(x0, y0, x1, y1 float64) {
	// The walk below only ends at `x == ex && y == ey`. Testing the endpoints
	// for finiteness is not enough to guarantee it gets there: the deltas are
	// derived from them and overflow, and past 2^53 `x += 1` does not advance
	// at all. Clipping to the canvas bounds the walk for every input.
	ax, ok0 := finite(x0)
	ay, ok1 := finite(y0)
	bx, ok2 := finite(x1)
	by, ok3 := finite(y1)
	if !ok0 || !ok1 || !ok2 || !ok3 {
		return
	}
	if jsMax(math.Abs(bx-ax), math.Abs(by-ay)) > brailleMaxWalk {
		var ok bool
		ax, ay, bx, by, ok = c.clip(ax, ay, bx, by)
		if !ok {
			return
		}
	}

	x, y := int(roundHalfUp(ax)), int(roundHalfUp(ay))
	ex, ey := int(roundHalfUp(bx)), int(roundHalfUp(by))
	dx, dy := absInt(ex-x), -absInt(ey-y)
	sx, sy := -1, -1
	if x < ex {
		sx = 1
	}
	if y < ey {
		sy = 1
	}
	err := dx + dy
	for {
		c.Pixel(float64(x), float64(y))
		if x == ex && y == ey {
			break
		}
		e2 := 2 * err
		if e2 >= dy {
			err += dy
			x += sx
		}
		if e2 <= dx {
			err += dx
			y += sy
		}
	}
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

type Point struct{ X, Y float64 }

func (c *BrailleCanvas) Polyline(points []Point) {
	for i := 1; i < len(points); i++ {
		c.Line(points[i-1].X, points[i-1].Y, points[i].X, points[i].Y)
	}
}

func (c *BrailleCanvas) VLine(x, y0, y1 float64) {
	a, b := c.span(y0, y1, c.Height)
	for y := a; y <= b; y++ {
		c.Pixel(x, float64(y))
	}
}

func (c *BrailleCanvas) HLine(y, x0, x1 float64) {
	a, b := c.span(x0, x1, c.Width)
	for x := a; x <= b; x++ {
		c.Pixel(float64(x), y)
	}
}

func (c *BrailleCanvas) Rect(x0, y0, x1, y1 float64) {
	c.HLine(y0, x0, x1)
	c.HLine(y1, x0, x1)
	c.VLine(x0, y0, y1)
	c.VLine(x1, y0, y1)
}

func (c *BrailleCanvas) FillRect(x0, y0, x1, y1 float64) {
	a, b := c.span(y0, y1, c.Height)
	for y := a; y <= b; y++ {
		c.HLine(float64(y), x0, x1)
	}
}

// FillUnder shades the area under a series — the filled part of an area graph.
func (c *BrailleCanvas) FillUnder(points []Point, baseline float64) {
	for i := 1; i < len(points); i++ {
		x0, y0 := points[i-1].X, points[i-1].Y
		x1, y1 := points[i].X, points[i].Y
		// Bounded by the canvas: a span wider than it cannot add a column.
		raw := roundHalfUp(math.Abs(x1 - x0))
		if raw == 0 {
			raw = 1
		}
		steps := jsMax(1, jsMin(float64(c.Width), raw))
		for s := 0; s <= int(steps); s++ {
			t := float64(s) / steps
			c.VLine(x0+(x1-x0)*t, y0+(y1-y0)*t, baseline)
		}
	}
}

func (c *BrailleCanvas) Circle(cx, cy, radius float64) {
	// A radius larger than the canvas draws the same arc as one exactly its
	// size, and an unbounded one never finishes the `x >= y` walk.
	r, ok := finite(radius)
	if !ok {
		return
	}
	x := int(roundHalfUp(jsMin(math.Abs(r), float64(c.Width+c.Height))))
	y := 0
	err := 1 - x
	for x >= y {
		fx, fy := float64(x), float64(y)
		c.Pixel(cx+fx, cy+fy)
		c.Pixel(cx+fy, cy+fx)
		c.Pixel(cx-fy, cy+fx)
		c.Pixel(cx-fx, cy+fy)
		c.Pixel(cx-fx, cy-fy)
		c.Pixel(cx-fy, cy-fx)
		c.Pixel(cx+fy, cy-fx)
		c.Pixel(cx+fx, cy-fy)
		y++
		if err < 0 {
			err += 2*y + 1
		} else {
			x--
			err += 2*(y-x) + 1
		}
	}
}

// Cell is the Braille codepoint for one cell, or 0 when the cell is empty.
func (c *BrailleCanvas) Cell(col, row int) Cell {
	if col < 0 || row < 0 || col >= c.Cols || row >= c.Rows {
		return 0
	}
	bits := c.dots[row*c.Cols+col]
	if bits == 0 {
		return 0
	}
	return Cell(brailleBase | int(bits))
}

// Lines renders rows of Braille text — handy for tests and the HTML renderer.
func (c *BrailleCanvas) Lines() []string {
	out := make([]string, 0, c.Rows)
	for row := 0; row < c.Rows; row++ {
		line := make([]rune, 0, c.Cols)
		for col := 0; col < c.Cols; col++ {
			v := c.Cell(col, row)
			if v == 0 {
				line = append(line, ' ')
			} else {
				line = append(line, rune(v))
			}
		}
		out = append(out, string(line))
	}
	return out
}
