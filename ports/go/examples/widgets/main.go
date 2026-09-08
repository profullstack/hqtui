// Every widget HQTUI ships, one function each, in Go.
//
// `go run ./examples/widgets` renders all of them headlessly and prints the
// result, so the file is a program rather than a snippet dump. The
// `@widget` / `@end` markers are what hqtui.com/widgets slices to show the
// code for one widget, which is why a snippet on the site is always a region
// of something that compiles.
//
// Keep each function self-contained: it takes a container and nothing else.
package main

import (
	"fmt"
	"os"

	hqtui "github.com/profullstack/hqtui/ports/go"
)

func cpuHistory() []float64 {
	return []float64{12, 18, 26, 22, 31, 44, 38, 52, 61, 48, 39, 44, 57, 66, 72, 64, 51, 43, 37, 41}
}

func netHistory() []float64 {
	return []float64{4, 9, 6, 14, 22, 18, 31, 27, 19, 12, 8, 15, 24, 33, 29, 21}
}

// at returns a pointer to n. Optional fields are pointers so that "not set"
// and "set to zero" stay different things.
func at(n int) *int { return &n }

func f64(f float64) *float64 { return &f }

// ------------------------------------------------------------------- text

// @widget text
func Text(ui *hqtui.Container) {
	ui.Text("Plain text. It fills the width it is given.")
	ui.StyledText("Bold, in the theme's primary color.", hqtui.TextStyle{Bold: true})
	ui.StyledText("Right aligned.", hqtui.TextStyle{Align: hqtui.AlignRight})
	ui.StyledText(
		"Long copy wraps when you ask it to, instead of being cut at the edge.",
		hqtui.TextStyle{Wrap: true},
	)
}

// @end

// @widget label
func Label(ui *hqtui.Container) {
	// Label is Text in the theme's muted color: secondary copy, captions,
	// the line under a number that says what the number is.
	ui.Label("cpu · 8 cores · 3.4 GHz")
	ui.StyledText("42.1%", hqtui.TextStyle{Bold: true})
	ui.Label("15 minute average")
}

// @end

// @widget heading
func Heading(ui *hqtui.Container) {
	// Heading is Text in the theme's title color, bold.
	ui.Heading("Storage")
	ui.Label("Four volumes, one degraded")
	ui.Spacer(hqtui.Cells(1))
	ui.Heading("Network")
}

// @end

// @widget badge
func Badge(ui *hqtui.Container) {
	ui.Row(hqtui.RowOptions{Layout: hqtui.Layout{Size: size(hqtui.Cells(1)), Gap: 1}}, func(r *hqtui.Container) {
		r.Badge(hqtui.BadgeOptions{Text: "active"})
		r.Badge(hqtui.BadgeOptions{Text: "idle", Variant: hqtui.BadgeSubtle})
		r.Badge(hqtui.BadgeOptions{Text: "failed", Variant: hqtui.BadgeOutline})
		r.Spacer(hqtui.Fill())
	})
}

// @end

// @widget divider
func Divider(ui *hqtui.Container) {
	ui.Text("Above the line")
	ui.Divider(hqtui.DividerOptions{})
	ui.Text("Below it")
	ui.Divider(hqtui.DividerOptions{Label: "status", Align: hqtui.AlignCenter})
	ui.Text("A labelled divider titles a section without spending a panel on it")
}

// @end

// @widget keyValues
func KeyValues(ui *hqtui.Container) {
	// The backbone of every "System" panel: labels left, values right.
	ui.KeyValues(hqtui.KeyValueOptions{Rows: []hqtui.KeyValueRow{
		hqtui.KV("Host", "web-01.iad"),
		hqtui.KV("Uptime", "18d 04:12"),
		hqtui.KV("Load", "0.42  0.51  0.60"),
		hqtui.KV("Established", "1,284"),
	}})
}

// @end

// @widget statusBar
func StatusBar(ui *hqtui.Container) {
	// Usually the last thing drawn, pinned to the bottom row.
	ui.StatusBar(hqtui.StatusBarOptions{
		Items: []hqtui.StatusItem{
			hqtui.StatusKey("F1", "Help"),
			hqtui.StatusKey("F2", "Theme"),
			hqtui.StatusKey("F3", "Filter"),
			hqtui.StatusKey("^K", "Palette"),
			hqtui.StatusKey("q", "Quit"),
		},
		Right: []hqtui.StatusItem{hqtui.Status("0.41ms  184 cells")},
	})
}

