package hqtui

import "math"

// A chart with two real axes.
//
// Graph plots a history buffer: one sample per column, x meaning "position in
// the slice". This plots data that has its own x values, with a labelled domain
// on both axes, so two series of different lengths line up and a point lands
// where its x says it does.

type ChartOptions struct {
	Series []ChartSeries
	Plot   ChartPlotOptions
	// Axis draws numbers down the left edge.
	Axis        bool
	AxisColor   *Color
	Legend      bool
	LegendAlign Align
}

// ticksFor returns evenly spaced values across a domain, ends included.
//
// Two ticks means the ends and nothing else, which is what an axis wants when
// there is no room to say more.
func ticksFor(min, max float64, count int) []float64 {
	n := count
	if n < 2 {
		n = 2
	}
	out := make([]float64, n)
	for i := 0; i < n; i++ {
		out[i] = min + (max-min)*float64(i)/float64(n-1)
	}
	return out
}

func formatWith(axis *AxisOptions, value float64) string {
	if axis != nil && axis.Format != nil {
		return axis.Format(value)
	}
	return NiceLabel(value)
}

func DrawChart(s Surface, o ChartOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	axisColor := theme.Muted
	if o.AxisColor != nil {
		axisColor = *o.AxisColor
	}

	xd := DomainOf(o.Series, o.Plot.X, 0)
	yd := DomainOf(o.Series, o.Plot.Y, 1)

	// The x labels take a row, and they can only take one when there is a row
	// to spare — a two-row chart is all plot.
	xTicks := 0
	if o.Axis {
		xTicks = 2
	}
	if o.Plot.X != nil && o.Plot.X.Ticks > 0 {
		xTicks = o.Plot.X.Ticks
	}
	wantXAxis := o.Axis && xTicks >= 2 && s.Height() > 2

	plotSurface := s
	if o.Axis {
		hi := formatWith(o.Plot.Y, yd.Max)
		lo := formatWith(o.Plot.Y, yd.Min)
		width := StringWidth(hi)
		if w := StringWidth(lo); w > width {
			width = w
		}
		width++
		s.Text(0, 0, Fit(hi, width, AlignRight), TextOptions{Fg: &axisColor})
		if s.Height() > 1 {
			// The minimum marks the bottom of the plot, which is a row higher
			// when the x labels have taken the last one.
			bottom := s.Height() - 1
			if wantXAxis {
				bottom = s.Height() - 2
			}
			s.Text(0, bottom, Fit(lo, width, AlignRight), TextOptions{Fg: &axisColor})
		}
		plotSurface = s.Sub(width, 0, s.Width()-width, s.Height())
	}

	area := plotSurface
	if wantXAxis && plotSurface.Height() > 1 && plotSurface.Width() > 0 {
		area = plotSurface.Sub(0, 0, plotSurface.Width(), plotSurface.Height()-1)
		row := plotSurface.Height() - 1
		values := ticksFor(xd.Min, xd.Max, xTicks)
		labels := make([]string, len(values))
		for i, v := range values {
			labels[i] = formatWith(o.Plot.X, v)
		}
		step := 0.0
		if len(labels) > 1 {
			step = (float64(plotSurface.Width()) - 1) / float64(len(labels)-1)
		}
		for i, label := range labels {
			// The last label is right-aligned to the edge, so it cannot run off it.
			x := int(roundHalfUp(float64(i) * step))
			if limit := plotSurface.Width() - StringWidth(label); x > limit {
				x = limit
			}
			if x < 0 {
				x = 0
			}
			plotSurface.Text(x, row, label, TextOptions{Fg: &axisColor})
		}
	}

	// The domain is resolved once and handed down, so the labels and the marks
	// cannot disagree about what the axis spans.
	plot := o.Plot
	plot.X = withBounds(o.Plot.X, xd)
	plot.Y = withBounds(o.Plot.Y, yd)
	PlotPoints(area, o.Series, plot)

	if o.Legend {
		type part struct {
			label string
			color Color
		}
		parts := []part{}
		for i, cs := range o.Series {
			if cs.Label == "" {
				continue
			}
			color := SeriesColor(theme, i)
			if cs.Color != nil {
				color = *cs.Color
			}
			parts = append(parts, part{cs.Label, color})
		}
		x := 0
		if o.LegendAlign == AlignRight {
			total := 0
			for _, p := range parts {
				total += StringWidth(p.label) + 3
			}
			x = area.Width() - total
			if x < 0 {
				x = 0
			}
		}
		y := 0
		if area.Height() > 3 {
			y = area.Height() - 1
		}
		for _, p := range parts {
			c := p.color
			x += area.Text(x, y, "■ ", TextOptions{Fg: &c})
			x += area.Text(x, y, p.label+" ", TextOptions{Fg: &theme.Muted})
		}
	}
}

// withBounds pins an axis to a resolved domain, keeping whatever else it said.
func withBounds(axis *AxisOptions, d Domain) *AxisOptions {
	out := AxisOptions{}
	if axis != nil {
		out = *axis
	}
	min, max := d.Min, d.Max
	if math.IsNaN(min) || math.IsNaN(max) {
		return axis
	}
	out.Min = &min
	out.Max = &max
	return &out
}
