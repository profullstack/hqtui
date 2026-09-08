package hqtui

// Every widget, drawn with the same arguments the fixture generator used, and
// compared cell for cell against what the TypeScript reference produced.
//
// The scenes are matched by name rather than driven by data: the arguments are
// typed structs here and object literals there, and spelling them out in both
// is what makes a drifted default visible instead of silently shared.

import (
	"fmt"
	"math"
	"testing"
)

var widgetSeries = []float64{3, 7, 2, 9, 4, 8, 6, 1, 5, 9, 3, 7, 8, 2, 6, 4, 9, 1, 5, 7}

func series() []float64 { return append([]float64(nil), widgetSeries...) }

func drawWidgetScene(t *testing.T, name string, s Surface) {
	switch name {
	case "text-plain":
		DrawText(s, "hello terminal", TextStyle{})
	case "text-wrapped":
		DrawText(s, "the quick brown fox jumps", TextStyle{Wrap: true})
	case "text-aligned":
		DrawText(s.Sub(0, 0, 20, 1), "left", TextStyle{Align: AlignLeft})
		DrawText(s.Sub(0, 1, 20, 1), "center", TextStyle{Align: AlignCenter})
		DrawText(s.Sub(0, 2, 20, 1), "right", TextStyle{Align: AlignRight})
	case "badge":
		DrawBadge(s, BadgeOptions{Text: "LIVE"})
	case "badge-outline":
		DrawBadge(s, BadgeOptions{Text: "IDLE", Variant: BadgeOutline})
	case "badge-subtle":
		DrawBadge(s, BadgeOptions{Text: "WARN", Variant: BadgeSubtle})
	case "keyvalues":
		DrawKeyValues(s, KeyValueOptions{Rows: []KeyValueRow{
			KV("Host", "seed1"), KV("Uptime", "12d 4h"), KV("Load", "0.42"),
		}})
	case "divider":
		DrawDivider(s, DividerOptions{Label: "Section"})
	case "meter":
		DrawMeter(s, MeterOptions{Value: 0.72, Label: "CPU"})
	case "meter-segmented":
		DrawMeter(s, MeterOptions{Value: 0.33, Label: "MEM", Style: BarSegmented})
	case "meter-ascii":
		DrawMeter(s, MeterOptions{Value: 0.9, Label: "IO", Style: BarASCII})
	case "meter-nan":
		DrawMeter(s, MeterOptions{Value: math.NaN(), Label: "BAD"})
	case "meters-grid":
		DrawMeters(s, MetersOptions{
			Items: []MeterItem{
				Meter("c0", 0.2), Meter("c1", 0.5), Meter("c2", 0.8),
				Meter("c3", 1), Meter("c4", 0), Meter("c5", 0.65),
			},
			Columns: 2,
		})
	case "progress":
		DrawProgress(s, ProgressOptions{
			Value: 37, Max: ptrF64(120), Label: "Sync", ShowCount: true,
		})
	case "heat-bar":
		DrawHeatBar(s, HeatBarOptions{Value: 0.6})
	case "columns":
		DrawColumns(s, ColumnsOptions{Values: series()})
	case "bar-smooth":
		Bar(s, BarOptions{Value: 0.63})
	case "bar-segmented":
		Bar(s, BarOptions{Value: 0.63, Style: BarSegmented})
	case "bar-ascii":
		Bar(s, BarOptions{Value: 0.63, Style: BarASCII})
	case "sparkline":
		Sparkline(s, series(), SparklineOptions{})
	case "plot-braille":
		Plot(s, []Series{{Values: series()}}, PlotOptions{})
	case "plot-block":
		Plot(s, []Series{{Values: series()}}, PlotOptions{Mode: FillBlock})
	case "plot-ascii":
		Plot(s, []Series{{Values: series()}}, PlotOptions{Mode: FillASCII})
	case "plot-fill":
		Plot(s, []Series{{Values: series(), Fill: ptrBool(true)}}, PlotOptions{})
	case "plot-grid":
		Plot(s, []Series{{Values: series()}}, PlotOptions{Grid: true})
	case "plot-multi":
		inverted := make([]float64, len(widgetSeries))
		for i, v := range widgetSeries {
			inverted[i] = 10 - v
		}
		Plot(s, []Series{{Values: series()}, {Values: inverted}}, PlotOptions{})
	case "gauge":
		Gauge(s, GaugeOptions{Value: 0.7, Label: "70%"})
	case "donut":
		Donut(s, DonutOptions{Segments: []DonutSegment{{Value: 3}, {Value: 5}, {Value: 2}}})
	case "graph-axis":
		DrawGraph(s, GraphOptions{Values: series(), Axis: true})
	case "graph-legend":
		halved := make([]float64, len(widgetSeries))
		for i, v := range widgetSeries {
			halved[i] = v / 2
		}
		DrawGraph(s, GraphOptions{
			Series: []Series{{Values: series(), Label: "rx"}, {Values: halved, Label: "tx"}},
			Legend: true,
		})
	case "graph-timeaxis":
		DrawGraph(s, GraphOptions{Values: series(), TimeAxis: []string{"60s", "30s", "0s"}})
	// Both axes together. Each was covered alone, which is how the y-axis
	// minimum came to be drawn onto the time-axis row with no fixture noticing.
	case "graph-axis-timeaxis":
		axisMin, axisMax := 0.0, 100.0
		DrawGraph(s, GraphOptions{
			Values:   series(),
			Axis:     true,
			Plot:     PlotOptions{Min: &axisMin, Max: &axisMax},
			TimeAxis: []string{"60s", "30s", "0s"},
		})
	case "sparkline-widget":
		DrawSparkline(s, SparklineWidgetOptions{Values: series(), Label: "net", Text: "1.2M"})
	case "table":
		DrawTable(s, TableOptions{
			Rows: []TableRow{
				Row("1", "systemd", "0.1"),
				Row("420", "node", "12.5"),
				Row("900", "hqtui-demo", "3.2"),
			},
			Columns:  []TableColumn{Col("PID").Right(), Col("NAME"), Col("CPU%").Right()},
			Selected: optIntValue(1),
			Zebra:    true,
		})
	case "table-scrollbar":
		rows := make([]TableRow, 20)
		for i := range rows {
			rows[i] = Row(fmt.Sprint(i), fmt.Sprintf("row %d", i))
		}
		DrawTable(s, TableOptions{
			Rows:            rows,
			Columns:         []TableColumn{Col("#").Right(), Col("VALUE")},
			Selected:        optIntValue(12),
			FollowSelection: true,
			Scrollbar:       true,
		})
	case "list":
		DrawList(s, ListOptions{
			Items:    Items("alpha", "beta", "gamma", "delta"),
			Selected: optIntValue(2),
			Bullet:   "•",
		})
	case "tree":
		DrawTree(s, TreeOptions{
			Nodes: []TreeNode{
				Node("root", Node("child-a", Node("leaf")), Node("child-b")),
				Node("second"),
			},
			Selected: optIntValue(1),
		})
	case "log":
		DrawLog(s, LogOptions{Entries: []LogEntry{
			Log("started").At("10:00:00").Levelled("INFO"),
			Log("slow query").At("10:00:01").Levelled("WARN").WithMeta("412ms"),
			Log("connection reset").At("10:00:02").Levelled("ERROR"),
		}})
	case "scrollbar":
		DrawScrollbar(s, 1, 0, 8, 40, 12)
	case "button":
		DrawButton(s, ButtonOptions{Label: "OK"})
	case "button-focused":
		DrawButton(s, ButtonOptions{Label: "Run", Focused: true})
	case "button-variants":
		DrawButton(s.Sub(0, 0, 10, 1), ButtonOptions{Label: "ok", Variant: ButtonSuccess})
		DrawButton(s.Sub(10, 0, 10, 1), ButtonOptions{Label: "hm", Variant: ButtonWarning})
		DrawButton(s.Sub(20, 0, 10, 1), ButtonOptions{Label: "no", Variant: ButtonDanger})
		DrawButton(s.Sub(30, 0, 10, 1), ButtonOptions{Label: "gh", Variant: ButtonGhost})
	case "checkbox":
		DrawCheckbox(s.Sub(0, 0, 24, 1), Check("on", true))
		DrawCheckbox(s.Sub(0, 1, 24, 1), CheckboxOptions{Label: "toggle", Variant: CheckboxToggle})
		DrawCheckbox(s.Sub(0, 2, 24, 1),
			CheckboxOptions{Label: "radio", Checked: true, Variant: CheckboxRadio})
	case "select-closed":
		DrawSelect(s, SelectOptions{Value: "dark"})
	case "select-open":
		DrawSelect(s, SelectOptions{
			Value: "dark", Open: true,
			Options: []string{"dark", "nord", "light"}, SelectedIndex: 1,
		})
	case "text-input":
		DrawTextInput(s, TextInputOptions{Value: "seed", Label: "host", Focused: true})
	case "text-input-password":
		DrawTextInput(s, TextInputOptions{Value: "hunter2", Password: true})
	case "text-input-placeholder":
		DrawTextInput(s, TextInputOptions{Value: "", Placeholder: "search…"})
	case "tabs":
		DrawTabs(s, TabsOptions{Tabs: []string{"cpu", "mem", "net"}, Active: 1})
	case "tabs-underline":
		DrawTabs(s, TabsOptions{Tabs: []string{"a", "b"}, Active: 0, Variant: TabUnderline})
	case "status-bar":
		DrawStatusBar(s, StatusBarOptions{
			Items: []StatusItem{StatusKey("F1", "Help"), StatusKey("F10", "Quit")},
			Right: []StatusItem{Status("30fps")},
		})
	case "modal":
		DrawModal(s, ModalOptions{
			Title: "Confirm", Message: "Restart the service?",
			Buttons: []ModalButton{{Label: "Yes", Focused: true}, {Label: "No"}},
		})
	case "command-palette":
		DrawCommandPalette(s, CommandPaletteOptions{
			Query: "th",
			Items: []PaletteItem{{Label: "theme: dark", Hint: "T"}, {Label: "theme: nord"}},
		})
	case "tooltip":
		DrawTooltip(s, TooltipOptions{Text: "hint", X: 4, Y: 2})
	default:
		t.Fatalf("no Go scene for widget fixture %q", name)
	}
}

func optIntValue(n int) *int { return &n }

func TestWidgetsMatchReference(t *testing.T) {
	cases := arr(fixture(t, "widgets"))
	if len(cases) == 0 {
		t.Fatal("no widget fixtures loaded")
	}
	cells := 0
	for _, c := range cases {
		name := str(get(c, "name"))
		width, height := i(get(c, "width")), i(get(c, "height"))
		cells += width * height
		buffer, surface := scene(width, height, "dark")
		drawWidgetScene(t, name, surface)
		assertBuffer(t, buffer, get(c, "result"), name)
	}
	t.Logf("%d widget scenes, %d cells compared", len(cases), cells)
}