// @end

// ------------------------------------------------------------------- data

// @widget table
func Table(ui *hqtui.Container) {
	ui.Table(hqtui.TableOptions{
		Rows: []hqtui.TableRow{
			hqtui.Row("src", "4.2 KB", "dir", "2m ago"),
			hqtui.Row("test", "1.1 KB", "dir", "5m ago"),
			hqtui.Row("package.json", "1.2 KB", "file", "10m ago"),
			hqtui.Row("README.md", "3.4 KB", "file", "1h ago"),
		},
		Columns: []hqtui.TableColumn{
			hqtui.Col("Name"),
			hqtui.Col("Size").Right(),
			hqtui.Col("Type"),
			hqtui.Col("Modified").Right(),
		},
		Selected: at(1),
		Zebra:    true,
	}, hqtui.ScrollHandlers{})
}

// @end

// @widget list
func List(ui *hqtui.Container) {
	ui.List(hqtui.ListOptions{
		Items:     hqtui.Items("apps/demo", "packages/hqtui", "apps/web", "docs"),
		Selected:  at(0),
		Bullet:    "▸",
		Scrollbar: true,
	}, hqtui.ScrollHandlers{})
}

// @end

// @widget tree
func Tree(ui *hqtui.Container) {
	ui.Tree(hqtui.TreeOptions{
		Nodes: []hqtui.TreeNode{
			hqtui.Node("systemd",
				hqtui.Node("bash"),
				hqtui.Node("bun", hqtui.Node("bun:worker")),
				hqtui.Node("postgres"),
			),
		},
		Selected: at(2),
	}, hqtui.ScrollHandlers{})
}

// @end

// @widget log
func Log(ui *hqtui.Container) {
	ui.Log(hqtui.LogOptions{
		Entries: []hqtui.LogEntry{
			hqtui.Log("listening on :8080").At("12:45:02").Levelled("INFO"),
			hqtui.Log("slow query 412ms").At("12:45:09").Levelled("WARN").WithMeta("table=users"),
			hqtui.Log("upstream timeout").At("12:45:11").Levelled("ERROR"),
			hqtui.Log("retry succeeded").At("12:45:14").Levelled("INFO"),
		},
		Scrollbar: true,
	}, hqtui.ScrollHandlers{})
}

// @end

// ----------------------------------------------------------------- meters

// @widget scrollbar
func Scrollbar(ui *hqtui.Container) {
	// The bar is over state you own, so it works beside anything that scrolls:
	// wrapped prose, a canvas, a Draw of your own.
	ui.Row(hqtui.RowOptions{Layout: hqtui.Layout{Gap: 1}}, func(r *hqtui.Container) {
		r.StyledText(
			"A scrollbar you drive yourself. It has no idea what is beside it, only how much there is, how much fits, and where you are.",
			hqtui.TextStyle{Wrap: true},
		)
		r.Scrollbar(hqtui.ScrollbarOptions{Total: 40, Viewport: 5, Offset: 12}, hqtui.ScrollHandlers{})
	})
}

// @end

// @widget chart
func Chart(ui *hqtui.Container) {
	// Points carry their own x, so a sparse series and a dense one line up.
	zero, ten, seven := 0.0, 10.0, 3
	ui.Chart(hqtui.ChartOptions{
		Series: []hqtui.ChartSeries{
			{Points: []hqtui.Point{{X: 0, Y: 1}, {X: 2, Y: 6}, {X: 5, Y: 3}, {X: 8, Y: 9}, {X: 10, Y: 4}}, Label: "load"},
			{Points: []hqtui.Point{{X: 0, Y: 8}, {X: 10, Y: 2}}, Label: "limit"},
		},
		Axis:   true,
		Legend: true,
		Plot: hqtui.ChartPlotOptions{
			X: &hqtui.AxisOptions{Min: &zero, Max: &ten, Ticks: seven},
			Y: &hqtui.AxisOptions{Min: &zero, Max: &ten},
		},
	})
}

// @end

// @widget calendar
func Calendar(ui *hqtui.Container) {
	// The dates are arithmetic, not a host calendar: every port has a different
	// date type and none of them is consulted.
	eighth := 8
	ui.Calendar(hqtui.CalendarOptions{
		Year: 2026, Month: 9, Selected: &eighth,
		Marks: []hqtui.CalendarMark{{Day: 15}, {Day: 22, Bold: true}},
	})
}

