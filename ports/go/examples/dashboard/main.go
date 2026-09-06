// A live dashboard: `go run ./examples/dashboard`.
//
// Shows the shape a real Go app takes: the view and the handlers both close
// over the same state, which is exactly how the TypeScript reference reads.
package main

import (
	"fmt"
	"math"
	"time"

	ui "github.com/profullstack/hqtui"
)

type process struct {
	pid  int
	name string
	cpu  float64
}

func main() {
	var (
		cpu      []float64
		net      []float64
		selected = 0
		tab      = 0
		started  = time.Now()
	)
	tabs := []string{"cpu", "net", "procs"}
	procs := []process{
		{1, "systemd", 0.1},
		{412, "hqtui-demo", 12.5},
		{900, "go", 3.2},
		{1201, "compile", 41.8},
		{1888, "ssh", 0.4},
	}

	pushCapped := func(values []float64, v float64) []float64 {
		values = append(values, v)
		if len(values) > 400 {
			values = values[1:]
		}
		return values
	}

	app := ui.NewApp(ui.AppOptions{})

	// Handlers close over the same variables the view reads. No plumbing.
	app.OnKey(func(e ui.InputEvent) {
		switch e.Name {
		case "down":
			selected = min(selected+1, len(procs)-1)
		case "up":
			selected = max(selected-1, 0)
		case "left":
			tab = max(tab-1, 0)
		case "right":
			tab = min(tab+1, len(tabs)-1)
		}
	})

	app.Render(func(f ui.RenderArgs) {
		t := time.Since(started).Seconds()
		cpu = pushCapped(cpu, math.Sin(t*1.7)*0.3+math.Cos(t*0.4)*0.2+0.5)
		net = pushCapped(net, (math.Sin(t*0.9)*0.5+0.5)*90)

		cpuNow, netNow := 0.0, 0.0
		if len(cpu) > 0 {
			cpuNow = cpu[len(cpu)-1]
		}
		if len(net) > 0 {
			netNow = net[len(net)-1]
		}

		one := ui.Cells(1)
		f.UI.Row(ui.RowOptions{Layout: ui.Layout{Size: &one}}, func(r *ui.Container) {
			r.Heading("hqtui — go")
			r.Spacer(ui.Fill())
			r.Badge(ui.BadgeOptions{Text: "LIVE"})
		})
		f.UI.Tabs(ui.TabsOptions{Tabs: tabs, Active: tab}, func(i int) { tab = i })

		f.UI.Grid(ui.GridOptions{
			Layout:  ui.Layout{Gap: 1},
			Columns: []ui.Size{ui.Fr(1), ui.Fr(1)},
			Rows:    []ui.Size{ui.Fr(1)},
		}, func(g *ui.GridContainer) {
			g.Panel(ui.PanelOptions{Title: "Load"}, ui.CellOptions{}, func(p *ui.Container) {
				p.Meter(ui.MeterOptions{Value: cpuNow, Label: "cpu"})
				p.Sparkline(ui.SparklineWidgetOptions{
					Values: net, Label: "net", Text: fmt.Sprintf("%.0fM", netNow),
				})
				scaled := make([]float64, len(cpu))
				for i, v := range cpu {
					scaled[i] = v * 100
				}
				fill := true
				p.Graph(ui.GraphOptions{
					Series: []ui.Series{
						{Values: scaled, Label: "cpu"},
						{Values: net, Label: "net"},
					},
					Axis: true, Legend: true,
					Plot: ui.PlotOptions{Fill: &fill},
				})
			})
			g.Panel(ui.PanelOptions{Title: "Processes"}, ui.CellOptions{}, func(p *ui.Container) {
				rows := make([]ui.TableRow, len(procs))
				for i, pr := range procs {
					rows[i] = ui.Row(fmt.Sprint(pr.pid), pr.name, fmt.Sprintf("%.1f", pr.cpu))
				}
				p.Table(ui.TableOptions{
					Rows: rows,
					Columns: []ui.TableColumn{
						ui.Col("PID").Right(), ui.Col("NAME"), ui.Col("CPU%").Right(),
					},
					Selected:        &selected,
					FollowSelection: true,
					Zebra:           true,
					Scrollbar:       true,
				}, ui.ScrollHandlers{
					// The wheel and a click both act on whatever is under the
					// pointer, which is what the hit region is for.
					OnScroll:    func(d int) { selected = clamp(selected+d, 0, len(procs)-1) },
					OnSelectRow: func(row int) { selected = clamp(row, 0, len(procs)-1) },
				})
			})
		})

		f.UI.StatusBar(ui.StatusBarOptions{
			Items: []ui.StatusItem{
				ui.StatusKey("q", "quit"),
				ui.StatusKey("↑↓", "select"),
				ui.StatusKey("←→", "tab"),
			},
			Right: []ui.StatusItem{ui.Status(fmt.Sprintf("%dx%d", f.Width, f.Height))},
		})
	})

	// Redraw on a timer as well as on input: the graphs are animated.
	go func() {
		for range time.Tick(50 * time.Millisecond) {
			app.Invalidate()
		}
	}()

	app.Start()
}

func clamp(v, lo, hi int) int { return max(lo, min(v, hi)) }
