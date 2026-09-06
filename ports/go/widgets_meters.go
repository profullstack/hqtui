package hqtui

import (
	"fmt"
	"math"
	"strconv"
)

// Meters, gauges, graphs and the rest of the "how full is it" family.

// ClampRatio normalises to 0-1. Ordered so NaN falls through to 0 — min/max
// propagate it in the reference, which rendered "NaN%" in black on black.
func ClampRatio(value float64) float64 {
	if value > 1 {
		return 1
	}
	if value > 0 {
		return value
	}
	return 0
}

type MeterOptions struct {
	// Value is 0-1, or supply Max and pass an absolute value.
	Value float64
	Max   *float64
	Label string
	// Text is the right-hand readout. Empty means a percentage.
	Text        string
	LabelWidth  int
	ValueWidth  int
	Color       *Color
	// Heat colors green-to-red by fill level. Nil means on unless Color is set.
	Heat       *bool
	Background *Color
	Style      BarStyle
	// HideValue suppresses the right-hand readout entirely.
	HideValue bool
}

// DrawMeter draws `label ████████░░░░ 42%` on a single row. The most-used
// widget here.
func DrawMeter(s Surface, o MeterOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	// 0 and NaN are both falsy in the reference, which then treats Value as an
	// already-normalised ratio instead of dividing by them.
	ratio := o.Value
	if o.Max != nil && *o.Max != 0 && !math.IsNaN(*o.Max) {
		ratio = o.Value / *o.Max
	}
	ratio = ClampRatio(ratio)

	labelWidth := 0
	if o.Label != "" {
		labelWidth = o.LabelWidth
		if labelWidth == 0 {
			labelWidth = StringWidth(o.Label) + 1
		}
	}
	valueText := ""
	if !o.HideValue {
		valueText = o.Text
		if valueText == "" {
			valueText = strconv.Itoa(int(roundHalfUp(ratio*100))) + "%"
		}
	}
	valueWidth := 0
	if valueText != "" {
		valueWidth = o.ValueWidth
		if valueWidth == 0 {
			valueWidth = StringWidth(valueText) + 1
		}
	}
	barWidth := max(0, s.Width()-labelWidth-valueWidth)

	if labelWidth > 0 {
		s.Text(0, 0, Fit(Truncate(o.Label, labelWidth), labelWidth, AlignLeft),
			TextOptions{Fg: &theme.Muted, Bg: o.Background})
	}
	if barWidth > 0 {
		heat := o.Color == nil
		if o.Heat != nil {
			heat = *o.Heat
		}
		Bar(s.Sub(labelWidth, 0, barWidth, 1), BarOptions{
			Value: ratio, Color: o.Color, Heat: &heat,
			Background: o.Background, Style: o.Style,
		})
	}
	if valueWidth > 0 {
		fg := HeatColor(theme, ratio)
		if o.Heat != nil && !*o.Heat {
			fg = theme.Foreground
		}
		if o.Color != nil {
			fg = *o.Color
		}
		s.Text(s.Width()-valueWidth, 0, Fit(valueText, valueWidth, AlignRight),
			TextOptions{Fg: &fg, Bg: o.Background, Attrs: ptrAttrs(AttrBold)})
	}
}

type MeterItem struct {
	Label string
	Value float64
	Max   *float64
	Color *Color
	Text  string
}

func Meter(label string, value float64) MeterItem {
	return MeterItem{Label: label, Value: value}
}

type MetersOptions struct {
	Items      []MeterItem
	LabelWidth int
	ValueWidth int
	Heat       *bool
	Background *Color
	Style      BarStyle
	// Columns lays out in N columns when there is room, like btop's core grid.
	// Zero means one.
	Columns int
	// Gap between columns. Nil means the default, 2.
	Gap *int
}

// DrawMeters draws a stack (or grid) of meters — per-core CPU, per-disk usage.
func DrawMeters(s Surface, o MetersOptions) {
	if s.IsEmpty() {
		return
	}
	columns := max(1, o.Columns)
	gap := 2
	if o.Gap != nil {
		gap = *o.Gap
	}
	colWidth := int(math.Floor(float64(s.Width()-gap*(columns-1)) / float64(columns)))
	perColumn := (len(o.Items) + columns - 1) / columns
	if perColumn == 0 {
		return
	}

	for i, item := range o.Items {
		col, row := i/perColumn, i%perColumn
		if row >= s.Height() || col >= columns {
			continue
		}
		DrawMeter(s.Sub(col*(colWidth+gap), row, max(0, colWidth), 1), MeterOptions{
			Value: item.Value, Max: item.Max, Label: item.Label, Text: item.Text,
			Color: item.Color, LabelWidth: o.LabelWidth, ValueWidth: o.ValueWidth,
			Heat: o.Heat, Background: o.Background, Style: o.Style,
		})
	}
}

