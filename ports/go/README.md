# hqtui — Go

High Quality Terminal UI for Go. btop-grade dashboards with a one-import API,
dark by default, **standard library only** — no `golang.org/x/...`, nothing in
`go.sum`.

This is a native port of [the TypeScript reference
implementation](https://hqtui.com), not a binding. There is no Node in the
picture at runtime or at build time.

```bash
go get github.com/profullstack/hqtui/ports/go
```

## Hello, terminal

```go
package main

import "github.com/profullstack/hqtui/ports/go"

func main() {
	app := hqtui.NewApp(hqtui.AppOptions{})
	app.Render(func(f hqtui.RenderArgs) {
		f.UI.Panel(hqtui.PanelOptions{Title: "Hello"}, func(p *hqtui.Container) {
			p.Text("Hello, terminal.")
		})
	})
	app.Start()
}
```

`NewApp` already gives you a dark theme, truecolor with automatic 256/16
fallback, mouse tracking, the alternate screen, resize handling, 30fps adaptive
rendering (15 over SSH), and a terminal that is restored however the process
dies.

## Handlers close over your state

Go keeps the reference implementation's shape, because Go closures capture by
reference and the runtime has a garbage collector. The Rust port has to invert
this; Go does not:

```go
selected := 0

app.OnKey(func(e hqtui.InputEvent) {
	switch e.Name {
	case "down": selected++
	case "up":   selected--
	}
})

app.Render(func(f hqtui.RenderArgs) {
	f.UI.Table(hqtui.TableOptions{
		Rows:     []hqtui.TableRow{hqtui.Row("1", "systemd")},
		Columns:  []hqtui.TableColumn{hqtui.Col("PID"), hqtui.Col("NAME")},
		Selected: &selected,
	}, hqtui.ScrollHandlers{
		// The wheel acts on whatever is under the pointer.
		OnScroll:    func(d int) { selected += d },
		OnSelectRow: func(row int) { selected = row },
	})
})
```

Run the examples to see it working:

```bash
go run ./examples/hello        # the smallest app
go run ./examples/dashboard    # full native ten-screen demo
go run ./examples/dashboard --sim  # generated sample telemetry
go run ./examples/dashboard-mini   # small library example
go run ./examples/screenshot   # renders to stdout, no TTY needed
```

## Testing without a terminal

```go
screen := hqtui.RenderToScreen(80, 24, "dark", func(ui *hqtui.Container) {
	ui.Panel(hqtui.PanelOptions{Title: "CPU"}, func(p *hqtui.Container) {
		p.Text("72%")
	})
})
if !screen.Contains("72%") {
	t.Error("missing")
}
```

`RenderToScreen` also gives you `.ANSI()` for a colored screenshot,
`.Cell(x, y)` for structural assertions, and `.Regions` so a test can prove a
widget is actually reachable by a click.

## How this stays honest

Every port replays a shared corpus of fixtures generated from the TypeScript
implementation: the same widget arguments must produce the same cells, the same
colors and the same escape bytes.

```bash
go test ./...          # 12 conformance groups, ~9k reference cells
```

That covers colors and all 256 palette quantizations, Unicode widths and
grapheme clustering, the layout solver, the framebuffer, the diff encoder's
exact output bytes, Braille rasterisation, every border style, all 53 widget
scenes and 10 whole-screen layouts.

## Where this differs from the reference, and why

Two places, both documented in the source at the point they matter:

**Optional values are pointers.** The reference relies on `undefined` meaning
"use the default", and a Go zero value cannot say that — `Gap: 0` is a
legitimate gap, so `Gap` is a `*int`. Where the zero value genuinely cannot be
meaningful (a zero `Width`, an empty `Title`) it is a plain field. Booleans
that default to *on* are inverted rather than pointered, which is why you will
see `NoHeader` and `NoFollow`.

**Tables take strings.** The reference is generic over a row type and reads
cells by key. `Row("1", "systemd")` keeps the widget free of reflection and puts
formatting where the data lives.

Everything else — layout, widgets, colors, glyph selection, escape output — is
identical, and the conformance suite is what says so.

## Terminal handling

Raw mode goes through `syscall.Termios` directly, because Go's standard library
already declares that struct and its flag constants correctly for every
platform it supports. Only the two ioctl request numbers differ between Linux
and the BSDs, and those live in `tty_linux.go` and `tty_bsd.go`.

That is a real advantage over the Rust port, which cannot see a correct
`termios` without a dependency and shells out to `stty` instead.

`SIGWINCH` handling uses `os/signal`. Windows has no POSIX terminal layer here,
so the interactive `App` does not run there — but everything above it (the
framebuffer, widgets, encoder and headless renderer) is pure computation and
works fine.

## License

MIT.