// @end

// @widget meter
func Meter(ui *hqtui.Container) {
	ui.Meter(hqtui.MeterOptions{Value: 0.62, Label: "CPU"})
	ui.Meter(hqtui.MeterOptions{Value: 0.31, Label: "MEM", Style: hqtui.BarSegmented})
	ui.Meter(hqtui.MeterOptions{Value: 0.87, Label: "SWP"})
}

// @end

// @widget meters
func Meters(ui *hqtui.Container) {
	// One call for a whole bank. Columns lays them out side by side.
	ui.Meters(hqtui.MetersOptions{
		Items: []hqtui.MeterItem{
			hqtui.Meter("P0", 0.12), hqtui.Meter("P1", 0.44),
			hqtui.Meter("P2", 0.71), hqtui.Meter("P3", 0.09),
			hqtui.Meter("P4", 0.38), hqtui.Meter("P5", 0.55),
			hqtui.Meter("P6", 0.22), hqtui.Meter("P7", 0.66),
		},
		Columns: 2,
		Style:   hqtui.BarSegmented,
	})
}

// @end

// @widget progress
func Progress(ui *hqtui.Container) {
	ui.Progress(hqtui.ProgressOptions{
		Value: 37, Max: f64(120), Label: "Indexing", ShowCount: true,
	})
	ui.Progress(hqtui.ProgressOptions{Value: 0.82, Label: "Upload"})
}

// @end

// @widget graph
func Graph(ui *hqtui.Container) {
	// Braille line chart. Fill shades the area under the curve.
	ui.Graph(hqtui.GraphOptions{
		Series: []hqtui.Series{{Values: cpuHistory(), Label: "cpu", Fill: ptrBool(true)}},
		Plot:   hqtui.PlotOptions{Min: f64(0), Max: f64(100)},
	})
}

// @end

// @widget sparkline
func Sparkline(ui *hqtui.Container) {
	ui.Sparkline(hqtui.SparklineWidgetOptions{Values: cpuHistory(), Label: "CPU ", Text: "44%"})
	ui.Sparkline(hqtui.SparklineWidgetOptions{Values: netHistory(), Label: "Net ", Text: "2.4 MB/s"})
}

// @end

// @widget histogram
func Histogram(ui *hqtui.Container) {
	// Block columns. Cheaper than Braille and easier to read when short.
	ui.Histogram(hqtui.ColumnsOptions{Values: cpuHistory()})
}

// @end

// @widget heatBar
func HeatBar(ui *hqtui.Container) {
	// Segmented bar colored along the theme's heat ramp, like btop's temperatures.
	ui.HeatBar(hqtui.HeatBarOptions{Value: 0.28})
	ui.HeatBar(hqtui.HeatBarOptions{Value: 0.64})
	ui.HeatBar(hqtui.HeatBarOptions{Value: 0.91})
}

// @end

// @widget gauge
func Gauge(ui *hqtui.Container) {
	// A semicircular dial. Wants at least nine columns by five rows.
	ui.Gauge(hqtui.GaugeOptions{Value: 0.62, Label: "62%"})
}

// @end

// @widget donut
func Donut(ui *hqtui.Container) {
	ui.Donut(hqtui.DonutOptions{Segments: []hqtui.DonutSegment{
		{Value: 4.65, Label: "Used"},
		{Value: 10.96, Label: "Free"},
	}})
}

// @end

// ----------------------------------------------------------------- inputs

// @widget button
func Button(ui *hqtui.Container) {
	// Pass an onPress func and the button joins the Tab order automatically.
	ui.Row(hqtui.RowOptions{Layout: hqtui.Layout{Size: size(hqtui.Cells(1)), Gap: 1}}, func(r *hqtui.Container) {
		r.Button(hqtui.ButtonOptions{Label: "Primary"}, func() {})
		r.Button(hqtui.ButtonOptions{Label: "Success", Variant: hqtui.ButtonSuccess}, nil)
		r.Button(hqtui.ButtonOptions{Label: "Danger", Variant: hqtui.ButtonDanger}, nil)
		r.Spacer(hqtui.Fill())
	})
}

// @end