type ProgressOptions struct {
	Value      float64
	Max        *float64
	Label      string
	Color      *Color
	Background *Color
	// ShowCount displays `37/120` instead of a percentage.
	ShowCount bool
}

func DrawProgress(s Surface, o ProgressOptions) {
	maxV := 1.0
	if o.Max != nil {
		maxV = *o.Max
	}
	color := s.Theme.Primary
	if o.Color != nil {
		color = *o.Color
	}
	text := ""
	if o.ShowCount {
		text = fmt.Sprintf("%d/%d", int(roundHalfUp(o.Value)), int(roundHalfUp(maxV)))
	}
	DrawMeter(s, MeterOptions{
		Value: o.Value, Max: &maxV, Label: o.Label, Color: &color,
		Heat: ptrBool(false), Background: o.Background, Text: text,
	})
}

// NiceLabel is the axis label format the reference uses when none is given.
func NiceLabel(value float64) string {
	if math.Abs(value) >= 1000 {
		return trimFloat(roundHalfUp(value/100)/10) + "k"
	}
	if value == math.Trunc(value) && !math.IsInf(value, 0) {
		return trimFloat(value)
	}
	return strconv.FormatFloat(value, 'f', 1, 64)
}

// trimFloat is JavaScript's number-to-string: no trailing zeros, no decimal
// point when the value is whole.
func trimFloat(v float64) string { return strconv.FormatFloat(v, 'g', -1, 64) }

type GraphOptions struct {
	// Values is a single series; Series is several. Series wins if both are set.
	Values []float64
	Series []Series
	Plot   PlotOptions
	// Axis draws min/max labels down the left edge.
	Axis        bool
	AxisFormat  func(float64) string
	AxisColor   *Color
	// TimeAxis draws labels along the bottom, e.g. ["60s", "30s", "0s"].
	TimeAxis    []string
	Legend      bool
	LegendAlign Align
}

// DrawGraph draws a line/area graph. Braille by default, so it reads at 2x4 the
// cell resolution.
func DrawGraph(s Surface, o GraphOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	series := o.Series
	if series == nil {
		series = []Series{{Values: o.Values}}
	}

	plotSurface := s
	axisColor := theme.Muted
	if o.AxisColor != nil {
		axisColor = *o.AxisColor
	}

	if o.Axis {
		// Match the window the plot itself will use, so the labels stay truthful.
		columns := s.Width()
		if o.Plot.Mode == FillBraille {
			columns = s.Width() * 2
		}
		var values []float64
		for _, sr := range series {
			for _, v := range tail(sr.Values, columns) {
				if !math.IsNaN(v) && !math.IsInf(v, 0) {
					values = append(values, v)
				}
			}
		}
		maxV := 1.0
		if o.Plot.Max != nil {
			maxV = *o.Plot.Max
		} else if len(values) > 0 {
			maxV = values[0]
			for _, v := range values[1:] {
				maxV = math.Max(maxV, v)
			}
		}
		minV := 0.0
		if o.Plot.Min != nil {
			minV = *o.Plot.Min
		}
		format := NiceLabel
		if o.AxisFormat != nil {
			format = o.AxisFormat
		}
		labelWidth := max(StringWidth(format(maxV)), StringWidth(format(minV))) + 1
		s.Text(0, 0, Fit(format(maxV), labelWidth, AlignRight), TextOptions{Fg: &axisColor})
		if s.Height() > 1 {
			s.Text(0, s.Height()-1, Fit(format(minV), labelWidth, AlignRight),
				TextOptions{Fg: &axisColor})
		}
		plotSurface = s.Sub(labelWidth, 0, max(0, s.Width()-labelWidth), s.Height())
	}

	graphSurface := plotSurface
	if len(o.TimeAxis) > 0 && plotSurface.Height() > 1 {
		graphSurface = plotSurface.Sub(0, 0, plotSurface.Width(), plotSurface.Height()-1)
		step := 0.0
		if len(o.TimeAxis) > 1 {
			step = float64(plotSurface.Width()-1) / float64(len(o.TimeAxis)-1)
		}
		for i, label := range o.TimeAxis {
			x := min(plotSurface.Width()-StringWidth(label), int(roundHalfUp(float64(i)*step)))
			plotSurface.Text(max(0, x), plotSurface.Height()-1, label,
				TextOptions{Fg: &axisColor})
		}
	}

	Plot(graphSurface, series, o.Plot)

	if o.Legend {
		type part struct {
			label string
			color Color
		}
		var parts []part
		for i, sr := range series {
			if sr.Label == "" {
				continue
			}
			color := SeriesColor(theme, i)
			if sr.Color != nil {
				color = *sr.Color
			}
			parts = append(parts, part{sr.Label, color})
		}
		total := 0
		for _, p := range parts {
			total += StringWidth(p.label) + 3
		}
		x := 0
		if o.LegendAlign == AlignRight {
			x = max(0, graphSurface.Width()-total)
		}
		// Sit the legend on the last row when there is one to spare, so it
		// never lands on top of the plot's busiest corner.
		y := 0
		if graphSurface.Height() > 3 {
			y = graphSurface.Height() - 1
		}
		for _, p := range parts {
			c := p.color
			x += graphSurface.Text(x, y, "■ ", TextOptions{Fg: &c})
			x += graphSurface.Text(x, y, p.label+" ", TextOptions{Fg: &theme.Muted})
		}
	}
}

