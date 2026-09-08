package hqtui

import "math"

// Charts of arbitrary (x, y) data.
//
// Plot takes []float64 and puts one sample per column: the x axis is the slice
// index. That is the right model for a history buffer and the wrong one for
// everything else — two series of different lengths silently render at
// different horizontal scales, a gap in the data is indistinguishable from a
// shorter series, and there is no way at all to say where on the x axis a point
// belongs.
//
// This takes points and a domain for each axis, so a series is placed rather
// than appended. Plot is untouched and still means what it meant.

// MarkType is how a series is marked: joined, dotted, or dropped to the
// baseline.
type MarkType int

const (
	MarkLine MarkType = iota
	MarkScatter
	MarkBar
)

type ChartSeries struct {
	Points []Point
	Color  *Color
	Label  string
	Mark   MarkType
	// Fill shades between the line and the baseline. Ignored for a scatter.
	Fill bool
}

// AxisOptions is one axis: what it spans and how its numbers read.
type AxisOptions struct {
	Min    *float64
	Max    *float64
	Format func(float64) string
	// Ticks is how many labels to place. Default 2 — the ends.
	Ticks int
}

type ChartPlotOptions struct {
	// Mode: Braille is sharpest; block and ascii are graceful degradations.
	Mode       FillMode
	X          *AxisOptions
	Y          *AxisOptions
	Background *Color
	Grid       bool
	GridColor  *Color
	// FillAlpha is the 0-1 opacity of the area fill against the background.
	FillAlpha *float64
	// Baseline is where a bar or an area is measured from. Defaults to the y
	// minimum.
	Baseline *float64
}

type Domain struct{ Min, Max float64 }

// DomainOf is the span an axis covers, from the caller where they said and from
// the data where they did not.
//
// A domain of zero width cannot be mapped — every point would land in the same
// place and a division would blow up — so a flat series is given room around
// itself rather than being collapsed onto one line.
func DomainOf(series []ChartSeries, axis *AxisOptions, which int) Domain {
	var min, max *float64
	if axis != nil {
		min = bound(axis.Min)
		max = bound(axis.Max)
	}
	if min == nil || max == nil {
		lo, hi := math.Inf(1), math.Inf(-1)
		for _, s := range series {
			for _, p := range s.Points {
				v := p.X
				if which == 1 {
					v = p.Y
				}
				if math.IsNaN(v) || math.IsInf(v, 0) {
					continue
				}
				if v < lo {
					lo = v
				}
				if v > hi {
					hi = v
				}
			}
		}
		if math.IsInf(lo, 0) {
			lo, hi = 0, 1
		}
		if min == nil {
			min = &lo
		}
		if max == nil {
			max = &hi
		}
	}
	if !(*max > *min) {
		// A flat series still has to be drawn somewhere sensible.
		pad := 0.5
		if math.Abs(*min) > 0 {
			pad = math.Abs(*min) * 0.5
		}
		return Domain{Min: *min - pad, Max: *min + pad}
	}
	return Domain{Min: *min, Max: *max}
}

// chartRatio is where a value sits in its domain, 0 at the minimum and 1 at the
// maximum.
func chartRatio(value float64, d Domain) float64 {
	return (value - d.Min) / (d.Max - d.Min)
}

