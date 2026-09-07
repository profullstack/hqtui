// Collapsed borders in Go: `go run ./examples/collapse`.
//
// The same scene as examples/collapse.ts in the TypeScript reference and
// ports/rust/examples/collapse.rs, so the three outputs can be diffed. They are
// expected to be byte for byte the same, which is what keeps the ports honest.
package main

import (
	"fmt"

	hqtui "github.com/profullstack/hqtui/ports/go"
)

func size(s hqtui.Size) *hqtui.Size { return &s }

func view(ui *hqtui.Container) {
	ui.Row(hqtui.RowOptions{Layout: hqtui.Layout{Size: size(hqtui.Cells(5))}}, func(row *hqtui.Container) {
		row.Panel(hqtui.PanelOptions{Title: "CPU"}, func(p *hqtui.Container) {
			p.Meter(hqtui.MeterOptions{Value: 0.62, Label: "all"})
		})
		row.Panel(hqtui.PanelOptions{Title: "Memory"}, func(p *hqtui.Container) {
			p.Meter(hqtui.MeterOptions{Value: 0.31, Label: "used"})
		})
		row.Panel(hqtui.PanelOptions{Title: "Disk"}, func(p *hqtui.Container) {
			p.Meter(hqtui.MeterOptions{Value: 0.87, Label: "root"})
		})
	})
	ui.Row(hqtui.RowOptions{Layout: hqtui.Layout{Size: size(hqtui.Cells(4))}}, func(row *hqtui.Container) {
		row.Panel(hqtui.PanelOptions{Title: "Network"}, func(p *hqtui.Container) {
			p.Sparkline(hqtui.SparklineWidgetOptions{
				Values: []float64{3, 7, 2, 9, 4, 8, 6}, Label: "rx ",
			})
		})
		row.Panel(hqtui.PanelOptions{Title: "Errors"}, func(p *hqtui.Container) {
			p.Text("none")
		})
	})
}

func main() {
	fmt.Println("--- default ---")
	fmt.Println(hqtui.RenderToText(60, 9, "dark", view))
	fmt.Println("--- collapsed ---")
	fmt.Println(hqtui.RenderCollapsedToText(60, 9, "dark", view))
}
