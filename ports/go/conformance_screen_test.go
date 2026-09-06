package hqtui

// End to end: the builder driving whole screens, compared against what the
// TypeScript reference's builder produced for the same layout.
//
// This is the test that would catch a layout solver that is subtly off, or a
// panel whose interior padding drifted — neither of which shows up when a
// widget is drawn onto a surface someone else sized.

import "testing"

var screenSeries = []float64{12, 40, 33, 71, 25, 60, 48, 19, 55, 80, 35, 62, 44, 28, 70, 51}

func buildScreen(t *testing.T, name string, ui *Container) {
	values := func() []float64 { return append([]float64(nil), screenSeries...) }
	switch name {
	case "hello":
		ui.Panel(PanelOptions{Title: "Hello"}, func(p *Container) {
			p.Text("Hello, terminal.")
		})
	case "rows-and-columns":
		ui.Row(RowOptions{Layout: Layout{Gap: 1}}, func(row *Container) {
			row.Panel(PanelOptions{Title: "L"}, func(p *Container) { p.Text("left") })
			fr := Fr(1)
			row.Panel(PanelOptions{Title: "R", Layout: Layout{Size: &fr}},
				func(p *Container) { p.Text("right") })
		})
	case "grid":
		ui.Grid(GridOptions{
			Layout:  Layout{Gap: 1},
			Columns: []Size{Fr(2), Fr(1)},
			Rows:    []Size{Cells(6), Fr(1)},
		}, func(g *GridContainer) {
			g.Panel(PanelOptions{Title: "CPU"}, CellOptions{}, func(p *Container) {
				p.Meter(MeterOptions{Value: 0.62, Label: "all"})
			})
			g.Panel(PanelOptions{Title: "MEM"}, CellOptions{}, func(p *Container) {
				p.Meter(MeterOptions{Value: 0.31, Label: "used"})
			})
			g.Panel(PanelOptions{Title: "NET"}, CellOptions{ColSpan: 2}, func(p *Container) {
				p.Graph(GraphOptions{Values: values()})
			})
		})
	case "grid-span-overflow":
		ui.Grid(GridOptions{ColumnCount: 1, RowCount: 2}, func(g *GridContainer) {
			g.Panel(PanelOptions{Title: "wide"}, CellOptions{ColSpan: 2},
				func(p *Container) { p.Text("spans") })
			g.Panel(PanelOptions{Title: "next"}, CellOptions{},
				func(p *Container) { p.Text("after") })
		})
	case "dashboard":
		one := Cells(1)
		ui.Row(RowOptions{Layout: Layout{Size: &one}}, func(r *Container) {
			r.Heading("hqtui")
			r.Spacer(Fill())
			r.Badge(BadgeOptions{Text: "LIVE"})
		})
		ui.Grid(GridOptions{
			Layout: Layout{Gap: 1}, Columns: []Size{Fr(1), Fr(1)}, Rows: []Size{Fr(1)},
		}, func(g *GridContainer) {
			g.Panel(PanelOptions{Title: "Load"}, CellOptions{}, func(p *Container) {
				p.Meters(MetersOptions{Items: []MeterItem{Meter("c0", 0.2), Meter("c1", 0.7)}})
				p.Graph(GraphOptions{Values: values(), Axis: true})
			})
			g.Panel(PanelOptions{Title: "Procs"}, CellOptions{}, func(p *Container) {
				p.Table(TableOptions{
					Rows:     []TableRow{Row("1", "init"), Row("42", "node")},
					Columns:  []TableColumn{Col("PID").Right(), Col("CMD")},
					Selected: optIntValue(0),
				}, ScrollHandlers{})
			})
		})
		ui.StatusBar(StatusBarOptions{Items: []StatusItem{StatusKey("q", "quit")}})
	case "themed-nord", "themed-light":
		title := "Nord"
		if name == "themed-light" {
			title = "Light"
		}
		ui.Panel(PanelOptions{Title: title}, func(p *Container) {
			p.Meter(MeterOptions{Value: 0.5, Label: "x"})
		})
	case "responsive-narrow":
		ui.Responsive(map[int]func(*Container){
			60: func(u *Container) { u.Text("wide") },
			0:  func(u *Container) { u.Text("narrow") },
		})
	case "overlays":
		ui.Panel(PanelOptions{Title: "Behind"}, func(p *Container) { p.Text("content") })
		ui.Modal(ModalOptions{
			Title: "Modal", Message: "Are you sure?",
			Buttons: []ModalButton{{Label: "OK", Focused: true}},
		}, nil)
	case "unicode-content":
		ui.Panel(PanelOptions{Title: "日本語"}, func(p *Container) {
			p.Text("こんにちは 世界")
			p.Text("🚀 emoji ok")
		})
	default:
		t.Fatalf("no Go scene for screen fixture %q", name)
	}
}

func TestScreensMatchReference(t *testing.T) {
	cases := arr(fixture(t, "screen"))
	if len(cases) == 0 {
		t.Fatal("no screen fixtures loaded")
	}
	cells := 0
	for _, c := range cases {
		name := str(get(c, "name"))
		width, height := i(get(c, "width")), i(get(c, "height"))
		cells += width * height
		screen := RenderToScreen(width, height, str(get(c, "theme")), func(ui *Container) {
			buildScreen(t, name, ui)
		})
		assertBuffer(t, screen.Buffer, get(c, "result"), name)
	}
	t.Logf("%d screen scenes, %d cells compared", len(cases), cells)
}