func drawChartGrid(s Surface, color Color, bg *Color) {
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

// PlotPoints draws point series across the whole surface.
//
// Points are drawn in the order they are given: a line joins them as they come,
// which is what lets a chart draw a loop or a path that doubles back. Sorting
// them would quietly make that impossible.
func PlotPoints(s Surface, series []ChartSeries, o ChartPlotOptions) {
	if s.IsEmpty() || len(series) == 0 {
		return
	}
	theme := s.Theme
	mode := o.Mode
	bg := o.Background
	w, h := s.Width(), s.Height()

	xd := DomainOf(series, o.X, 0)
	yd := DomainOf(series, o.Y, 1)
	baseline := yd.Min
	if b := bound(o.Baseline); b != nil {
		baseline = *b
	}

	if o.Grid {
		color := theme.Border.Mix(theme.Background, 0.4)
		if o.GridColor != nil {
			color = *o.GridColor
		}
		drawChartGrid(s, color, bg)
	}

	if mode != FillBraille {
		plotChartCells(s, series, mode, xd, yd, baseline, bg)
		return
	}

	canvas := NewBrailleCanvas(w, h)
	px := float64(canvas.Width)
	py := float64(canvas.Height)

	for si, cs := range series {
		canvas.Clear()
		color := SeriesColor(theme, si)
		if cs.Color != nil {
			color = *cs.Color
		}
		finite := make([]Point, 0, len(cs.Points))
		for _, p := range cs.Points {
			if math.IsNaN(p.X) || math.IsInf(p.X, 0) || math.IsNaN(p.Y) || math.IsInf(p.Y, 0) {
				continue
			}
			finite = append(finite, p)
		}
		if len(finite) == 0 {
			continue
		}
		pixels := make([]Point, len(finite))
		for i, p := range finite {
			pixels[i] = Point{
				X: roundHalfUp(clamp01(chartRatio(p.X, xd)) * (px - 1)),
				Y: roundHalfUp((1 - clamp01(chartRatio(p.Y, yd))) * (py - 1)),
			}
		}

		switch cs.Mark {
		case MarkScatter:
			for _, p := range pixels {
				canvas.Pixel(p.X, p.Y)
			}
		case MarkBar:
			floor := roundHalfUp((1 - clamp01(chartRatio(baseline, yd))) * (py - 1))
			for _, p := range pixels {
				canvas.VLine(p.X, math.Min(p.Y, floor), math.Max(p.Y, floor))
			}
		default:
			if len(pixels) == 1 {
				canvas.Pixel(pixels[0].X, pixels[0].Y)
			} else {
				canvas.Polyline(pixels)
			}
		}

		if cs.Fill && cs.Mark != MarkScatter {
			alpha := 0.5
			if o.FillAlpha != nil {
				alpha = *o.FillAlpha
			}
			fillUnderPoints(s, finite, xd, yd, baseline, color, bg, alpha)
		}
		c := color
		Blit(s, canvas, func(col, row int) Color { return c }, bg)
	}
}

// fillUnderPoints shades the area between a series and its baseline, in block
// elements.
//
// Braille would give eight scattered dots per cell, which reads as noise where
// an area should read as an area. The line itself stays Braille, so it keeps
// the sub-cell resolution.
//
// The height of each column is interpolated along the line rather than sampled
// from the points that happen to land in it. Sampling leaves a gap wherever a
// column has no point of its own, which with arbitrary x values is most of them
// — the area comes out striped instead of solid.
func fillUnderPoints(
	s Surface, points []Point, xd, yd Domain, baseline float64, color Color, bg *Color, alpha float64,
) {
	w, h := s.Width(), s.Height()
	if w == 0 || h == 0 || len(points) == 0 {
		return
	}
	base := s.Theme.Background
	if bg != nil {
		base = *bg
	}
	floor := clamp01(chartRatio(baseline, yd))
	column := func(x float64) float64 { return chartRatio(x, xd) * (float64(w) - 1) }

	tops := make([]float64, w)
	for i := range tops {
		tops[i] = math.NaN()
	}
	record := func(col int, value float64) {
		if col < 0 || col >= w {
			return
		}
		// A path that doubles back covers a column twice; the outer edge is the
		// one that bounds the area.
		previous := tops[col]
		if math.IsNaN(previous) || math.Abs(value-floor) > math.Abs(previous-floor) {
			tops[col] = value
		}
	}

	if len(points) == 1 {
		record(int(roundHalfUp(column(points[0].X))), clamp01(chartRatio(points[0].Y, yd)))
	}
	for i := 0; i+1 < len(points); i++ {
		x0, y0 := points[i].X, points[i].Y
		x1, y1 := points[i+1].X, points[i+1].Y
		c0, c1 := column(x0), column(x1)
		from := int(math.Max(0, math.Floor(math.Min(c0, c1))))
		to := int(math.Min(float64(w-1), math.Max(0, math.Ceil(math.Max(c0, c1)))))
		for col := from; col <= to; col++ {
			t := 0.0
			if c1 != c0 {
				t = (float64(col) - c0) / (c1 - c0)
			}
			if t < -0.5 || t > 1.5 {
				continue
			}
			y := y0 + (y1-y0)*clamp01(t)
			record(col, clamp01(chartRatio(y, yd)))
		}
	}

	for x := 0; x < w; x++ {
		top := tops[x]
		if math.IsNaN(top) {
			continue
		}
		from01 := math.Min(floor, top)
		filled := (math.Max(floor, top) - from01) * float64(h)
		bottom := int(math.Floor(from01 * float64(h)))
		full := int(math.Floor(filled))
		for k := 0; k < full && k < h; k++ {
			row := h - 1 - bottom - k
			if row < 0 || row >= h {
				continue
			}
			depth := 0.0
			if h > 1 {
				depth = float64(row) / float64(h-1)
			}
			c := base.Mix(color, alpha*(1-depth*0.3))
			s.Glyph(x, row, '█', Style{Fg: &c, Bg: bg})
		}
		if full < h {
			glyph := VerticalGlyph(filled-float64(full), FillBlock)
			row := h - 1 - bottom - full
			if glyph != " " && row >= 0 && row < h {
				depth := 0.0
				if h > 1 {
					depth = float64(row) / float64(h-1)
				}
				c := base.Mix(color, alpha*(1-depth*0.3)+0.12)
				s.Glyph(x, row, []rune(glyph)[0], Style{Fg: &c, Bg: bg})
			}
		}
	}
}

// plotChartCells is the block and ascii degradation: one column per cell,
// tallest point wins.
//
// A scatter keeps its dots rather than growing columns, because a scatter that
// fills to the baseline is a bar chart wearing the wrong name.
func plotChartCells(
	s Surface, series []ChartSeries, mode FillMode, xd, yd Domain, baseline float64, bg *Color,
) {
	w, h := s.Width(), s.Height()
	theme := s.Theme
	floorRatio := clamp01(chartRatio(baseline, yd))

	for si, cs := range series {
		color := SeriesColor(theme, si)
		if cs.Color != nil {
			color = *cs.Color
		}
		// Highest value per column, so a column shows the peak that fell in it
		// rather than whichever point happened to be last.
		tops := make([]float64, w)
		for i := range tops {
			tops[i] = math.NaN()
		}
		for _, p := range cs.Points {
			if math.IsNaN(p.X) || math.IsInf(p.X, 0) || math.IsNaN(p.Y) || math.IsInf(p.Y, 0) {
				continue
			}
			col := int(roundHalfUp(chartRatio(p.X, xd) * (float64(w) - 1)))
			if col < 0 {
				col = 0
			}
			if col > w-1 {
				col = w - 1
			}
			value := clamp01(chartRatio(p.Y, yd))
			if math.IsNaN(tops[col]) || value > tops[col] {
				tops[col] = value
			}
		}

		for x := 0; x < w; x++ {
			top := tops[x]
			if math.IsNaN(top) {
				continue
			}
			if cs.Mark == MarkScatter {
				k := int(math.Floor(top * float64(h)))
				if k > h-1 {
					k = h - 1
				}
				glyph := '•'
				if mode == FillASCII {
					glyph = '*'
				}
				s.Glyph(x, h-1-k, glyph, Style{Fg: &color, Bg: bg})
				continue
			}
			from := math.Min(floorRatio, top) * float64(h)
			filled := (math.Max(floorRatio, top) - math.Min(floorRatio, top)) * float64(h)
			full := int(math.Floor(filled))
			for k := 0; k < full; k++ {
				row := h - 1 - int(math.Floor(from)) - k
				if row >= 0 && row < h {
					s.Glyph(x, row, '█', Style{Fg: &color, Bg: bg})
				}
			}
			glyph := VerticalGlyph(filled-float64(full), mode)
			row := h - 1 - int(math.Floor(from)) - full
			if glyph != " " && row >= 0 && row < h {
				s.Glyph(x, row, []rune(glyph)[0], Style{Fg: &color, Bg: bg})
			}
		}
	}
}