// @widget checkbox
func Checkbox(ui *hqtui.Container) {
	ui.Row(hqtui.RowOptions{Layout: hqtui.Layout{Size: size(hqtui.Cells(1)), Gap: 2}}, func(r *hqtui.Container) {
		r.Checkbox(hqtui.CheckboxOptions{
			Label: "Toggle", Checked: true, Variant: hqtui.CheckboxToggle,
		}, nil)
		r.Checkbox(hqtui.CheckboxOptions{Label: "Checkbox"}, nil)
		r.Spacer(hqtui.Fill())
	})
}

// @end

// @widget select
func Select(ui *hqtui.Container) {
	ui.Select(hqtui.SelectOptions{
		Value:         "Dracula",
		Open:          true,
		Options:       []string{"Dark", "Dracula", "Nord", "Tokyo Night"},
		SelectedIndex: 1,
	}, nil)
}

// @end

// @widget textInput
func TextInput(ui *hqtui.Container) {
	ui.TextInput(hqtui.TextInputOptions{Label: "Search", Value: "postgres"})
	ui.Spacer(hqtui.Cells(1))
	ui.TextInput(hqtui.TextInputOptions{Label: "Filter", Placeholder: "type to filter…"})
}

// @end

// @widget tabs
func Tabs(ui *hqtui.Container) {
	ui.Tabs(hqtui.TabsOptions{
		Tabs:   []string{"1 dashboard", "2 traffic", "3 sessions", "4 network"},
		Active: 1,
	}, nil)
}

// @end

// ---------------------------------------------------------------- overlays

// @widget modal
func Modal(ui *hqtui.Container) {
	// Overlays draw over everything already on the screen, centered.
	ui.Modal(hqtui.ModalOptions{
		Title:   "Confirm Action",
		Message: "Terminate process 4821 (postgres)?\n\nThis cannot be undone.",
		Buttons: []hqtui.ModalButton{
			{Label: "Yes", Focused: true},
			{Label: "No", Variant: hqtui.ButtonGhost},
		},
	}, nil)
}

// @end

// @widget commandPalette
func CommandPalette(ui *hqtui.Container) {
	ui.CommandPalette(hqtui.CommandPaletteOptions{
		Query: "the",
		Items: []hqtui.PaletteItem{
			{Label: "Toggle theme", Hint: "F2"},
			{Label: "Filter processes", Hint: "F3"},
			{Label: "Sort by memory", Hint: "F6"},
		},
	})
}

// @end

// @widget tooltip
func Tooltip(ui *hqtui.Container) {
	ui.Text("Tooltips are overlays positioned at a cell, for hover and hints.")
	ui.Tooltip(hqtui.TooltipOptions{Text: "swap is 87% full", X: 6, Y: 3})
}

// @end

func ptrBool(b bool) *bool { return &b }

func size(s hqtui.Size) *hqtui.Size { return &s }

// Renders each widget on its own small screen and prints the lot.
func main() {
	examples := []struct {
		name string
		draw func(*hqtui.Container)
	}{
		{"text", Text}, {"label", Label}, {"heading", Heading}, {"badge", Badge},
		{"divider", Divider}, {"keyValues", KeyValues}, {"statusBar", StatusBar},
		{"table", Table}, {"list", List}, {"tree", Tree}, {"log", Log},
		{"scrollbar", Scrollbar}, {"chart", Chart}, {"calendar", Calendar},
		{"meter", Meter}, {"meters", Meters}, {"progress", Progress}, {"graph", Graph},
		{"sparkline", Sparkline}, {"histogram", Histogram}, {"heatBar", HeatBar},
		{"gauge", Gauge}, {"donut", Donut},
		{"button", Button}, {"checkbox", Checkbox}, {"select", Select},
		{"textInput", TextInput}, {"tabs", Tabs},
		{"modal", Modal}, {"commandPalette", CommandPalette}, {"tooltip", Tooltip},
	}

	blank := 0
	for _, e := range examples {
		out := hqtui.RenderToText(62, 12, "dark", e.draw)
		if len(trim(out)) == 0 {
			fmt.Fprintf(os.Stderr, "FAIL %s: rendered an empty screen\n", e.name)
			blank++
			continue
		}
		fmt.Printf("--- %s\n%s\n", e.name, out)
	}

	fmt.Fprintf(os.Stderr, "%d/%d widget examples rendered\n", len(examples)-blank, len(examples))
	if blank > 0 {
		os.Exit(1)
	}
}

func trim(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\n') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\n') {
		end--
	}
	return s[start:end]
}
