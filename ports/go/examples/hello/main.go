// The smallest real app: `go run ./examples/hello`. Press q to quit.
package main

import "github.com/profullstack/hqtui"

func main() {
	app := hqtui.NewApp(hqtui.AppOptions{})
	app.Render(func(f hqtui.RenderArgs) {
		f.UI.Panel(hqtui.PanelOptions{Title: "Hello"}, func(p *hqtui.Container) {
			p.Text("Hello, terminal.")
			p.Label("Press q to quit.")
		})
	})
	app.Start()
}
