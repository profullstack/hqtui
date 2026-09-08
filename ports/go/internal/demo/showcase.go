package demo

import (
	"fmt"
	ui "github.com/profullstack/hqtui/ports/go"
	"math"
)

func wave(phase, freq float64) []float64 {
	out := make([]float64, 240)
	for i := range out {
		out[i] = math.Sin(float64(i)/freq+phase)*50 + 50
	}
	return out
}
func (s *state) graphics(p *ui.Container) {
	gap := s.panelGap()
	t := p.Theme()
	time := num(s.sample["time"])
	a, b, c := wave(time/3, 9), wave(time/3+2, 5), wave(time/2, 17)
	row(p, ui.Fr(1), 1, func(r *ui.Container) {
		r.Column(ui.ColumnOptions{Layout: ui.Layout{Gap: gap}}, func(left *ui.Container) {
			for i, title := range []string{"Braille (2×4 pixels per cell)", "Block elements", "ASCII fallback"} {
				left.Panel(ui.PanelOptions{Title: title}, func(p *ui.Container) {
					o := ui.PlotOptions{Min: ref(0.), Max: ref(100.)}
					switch i {
					case 0:
						o.Color = &t.Accent
						o.Grid = true
						o.Fill = ref(true)
					case 1:
						o.Mode = ui.FillBlock
						o.Colors = t.Heat
					case 2:
						o.Mode = ui.FillASCII
						o.Color = &t.Foreground
					}
					p.Graph(ui.GraphOptions{Values: a, Plot: o})
				})
			}
		})
		r.Column(ui.ColumnOptions{Layout: ui.Layout{Gap: gap}}, func(right *ui.Container) {
			right.Panel(ui.PanelOptions{Title: "Multi-series"}, func(p *ui.Container) {
				p.Graph(ui.GraphOptions{Series: []ui.Series{{Values: a, Color: &t.Primary, Label: "alpha"}, {Values: b, Color: &t.Success, Label: "beta"}, {Values: c, Color: &t.Secondary, Label: "gamma"}}, Axis: true, Legend: true, Plot: ui.PlotOptions{Min: ref(0.), Max: ref(100.)}})
			})
			right.Panel(ui.PanelOptions{Title: "Gradients"}, func(p *ui.Container) {
				p.Draw(func(surface ui.Surface) {
					steps := ui.GradientOf(t.Heat).Steps(surface.Width())
					for y := 0; y < surface.Height(); y++ {
						for x, color := range steps {
							surface.Glyph(x, y, '█', ui.Style{Fg: &color})
						}
					}
				})
			})
			right.Panel(ui.PanelOptions{Title: "Raw Braille canvas"}, func(p *ui.Container) {
				p.Canvas(&t.Accent, func(c *ui.BrailleCanvas, _ ui.Surface) {
					cx, cy := float64(c.Width)/2, float64(c.Height)/2
					radius := math.Min(cx, cy) - 2
					c.Circle(cx, cy, radius)
					for i := 0; i < 12; i++ {
						angle := float64(i)/12*math.Pi*2 + time/4
						c.Line(cx, cy, cx+math.Cos(angle)*radius, cy+math.Sin(angle)*radius*.9)
					}
				})
			})
		})
	})
}
func (s *state) themeScreen(p *ui.Container) {
	p.Label(fmt.Sprintf("Theme %d/9: %s   ←/→ or F2 to change", s.theme+1, p.Theme().Name))
	p.Spacer(ui.Cells(1))
	p.Grid(ui.GridOptions{ColumnCount: 3, RowCount: 3, Layout: ui.Layout{Gap: 1}}, func(g *ui.GridContainer) {
		for i, name := range themes {
			e := ui.ResolveTheme(name)
			border := e.Border
			if i == s.theme {
				border = e.BorderFocused
			}
			g.Panel(ui.PanelOptions{Title: e.Name, BorderColor: &border, Layout: ui.Layout{Background: &e.Background}}, ui.CellOptions{}, func(p *ui.Container) {
				row(p, ui.Cells(1), 1, func(r *ui.Container) {
					for i, label := range []string{"primary", "ok", "warn", "err"} {
						color := []ui.Color{e.Primary, e.Success, e.Warning, e.Danger}[i]
						r.Badge(ui.BadgeOptions{Text: label, Color: &color}, fixed([]int{10, 5, 7, 6}[i]))
					}
					r.Spacer(ui.Fill())
				})
				p.Meter(ui.MeterOptions{Value: .72, Label: "cpu", Background: &e.Background})
				p.Graph(ui.GraphOptions{Values: values(obj(s.sample["cpu"])["history"]), Plot: ui.PlotOptions{Min: ref(0.), Max: ref(100.), Fill: ref(true), Color: &e.Graph[0], Background: &e.Background}})
				p.Draw(func(surface ui.Surface) {
					for ci, color := range e.Graph {
						for x := 0; x < 3; x++ {
							surface.Glyph(ci*4+x, 0, '█', ui.Style{Fg: &color, Bg: &e.Background})
						}
					}
				}, fixed(1))
			})
		}
	})
}
func (s *state) inputScreen(p *ui.Container) {
	gap := s.panelGap()
	t := p.Theme()
	row(p, ui.Fr(1), gap, func(r *ui.Container) {
		r.Panel(ui.PanelOptions{Title: "Last Events"}, func(p *ui.Container) {
			keys(p, []ui.KeyValueRow{kv("Key", s.lastKey, t.Accent), kv("Mouse", s.lastMouse, t.Primary)}, true)
			p.Spacer(ui.Cells(1))
			p.Divider(ui.DividerOptions{Label: "history"})
			items := []ui.ListItem{}
			for i := len(s.keyLog) - 1; i >= max(0, len(s.keyLog)-20); i-- {
				items = append(items, ui.Item(scalar(s.keyLog[i])))
			}
			p.List(ui.ListOptions{Items: items}, ui.ScrollHandlers{})
		})
		r.Panel(ui.PanelOptions{Title: "Try it"}, func(p *ui.Container) {
			txt(p, "Press any key — modifiers are normalized.", t.Foreground)
			p.Label("Arrows, Function keys, Ctrl/Alt/Shift combinations,")
			p.Label("paste, focus, mouse move, click, drag and scroll.")
			p.Spacer(ui.Cells(1))
			p.Divider(ui.DividerOptions{Label: "focusable controls"})
			p.Spacer(ui.Cells(1))
			row(p, ui.Cells(1), 2, func(r *ui.Container) {
				r.Button(ui.ButtonOptions{Label: "Button A", Width: 12}, nil, fixed(12))
				r.Button(ui.ButtonOptions{Label: "Button B", Width: 12, Variant: ui.ButtonSuccess}, nil, fixed(12))
				r.Checkbox(ui.CheckboxOptions{Label: "Check", Checked: s.checked}, s.action(func() { s.checked = !s.checked }), fixed(12))
				r.Spacer(ui.Fill())
			})
			p.Spacer(ui.Cells(1))
			p.Label("Tab / Shift+Tab moves focus. Enter activates.")
			p.Spacer(ui.Fill())
			keys(p, []ui.KeyValueRow{ui.KV("Mouse tracking", "on"), ui.KV("Bracketed paste", "on"), ui.KV("Focus events", "on")}, true)
		})
	})
}
func (s *state) stress(p *ui.Container) {
	gap := s.panelGap()
	t := p.Theme()
	row(p, ui.Cells(3), gap, func(r *ui.Container) {
		for i, title := range []string{"Render", "Changed cells", "Bytes/frame", "FPS"} {
			r.Panel(ui.PanelOptions{Title: title}, func(p *ui.Container) {
				txt(p, []string{fmt.Sprintf("%.2f ms/frame", s.renderMs), fmt.Sprint(s.changedCells), fmt.Sprint(s.outputBytes), fmt.Sprintf("%.1f", s.fps)}[i], []ui.Color{t.Success, t.Warning, t.Primary, t.Accent}[i])
			})
		}
	})
	p.Panel(ui.PanelOptions{Title: "Full-screen churn"}, func(p *ui.Container) {
		p.Draw(func(surface ui.Surface) {
			ramp := ui.GradientOf(t.Graph)
			chars := []rune("▖▗▘▙▚▛▜▝▞▟█▓▒░")
			time := num(s.sample["time"])
			for y := 0; y < surface.Height(); y++ {
				for x := 0; x < surface.Width(); x++ {
					v := (math.Sin(float64(x)/6+time) + math.Cos(float64(y)/4-time)) / 2
					n := (v + 1) / 2
					color := ramp.Sample(n)
					surface.Glyph(x, y, chars[int(math.Floor(n*float64(len(chars)-1)))], ui.Style{Fg: &color})
				}
			}
		})
	})
}
