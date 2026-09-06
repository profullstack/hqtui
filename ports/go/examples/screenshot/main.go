// Renders a dashboard headlessly and prints it, so the whole stack can be
// exercised without a TTY: `go run ./examples/screenshot`.
//
// Add --ansi for the colored form, or --html for a standalone page.
package main

import (
	"fmt"
	"math"
	"os"

	ui "github.com/profullstack/hqtui/ports/go"
)

func main() {
	arg := ""
	if len(os.Args) > 1 {
		arg = os.Args[1]
	}

	cpu := make([]float64, 120)
	net := make([]float64, 120)
	for i := range cpu {
		cpu[i] = math.Sin(float64(i)/9)*35 + 55
		net[i] = math.Cos(float64(i)/5)*25 + 40
	}

	screen := ui.RenderToScreen(84, 22, "dark", func(root *ui.Container) {
		one := ui.Cells(1)
		root.Row(ui.RowOptions{Layout: ui.Layout{Size: &one}}, func(r *ui.Container) {
			r.Heading("hqtui — go port")
			r.Spacer(ui.Fill())
			r.Badge(ui.BadgeOptions{Text: "LIVE"})
		})
		root.Grid(ui.GridOptions{
			Layout:  ui.Layout{Gap: 1},
			Columns: []ui.Size{ui.Fr(2), ui.Fr(1)},
			Rows:    []ui.Size{ui.Cells(11), ui.Fr(1)},
		}, func(g *ui.GridContainer) {
			g.Panel(ui.PanelOptions{Title: "Throughput", Subtitle: "60s"}, ui.CellOptions{},
				func(p *ui.Container) {
					fill := true
					p.Graph(ui.GraphOptions{
						Series: []ui.Series{
							{Values: cpu, Label: "cpu"},
							{Values: net, Label: "net"},
						},
						Axis: true, Legend: true,
						Plot: ui.PlotOptions{Fill: &fill},
					})
				})
			g.Panel(ui.PanelOptions{Title: "Cores"}, ui.CellOptions{}, func(p *ui.Container) {
				items := make([]ui.MeterItem, 8)
				for i := range items {
					items[i] = ui.Meter(fmt.Sprintf("c%d", i), 0.15+float64(i)*0.11)
				}
				p.Meters(ui.MetersOptions{Items: items})
			})
			g.Panel(ui.PanelOptions{Title: "Processes"}, ui.CellOptions{ColSpan: 2},
				func(p *ui.Container) {
					p.Table(ui.TableOptions{
						Rows: []ui.TableRow{
							ui.Row("1", "systemd", "0.1", "12M"),
							ui.Row("412", "hqtui", "12.5", "48M"),
							ui.Row("1201", "compile", "41.8", "1.2G"),
						},
						Columns: []ui.TableColumn{
							ui.Col("PID").Right(), ui.Col("NAME"),
							ui.Col("CPU%").Right(), ui.Col("MEM").Right(),
						},
						Selected: ptr(1),
						Zebra:    true,
					}, ui.ScrollHandlers{})
				})
		})
		root.StatusBar(ui.StatusBarOptions{
			Items: []ui.StatusItem{ui.StatusKey("q", "quit"), ui.StatusKey("↑↓", "select")},
			Right: []ui.StatusItem{ui.Status("30fps")},
		})
	})

	switch arg {
	case "--ansi":
		fmt.Println(screen.ANSI())
	case "--html":
		fmt.Println(ui.RenderToHTML(screen, ui.HTMLOptions{}))
	default:
		fmt.Println(screen.Text())
	}
}

func ptr(n int) *int { return &n }
