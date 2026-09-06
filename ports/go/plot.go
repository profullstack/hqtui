package hqtui

import (
	"fmt"
	"math"
)

// Line, area, bar and dial rendering. With FillBraille each cell carries a 2x4
// pixel matrix, so a 40x10 panel plots at 80x40 resolution.

type Series struct {
	Values []float64
	Color  *Color
	Label  string
	// Fill shades the area beneath the line.
	Fill *bool
}

func NewSeries(values ...float64) Series { return Series{Values: values} }

func (s Series) WithColor(c Color) Series { s.Color = &c; return s }
func (s Series) WithLabel(l string) Series { s.Label = l; return s }
func (s Series) Filled() Series {
	t := true
	s.Fill = &t
	return s
}

type PlotOptions struct {
	// Mode: Braille is sharpest; block and ascii are graceful degradations.
	Mode FillMode
	Min  *float64
	Max  *float64
	// Color is a flat color for every series that does not name its own.
	Color *Color
	// Colors colors the plot along a ramp by value rather than one flat color.
	Colors []Color
	Fill   *bool
	// FillAlpha is the 0-1 opacity of the area fill against the background.
	FillAlpha  *float64
	Background *Color
	// Grid draws a faint dotted grid behind the series.
	Grid      bool
	GridColor *Color
	Baseline  *float64
}

// bound returns a finite number, or nothing — `sum / count` with no samples is
// NaN.
func bound(v *float64) *float64 {
	if v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) {
		return nil
	}
	return v
}