type SparklineWidgetOptions struct {
	Values     []float64
	Color      *Color
	Colors     []Color
	Min        *float64
	Max        *float64
	Label      string
	Text       string
	Background *Color
}

// DrawSparkline draws a one-row trend, optionally with a label and a right-hand
// readout.
func DrawSparkline(s Surface, o SparklineWidgetOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	labelWidth, valueWidth := 0, 0
	if o.Label != "" {
		labelWidth = StringWidth(o.Label) + 1
	}
	if o.Text != "" {
		valueWidth = StringWidth(o.Text) + 1
	}
	if o.Label != "" {
		s.Text(0, 0, o.Label, TextOptions{Fg: &theme.Muted, Bg: o.Background})
	}
	width := s.Width() - labelWidth - valueWidth
	if width > 0 {
		Sparkline(s.Sub(labelWidth, 0, width, 1), o.Values, SparklineOptions{
			Color: o.Color, Colors: o.Colors, Min: o.Min, Max: o.Max,
			Background: o.Background,
		})
	}
	if valueWidth > 0 {
		fg := theme.Accent
		if o.Color != nil {
			fg = *o.Color
		}
		s.Text(s.Width()-valueWidth, 0, Fit(o.Text, valueWidth, AlignRight),
			TextOptions{Fg: &fg, Bg: o.Background, Attrs: ptrAttrs(AttrBold)})
	}
}

type HeatBarOptions struct {
	// Value is 0-1. Renders like btop's temperature bars.
	Value float64
	// Width in cells. Zero means the whole surface.
	Width      int
	Color      *Color
	Background *Color
	// Char is the tick glyph. Zero means the default, '▮'.
	Char rune
}

// DrawHeatBar draws a segmented heat bar: discrete ticks colored along the
// theme ramp.
func DrawHeatBar(s Surface, o HeatBarOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	ratio := clamp01(o.Value)
	width := s.Width()
	if o.Width > 0 {
		width = min(o.Width, s.Width())
	}
	filled := int(roundHalfUp(ratio * float64(width)))
	ramp := GradientOf(theme.Heat)
	ch := o.Char
	if ch == 0 {
		ch = '▮'
	}
	off := theme.Background.Mix(theme.Border, 0.75)
	for x := 0; x < width; x++ {
		fg := off
		if x < filled {
			if o.Color != nil {
				fg = *o.Color
			} else {
				t := ratio
				if width > 1 {
					t = float64(x) / float64(width-1)
				}
				fg = ramp.Sample(t)
			}
		}
		s.Glyph(x, 0, ch, Style{Fg: &fg, Bg: o.Background})
	}
}

type ColumnsOptions struct {
	Values     []float64
	Color      *Color
	Colors     []Color
	Max        *float64
	Background *Color
}

// DrawColumns is a block-mode column chart. Cheaper than Braille and reads well
// when short.
func DrawColumns(s Surface, o ColumnsOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	maxV := 1.0
	if o.Max != nil {
		maxV = *o.Max
	} else {
		for _, v := range o.Values {
			if v > maxV {
				maxV = v
			}
		}
	}
	var ramp *Gradient
	if len(o.Colors) > 0 {
		g := GradientOf(o.Colors)
		ramp = &g
	}
	count := min(len(o.Values), s.Width())
	start := len(o.Values) - count
	h := s.Height()
	for i := 0; i < count; i++ {
		ratio := clamp01(o.Values[start+i] / maxV)
		filled := ratio * float64(h)
		full := int(math.Floor(filled))
		color := theme.Primary
		if o.Color != nil {
			color = *o.Color
		}
		if ramp != nil {
			color = ramp.Sample(ratio)
		}
		style := Style{Fg: &color, Bg: o.Background}
		for k := 0; k < full; k++ {
			s.Glyph(i, h-1-k, '█', style)
		}
		if full < h {
			glyph := VerticalGlyph(filled-math.Floor(filled), FillBlock)
			if glyph != " " {
				s.Glyph(i, h-1-full, firstRune(glyph), style)
			}
		}
	}
}