func extent(series []Series, o PlotOptions) (float64, float64) {
	// A caller's axis bound is data, and data can be NaN. Falling back to the
	// computed extent keeps every plotted coordinate finite.
	minP, maxP := bound(o.Min), bound(o.Max)
	var minV, maxV float64
	if minP == nil || maxP == nil {
		lo, hi := math.Inf(1), math.Inf(-1)
		for _, s := range series {
			for _, v := range s.Values {
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
		if minP == nil {
			minV = math.Min(0, lo)
		} else {
			minV = *minP
		}
		if maxP == nil {
			maxV = hi
		} else {
			maxV = *maxP
		}
	} else {
		minV, maxV = *minP, *maxP
	}
	if maxV <= minV {
		maxV = minV + 1
	}
	return minV, maxV
}

// tail is the trailing window of a series that will actually be drawn.
func tail(values []float64, columns int) []float64 {
	n := max(1, columns)
	if len(values) <= n {
		return values
	}
	return values[len(values)-n:]
}

func drawGrid(s Surface, color Color, bg *Color) {
	w, h := s.Width(), s.Height()
	step := max(2, h/4)
	for y := 0; y < h; y += step {
		for x := 0; x < w; x += 2 {
			s.Glyph(x, y, '·', Style{Fg: &color, Bg: bg})
		}
	}
}

// Plot draws one or more series across the whole surface.
func Plot(s Surface, series []Series, o PlotOptions) {
	if s.IsEmpty() || len(series) == 0 {
		return
	}
	theme := s.Theme
	bg := o.Background
	w, h := s.Width(), s.Height()

	// Only the samples that will actually be drawn should set the scale, or an
	// old spike still sitting in the history buffer flattens the live line.
	columns := w
	if o.Mode == FillBraille {
		columns = w * 2
	}
	visible := make([]Series, len(series))
	for i, sr := range series {
		sr.Values = tail(sr.Values, columns)
		visible[i] = sr
	}
	minV, maxV := extent(visible, o)
	span := maxV - minV

	if o.Grid {
		color := theme.Border.Mix(theme.Background, 0.4)
		if o.GridColor != nil {
			color = *o.GridColor
		}
		drawGrid(s, color, bg)
	}

	if o.Mode == FillBlock || o.Mode == FillASCII || o.Mode == FillHalf {
		// One column per cell, newest value on the right.
		for si, sr := range visible {
			color := SeriesColor(theme, si)
			if o.Color != nil {
				color = *o.Color
			}
			if sr.Color != nil {
				color = *sr.Color
			}
			var ramp *Gradient
			if len(o.Colors) > 0 {
				g := GradientOf(o.Colors)
				ramp = &g
			}
			for x := 0; x < w; x++ {
				idx := len(sr.Values) - w + x
				if idx < 0 || idx >= len(sr.Values) {
					continue
				}
				v := sr.Values[idx]
				if math.IsNaN(v) || math.IsInf(v, 0) {
					continue
				}
				ratio := (v - minV) / span
				filled := ratio * float64(h)
				full := math.Floor(filled)
				cellColor := color
				if ramp != nil {
					cellColor = ramp.Sample(ratio)
				}
				style := Style{Fg: &cellColor, Bg: bg}
				fullI := 0
				if !math.IsNaN(full) && !math.IsInf(full, 0) {
					fullI = int(full)
				}
				for k := 0; k < fullI && k < h; k++ {
					s.Glyph(x, h-1-k, '█', style)
				}
				if fullI < h {
					glyph := VerticalGlyph(filled-full, o.Mode)
					if glyph != " " {
						s.Glyph(x, h-1-fullI, firstRune(glyph), style)
					}
				}
			}
		}
		return
	}

	// Braille: build one canvas per series so colors stay separable.
	canvas := NewBrailleCanvas(w, h)
	px, py := canvas.Width, canvas.Height

	for si, sr := range visible {
		canvas.Clear()
		color := SeriesColor(theme, si)
		if o.Color != nil {
			color = *o.Color
		}
		if sr.Color != nil {
			color = *sr.Color
		}
		if len(sr.Values) == 0 {
			continue
		}
		count := min(len(sr.Values), px)
		start := len(sr.Values) - count
		points := make([]Point, 0, count)
		for i := 0; i < count; i++ {
			v := sr.Values[start+i]
			if math.IsNaN(v) || math.IsInf(v, 0) {
				continue
			}
			ratio := (v - minV) / span
			x := float64(px - 1)
			if count > 1 {
				x = roundHalfUp(float64(i) / float64(count-1) * float64(px-1))
			}
			y := roundHalfUp((1 - clamp01(ratio)) * float64(py-1))
			points = append(points, Point{X: x, Y: y})
		}
		if len(points) == 0 {
			continue
		}
		if len(points) == 1 {
			canvas.Pixel(points[0].X, points[0].Y)
		} else {
			canvas.Polyline(points)
		}

		wantFill := false
		if o.Fill != nil {
			wantFill = *o.Fill
		}
		if sr.Fill != nil {
			wantFill = *sr.Fill
		}
		fillAlpha := 0.5
		if o.FillAlpha != nil {
			fillAlpha = *o.FillAlpha
		}
		if wantFill {
			// The area is drawn with block elements rather than Braille: eight
			// scattered dots per cell reads as noise, a block reads as an area.
			// The line stays Braille, so it keeps the sub-cell resolution.
			base := theme.Background
			if bg != nil {
				base = *bg
			}
			// The fill has to walk the same window as the line, averaging the
			// samples that land inside each cell — otherwise the area drifts
			// out of step.
			sampleCount := min(len(sr.Values), px)
			sampleStart := len(sr.Values) - sampleCount
			for x := 0; x < w; x++ {
				from := sampleStart + int(float64(x)/float64(w)*float64(sampleCount))
				to := max(from+1, sampleStart+int(float64(x+1)/float64(w)*float64(sampleCount)))
				sum, seen := 0.0, 0
				for i := from; i < to && i < len(sr.Values); i++ {
					sample := sr.Values[i]
					if !math.IsNaN(sample) && !math.IsInf(sample, 0) {
						sum += sample
						seen++
					}
				}
				if seen == 0 {
					continue
				}
				ratio := clamp01((sum/float64(seen) - minV) / span)
				filled := ratio * float64(h)
				full := int(math.Floor(filled))
				for k := 0; k < full && k < h; k++ {
					row := h - 1 - k
					depth := 0.0
					if h > 1 {
						depth = float64(row) / float64(h-1)
					}
					c := base.Mix(color, fillAlpha*(1-depth*0.3))
					s.Glyph(x, row, '█', Style{Fg: &c, Bg: bg})
				}
				if full < h {
					glyph := VerticalGlyph(filled-math.Floor(filled), FillBlock)
					if glyph != " " {
						row := h - 1 - full
						depth := 0.0
						if h > 1 {
							depth = float64(row) / float64(h-1)
						}
						c := base.Mix(color, fillAlpha*(1-depth*0.3)+0.12)
						s.Glyph(x, row, firstRune(glyph), Style{Fg: &c, Bg: bg})
					}
				}
			}
		}

		var ramp *Gradient
		if len(o.Colors) > 0 {
			g := GradientOf(o.Colors)
			ramp = &g
		}
		Blit(s, canvas, func(col, row int) Color {
			if ramp == nil {
				return color
			}
			return ramp.Sample(1 - float64(row)/float64(max(1, h-1)))
		}, bg)
	}
}

// Blit copies a Braille canvas onto a surface, one glyph per cell.
func Blit(s Surface, canvas *BrailleCanvas, colorAt func(col, row int) Color, bg *Color) {
	for row := 0; row < canvas.Rows; row++ {
		for col := 0; col < canvas.Cols; col++ {
			value := canvas.Cell(col, row)
			if value == 0 {
				continue
			}
			c := colorAt(col, row)
			s.Char(col, row, value, Style{Fg: &c, Bg: bg})
		}
	}
}

type SparklineOptions struct {
	Color      *Color
	Colors     []Color
	Min        *float64
	Max        *float64
	Background *Color
	Mode       FillMode
}

// Sparkline draws a single-row trend line. Cheap enough to put in a table cell.
func Sparkline(s Surface, values []float64, o SparklineOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	w := s.Width()
	minV, maxV := extent([]Series{{Values: tail(values, w)}}, PlotOptions{Min: o.Min, Max: o.Max})
	span := maxV - minV
	var ramp *Gradient
	if len(o.Colors) > 0 {
		g := GradientOf(o.Colors)
		ramp = &g
	}
	color := theme.Accent
	if o.Color != nil {
		color = *o.Color
	}
	count := min(len(values), w)
	start := len(values) - count
	offset := w - count
	for i := 0; i < count; i++ {
		v := values[start+i]
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		ratio := clamp01((v - minV) / span)
		c := color
		if ramp != nil {
			c = ramp.Sample(ratio)
		}
		s.Glyph(offset+i, 0, firstRune(VerticalGlyph(ratio, o.Mode)), Style{Fg: &c, Bg: o.Background})
	}
}

// BarStyle is how a horizontal bar's fill is drawn.
type BarStyle int

const (
	BarSmooth BarStyle = iota
	// BarSegmented draws discrete ticks with gaps, so stacked bars stay
	// separable. This is the btop look.
	BarSegmented
	BarASCII
)

func ParseBarStyle(name string) BarStyle {
	switch name {
	case "segmented":
		return BarSegmented
	case "ascii":
		return BarASCII
	}
	return BarSmooth
}

type BarOptions struct {
	// Value is 0-1. Values outside are clamped.
	Value float64
	Color *Color
	// Heat colors by fill level using the theme heat ramp.
	Heat       *bool
	Track      *Color
	Background *Color
	Style      BarStyle
	TrackChar  *rune
}

// Bar draws a horizontal bar filling the surface's first row.
func Bar(s Surface, o BarOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	w := s.Width()
	ratio := clamp01(o.Value)
	trackColor := theme.Background.Mix(theme.Border, 0.8)
	if o.Track != nil {
		trackColor = *o.Track
	}
	var heat *Gradient
	if o.Heat != nil && *o.Heat {
		g := GradientOf(theme.Heat)
		heat = &g
	}
	color := theme.Primary
	if o.Color != nil {
		color = *o.Color
	}
	trackChar := '─'
	fillChar := '█'
	switch o.Style {
	case BarASCII:
		trackChar, fillChar = '-', '#'
	case BarSegmented:
		trackChar, fillChar = '▮', '▮'
	}
	if o.TrackChar != nil {
		trackChar = *o.TrackChar
	}

	filled := ratio * float64(w)
	full := int(math.Floor(filled))

	for x := 0; x < w; x++ {
		switch {
		case x < full:
			fg := color
			if heat != nil {
				t := ratio
				if w > 1 {
					t = float64(x) / float64(w-1)
				}
				fg = heat.Sample(t)
			}
			s.Glyph(x, 0, fillChar, Style{Fg: &fg, Bg: o.Background})
		case x == full && o.Style != BarSegmented:
			mode := FillBlock
			if o.Style == BarASCII {
				mode = FillASCII
			}
			glyph := HorizontalGlyph(filled-math.Floor(filled), mode)
			blank := glyph == " "
			fg := color
			if blank {
				fg = trackColor
			} else if heat != nil {
				fg = heat.Sample(ratio)
			}
			ch := firstRune(glyph)
			if blank {
				ch = trackChar
			}
			s.Glyph(x, 0, ch, Style{Fg: &fg, Bg: o.Background})
		default:
			s.Glyph(x, 0, trackChar, Style{Fg: &trackColor, Bg: o.Background})
		}
	}
}

type GaugeOptions struct {
	Value      float64
	Color      *Color
	Background *Color
	Label      string
	Heat       *bool
}

// Gauge draws a semicircular dial with Braille. Needs about 9x5 cells to look
// right.
func Gauge(s Surface, o GaugeOptions) {
	if s.IsEmpty() || s.Height() < 3 {
		Bar(s, BarOptions{Value: o.Value, Color: o.Color, Heat: o.Heat})
		return
	}
	theme := s.Theme
	ratio := clamp01(o.Value)
	canvas := NewBrailleCanvas(s.Width(), s.Height())
	cx := float64(canvas.Width) / 2
	cy := float64(canvas.Height) - 2
	radius := math.Min(float64(canvas.Width)/2-1, float64(canvas.Height)-3)
	heat := GradientOf(theme.Heat)

	steps := int(math.Max(24, roundHalfUp(radius*4)))
	for i := 0; i <= steps; i++ {
		t := float64(i) / float64(steps)
		angle := math.Pi * (1 - t)
		x := cx + math.Cos(angle)*radius
		y := cy - math.Sin(angle)*radius*0.85
		if t <= ratio {
			canvas.Pixel(x, y)
			canvas.Pixel(x, y-1)
		}
	}
	color := heat.Sample(ratio)
	if o.Heat != nil && !*o.Heat {
		color = theme.Primary
	}
	if o.Color != nil {
		color = *o.Color
	}
	Blit(s, canvas, func(int, int) Color { return color }, o.Background)

	// Unfilled remainder of the dial, dimmed.
	rest := NewBrailleCanvas(s.Width(), s.Height())
	for i := 0; i <= steps; i++ {
		t := float64(i) / float64(steps)
		if t <= ratio {
			continue
		}
		angle := math.Pi * (1 - t)
		rest.Pixel(cx+math.Cos(angle)*radius, cy-math.Sin(angle)*radius*0.85)
	}
	dim := theme.Background.Mix(theme.Border, 0.9)
	Blit(s, rest, func(int, int) Color { return dim }, o.Background)

	if o.Label != "" {
		bold := AttrBold
		s.TextAligned(s.Height()-1, o.Label, AlignCenter, TextOptions{Fg: &color, Attrs: &bold})
	}
}

type DonutSegment struct {
	Value float64
	Color *Color
	Label string
}

type DonutOptions struct {
	Segments   []DonutSegment
	Background *Color
}

// Donut draws a ring chart. Reads well from about 12x6 cells.
func Donut(s Surface, o DonutOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	total := 0.0
	for _, seg := range o.Segments {
		total += math.Max(0, seg.Value)
	}
	if total == 0 {
		total = 1
	}
	canvas := NewBrailleCanvas(s.Width(), s.Height())
	cx := float64(canvas.Width) / 2
	cy := float64(canvas.Height) / 2
	outer := math.Min(float64(canvas.Width)/2, float64(canvas.Height)/2) - 1
	inner := outer * 0.55
	colorFor := map[string]Color{}

	angle := -math.Pi / 2
	for i, seg := range o.Segments {
		sweep := math.Max(0, seg.Value) / total * math.Pi * 2
		color := SeriesColor(theme, i)
		if seg.Color != nil {
			color = *seg.Color
		}
		steps := int(math.Max(8, roundHalfUp(sweep*outer*3)))
		for st := 0; st <= steps; st++ {
			a := angle + sweep*float64(st)/float64(steps)
			for r := inner; r <= outer; r += 0.4 {
				x := roundHalfUp(cx + math.Cos(a)*r)
				y := roundHalfUp(cy + math.Sin(a)*r*0.9)
				canvas.Pixel(x, y)
				colorFor[fmt.Sprintf("%d,%d", int(x)>>1, int(y)>>2)] = color
			}
		}
		angle += sweep
	}

	Blit(s, canvas, func(col, row int) Color {
		if c, ok := colorFor[fmt.Sprintf("%d,%d", col, row)]; ok {
			return c
		}
		return theme.Muted
	}, o.Background)
}

type HistogramOptions struct {
	Values     []float64
	Color      *Color
	Colors     []Color
	Background *Color
	Max        *float64
}

// Histogram is a vertical column chart, one column per value, newest on the
// right.
func Histogram(s Surface, o HistogramOptions) {
	zero := 0.0
	Plot(s, []Series{{Values: o.Values}}, PlotOptions{
		Mode: FillBlock, Color: o.Color, Colors: o.Colors,
		Background: o.Background, Max: o.Max, Min: &zero,
	})
}
