package demo

import (
	"fmt"
	ui "github.com/profullstack/hqtui/ports/go"
	"math"
	"strings"
)

type panelView struct {
	title string
	draw  func(*ui.Container)
}
type column struct{ key, title string }

func size(v float64) string {
	for _, unit := range []string{"B", "KiB", "MiB", "GiB", "TiB"} {
		if math.Abs(v) < 1024 || unit == "TiB" {
			return fmt.Sprintf("%.1f %s", v, unit)
		}
		v /= 1024
	}
	return ""
}
func (s *state) overlay() bool { return s.help || s.modal || s.palette || s.filtering }
func (s *state) action(fn func()) func() {
	return func() {
		if !s.overlay() {
			fn()
		}
	}
}
func grid(p *ui.Container, panels []panelView, cols int) {
	if p.Width() < 45 {
		cols = 1
	}
	columns := []ui.Size{}
	rows := []ui.Size{}
	for i := 0; i < cols; i++ {
		columns = append(columns, ui.Fr(1))
	}
	for i := 0; i < (len(panels)+cols-1)/cols; i++ {
		rows = append(rows, ui.Fr(1))
	}
	p.Grid(ui.GridOptions{Columns: columns, Rows: rows, Layout: ui.Layout{Gap: 1}}, func(g *ui.GridContainer) {
		for _, panel := range panels {
			g.Panel(ui.PanelOptions{Title: panel.title}, ui.CellOptions{}, panel.draw)
		}
	})
}
func graph(p *ui.Container, data any, label string, second ...any) {
	fill := true
	series := []ui.Series{{Values: values(data), Label: label}}
	if len(second) > 0 {
		series = append(series, ui.Series{Values: values(second[0]), Label: "out"})
	}
	p.Graph(ui.GraphOptions{Series: series, Axis: true, Legend: label != "", Plot: ui.PlotOptions{Fill: &fill}})
}
func (s *state) table(p *ui.Container, name string, data []any, cols []column) {
	pane := s.pane(name, len(data))
	capacity := max(0, p.Height()-1)
	if name == "dashboard.processes" {
		capacity = max(0, capacity-1)
	}
	pane.offset = ui.ResolveOffset(&pane.offset, &pane.selected, capacity, len(data), true)
	rows := []ui.TableRow{}
	columns := []ui.TableColumn{}
	for _, c := range cols {
		columns = append(columns, ui.Col(c.title))
	}
	for _, row := range data {
		cells := []string{}
		for _, c := range cols {
			cells = append(cells, str(obj(row)[c.key]))
		}
		rows = append(rows, ui.Row(cells...))
	}
	p.Table(ui.TableOptions{Rows: rows, Columns: columns, Selected: &pane.selected, Offset: &pane.offset, FollowSelection: true, Zebra: true, Scrollbar: true}, ui.ScrollHandlers{
		OnFocus: s.action(func() { s.focused[s.screen] = name }), OnScroll: func(d int) {
			if !s.overlay() {
				s.focused[s.screen] = name
				pane.move(d)
			}
		}, OnSelectRow: func(row int) {
			if !s.overlay() {
				pane.selected = clamp(pane.offset+row, 0, len(data)-1)
			}
		}})
}
func (s *state) dashboard(p *ui.Container) {
	c, m, n, sys := obj(s.sample["cpu"]), obj(s.sample["memory"]), obj(s.sample["network"]), obj(s.sample["system"])
	panels := []panelView{
		{"CPU Overview", func(p *ui.Container) {
			p.Label(fmt.Sprintf("%s  %.1f GHz", str(c["model"]), num(c["frequencyGhz"])))
			graph(p, c["history"], "CPU %")
			for i, v := range arr(c["cores"]) {
				p.Meter(ui.MeterOptions{Value: num(v), Label: fmt.Sprintf("P%d", i)})
			}
			p.Label("Load: " + str(c["load"]))
		}},
		{"Processes", func(p *ui.Container) {
			p.Label(fmt.Sprintf("F3 filter: %s  F6 sort: %s", s.filter, []string{"CPU", "MEM", "PID", "NAME"}[s.sort]))
			s.table(p, "dashboard.processes", s.processes(), []column{{"pid", "PID"}, {"name", "Name"}, {"cpu", "CPU%"}, {"mem", "MEM%"}, {"threads", "THR"}, {"state", "S"}, {"user", "User"}, {"command", "Command"}})
		}},
		{"Memory & Swap", func(p *ui.Container) {
			p.Meter(ui.MeterOptions{Value: num(m["used"]) / math.Max(1, num(m["total"])), Label: "RAM"})
			for _, k := range []string{"used", "available", "cached", "buffers", "free"} {
				p.Text(fmt.Sprintf("%-12s %s", k, size(num(m[k]))))
			}
			p.Meter(ui.MeterOptions{Value: num(m["swapUsed"]) / math.Max(1, num(m["swapTotal"])), Label: "Swap"})
			graph(p, m["history"], "")
		}},
		{"Network", func(p *ui.Container) {
			p.Label(fmt.Sprintf("Down %s/s  Up %s/s", size(num(n["downRate"])), size(num(n["upRate"]))))
			graph(p, n["downHistory"], "down", n["upHistory"])
			p.Label("Received " + size(num(n["downTotal"])))
			p.Label("Sent " + size(num(n["upTotal"])))
		}}}
	if p.Width() >= 90 && p.Height() >= 46 {
		panels = append(panels,
			panelView{"Disks", func(p *ui.Container) {
				for i, v := range arr(s.sample["disks"]) {
					if i >= 2 {
						break
					}
					d := obj(v)
					p.Label(str(d["device"]) + " " + str(d["mount"]))
					p.Meter(ui.MeterOptions{Value: num(d["used"]) / math.Max(1, num(d["total"])), Label: "Used"})
					graph(p, d["readHistory"], "read", d["writeHistory"])
				}
			}},
			panelView{"System", func(p *ui.Container) {
				for _, k := range []string{"hostname", "os", "kernel", "shell", "processCount", "threadCount", "uptime"} {
					p.Text(fmt.Sprintf("%-12s %s", k, str(sys[k])))
				}
				graph(p, c["history"], "CPU History")
			}},
			panelView{"Temperatures", func(p *ui.Container) {
				temps := arr(s.sample["temperatures"])
				if len(temps) == 0 {
					p.Label("No thermal sensors available")
				}
				for _, v := range temps {
					t := obj(v)
					p.Meter(ui.MeterOptions{Value: num(t["value"]) / 100, Label: str(t["label"]), Text: fmt.Sprintf("%.0f°C", num(t["value"]))})
				}
			}},
			panelView{"Sensors", func(p *ui.Container) {
				rows := arr(s.sample["sensors"])
				if len(rows) == 0 {
					p.Label("No sensor readings available")
				}
				for _, v := range rows {
					row := obj(v)
					p.Label(str(row["label"]) + ": " + str(row["value"]))
				}
			}},
			panelView{"Logs", func(p *ui.Container) {
				s.table(p, "dashboard.logs", arr(s.sample["logs"]), []column{{"time", "Time"}, {"level", "Level"}, {"message", "Message"}})
			}})
	}
	cols := 2
	if p.Width() >= 160 && len(panels) > 4 {
		cols = 3
	}
	grid(p, panels, cols)
}
func (s *state) telemetry(p *ui.Container) {
	t := obj(s.sample["telemetry"])
	tab := func(title, key string, cols []column) panelView {
		return panelView{title, func(p *ui.Container) { s.table(p, screens[s.screen]+"."+key, arr(t[key]), cols) }}
	}
	trace := func(title, key string) panelView {
		return panelView{title, func(p *ui.Container) { graph(p, t[key], title) }}
	}
	var panels []panelView
	switch s.screen {
	case 2:
		panels = []panelView{tab("Active Sessions", "sessions", []column{{"user", "User"}, {"tty", "TTY"}, {"from", "From"}, {"idle", "Idle"}, {"what", "Command"}}), tab("Login History", "logins", []column{{"user", "User"}, {"tty", "TTY"}, {"from", "From"}, {"when", "When"}, {"status", "Status"}}), tab("SSH Authentication", "ssh", []column{{"time", "Time"}, {"action", "Action"}, {"user", "User"}, {"from", "From"}}), trace("Session History", "sessionHistory")}
	case 3:
		panels = []panelView{tab("Interfaces", "interfaces", []column{{"name", "Name"}, {"state", "State"}, {"rxRate", "RX B/s"}, {"txRate", "TX B/s"}, {"errors", "Errors"}, {"drops", "Drops"}}), tab("Connections", "connections", []column{{"proto", "Proto"}, {"state", "State"}, {"local", "Local"}, {"remote", "Remote"}, {"process", "Process"}}), tab("Listeners", "listeners", []column{{"proto", "Proto"}, {"address", "Address"}, {"port", "Port"}, {"process", "Process"}}), trace("Connection History", "connectionHistory")}
	case 4:
		panels = []panelView{tab("Services", "services", []column{{"name", "Unit"}, {"active", "State"}, {"description", "Description"}}), tab("Filesystems", "filesystems", []column{{"mount", "Mount"}, {"device", "Device"}, {"type", "Type"}, {"used", "Used B"}, {"size", "Size B"}}), {"Kernel", func(p *ui.Container) {
			k := obj(t["kernel"])
			for _, name := range []string{"contextSwitchRate", "interruptRate", "forkRate", "procsRunning", "procsBlocked", "entropy", "openFiles"} {
				p.Text(name + "  " + str(k[name]))
			}
		}}, tab("Journal", "journal", []column{{"time", "Time"}, {"level", "Level"}, {"unit", "Unit"}, {"message", "Message"}})}
	default:
		panels = []panelView{tab("Protocols", "protocols", []column{{"protocol", "Protocol"}, {"inbound", "In"}, {"outbound", "Out"}, {"total", "Total"}}), {"TCP Segments", func(p *ui.Container) { graph(p, t["netInHistory"], "in", t["netOutHistory"]) }}, trace("Retransmits", "retransHistory"), {"HTTP", func(p *ui.Container) {
			h := obj(t["http"])
			if len(h) == 0 {
				p.Label("HTTP access log unavailable (read-only)")
				return
			}
			p.Label(fmt.Sprintf("%.1f requests/s", num(h["requestsPerSecond"])))
			s.table(p, "traffic.http", arr(h["recent"]), []column{{"time", "Time"}, {"method", "Method"}, {"path", "Path"}, {"status", "Status"}, {"client", "Client"}})
		}}, tab("Remote Hosts", "remotes", []column{{"host", "Host"}, {"connections", "Connections"}, {"protocols", "Protocols"}}), tab("SSH Authentication", "ssh", []column{{"time", "Time"}, {"action", "Action"}, {"user", "User"}, {"from", "From"}})}
	}
	cols := 2
	if s.screen == 1 && p.Width() >= 120 {
		cols = 3
	}
	if s.screen == 2 {
		panels = append(panels, tab("Failed Logins", "failedLogins", []column{{"user", "User"}, {"tty", "TTY"}, {"from", "From"}, {"when", "When"}, {"status", "Status"}}))
	}
	if s.screen == 1 && s.real {
		p.Label("Protocol/direction: port-based estimates; HTTP rate: estimated from log growth")
	}
	grid(p, panels, cols)
}
func (s *state) components(p *ui.Container) {
	grid(p, []panelView{
		{"Controls", func(p *ui.Container) {
			p.Label("Click controls; e edits text; Esc finishes")
			for _, v := range []string{"Primary", "Success", "Warning", "Danger", "Ghost"} {
				p.Button(ui.ButtonOptions{Label: v}, s.action(func() { s.modal = true }))
			}
			p.Checkbox(ui.CheckboxOptions{Label: "Notifications", Checked: s.checked}, s.action(func() { s.checked = !s.checked }))
			p.Checkbox(ui.CheckboxOptions{Label: "Live updates", Checked: s.toggle, Variant: ui.CheckboxToggle}, s.action(func() { s.toggle = !s.toggle }))
			p.Select(ui.SelectOptions{Value: themes[s.selectIndex], Options: themes, SelectedIndex: s.selectIndex, Open: s.selectOpen}, s.action(func() { s.selectOpen = !s.selectOpen }))
			p.TextInput(ui.TextInputOptions{Value: s.input, Placeholder: "Type here", Focused: s.editing})
		}},
		{"Meters & Gauge", func(p *ui.Container) {
			for i := 0; i < 8; i++ {
				p.Meter(ui.MeterOptions{Value: float64(i+1) / 8, Label: fmt.Sprintf("Meter %d", i+1)})
			}
			p.Gauge(ui.GaugeOptions{Value: num(obj(s.sample["cpu"])["total"]), Label: "CPU"})
		}},
		{"Text & Badges", func(p *ui.Container) {
			p.Heading("Typography & Unicode")
			p.Label("日本語 中文 한국어 • café • 🚀")
			for _, v := range []string{"READY", "WARNING", "LIVE"} {
				p.Badge(ui.BadgeOptions{Text: v})
			}
			p.Button(ui.ButtonOptions{Label: "Command palette"}, s.action(func() { s.palette = true }))
			graph(p, obj(s.sample["cpu"])["history"], "History")
		}}}, 3)
}
func (s *state) graphics(p *ui.Container) {
	c, n := obj(s.sample["cpu"]), obj(s.sample["network"])
	grid(p, []panelView{
		{"Braille Canvas", func(p *ui.Container) {
			p.Canvas(nil, func(c *ui.BrailleCanvas, _ ui.Surface) {
				for x := 0; x < c.Width; x++ {
					c.Pixel(float64(x), (.5+.35*math.Sin(float64(x)/12+num(s.sample["time"])))*float64(max(0, c.Height-1)))
				}
			})
		}},
		{"CPU Plot", func(p *ui.Container) { graph(p, c["history"], "CPU %") }},
		{"Network Plot", func(p *ui.Container) { graph(p, n["downHistory"], "down", n["upHistory"]) }},
		{"Gauge", func(p *ui.Container) { p.Gauge(ui.GaugeOptions{Value: num(c["total"]), Label: "CPU"}) }}}, 2)
}
func (s *state) themeScreen(p *ui.Container) {
	grid(p, []panelView{{"Built-in Themes", func(p *ui.Container) {
		p.Label("F2 or Left/Right to switch themes")
		for i, name := range themes {
			p.Button(ui.ButtonOptions{Label: name}, s.action(func() { s.theme = i }))
		}
	}}, {"Live Preview", func(p *ui.Container) {
		p.Heading(themes[s.theme])
		theme := p.Theme()
		for _, c := range []struct {
			name  string
			color ui.Color
		}{{"primary", theme.Primary}, {"secondary", theme.Secondary}, {"accent", theme.Accent}, {"success", theme.Success}, {"warning", theme.Warning}, {"danger", theme.Danger}, {"muted", theme.Muted}} {
			p.Meter(ui.MeterOptions{Value: .7, Label: c.name, Color: &c.color})
		}
		graph(p, obj(s.sample["cpu"])["history"], "Preview")
	}}}, 2)
}
func (s *state) inputScreen(p *ui.Container) {
	grid(p, []panelView{{"Input Inspector", func(p *ui.Container) {
		p.Label("Last key: " + s.lastKey)
		p.Label("Mouse: " + s.lastMouse)
		p.Label("e to edit; Esc exits text input")
		p.TextInput(ui.TextInputOptions{Value: s.input, Focused: s.editing})
		s.table(p, "input.events", s.keyLog, []column{{"event", "Key Events"}})
	}}, {"Diagnostics", func(p *ui.Container) {
		p.Text("Renderer: native Go")
		p.Text(fmt.Sprintf("Size: %d×%d", p.Width(), p.Height()))
		p.Text("Arrows scroll the focused pane")
		p.Text("Ctrl+K palette · F1 help · q quit")
	}}}, 2)
}
func (s *state) stress(p *ui.Container) {
	panels := []panelView{}
	for i := 0; i < 12; i++ {
		panels = append(panels, panelView{fmt.Sprintf("Stress %02d", i+1), func(p *ui.Container) {
			p.Meter(ui.MeterOptions{Value: (math.Sin(num(s.sample["time"])+float64(i)) + 1) / 2, Label: "Load"})
			graph(p, obj(s.sample["cpu"])["history"], "")
		}})
	}
	cols := 3
	if p.Width() >= 120 {
		cols = 4
	}
	grid(p, panels, cols)
}
func (s *state) render(p *ui.Container) {
	one := ui.Cells(1)
	source := "SIMULATED"
	if s.real {
		source = "REAL"
	}
	status := "LIVE"
	if s.paused {
		status = "PAUSED"
	}
	p.Row(ui.RowOptions{Layout: ui.Layout{Size: &one}}, func(r *ui.Container) { r.Heading("hqtui — go"); r.Spacer(ui.Fill()); r.Label(source + "  " + status) })
	groups := [][]string{screens}
	if p.Width() < 150 {
		groups = [][]string{screens[:5], screens[5:]}
	}
	for _, group := range groups {
		base := index(screens, group[0])
		tabs := []string{}
		for i, name := range group {
			tabs = append(tabs, fmt.Sprintf("%d %s", (base+i+1)%10, name))
		}
		p.Tabs(ui.TabsOptions{Tabs: tabs, Active: s.screen - base}, func(i int) {
			if !s.overlay() {
				s.screen = base + i
			}
		})
	}
	if p.Width() < 30 || p.Height() < 12 {
		p.Label("Terminal too small; resize to 30×12")
		p.Spacer(ui.Fill())
	} else {
		p.Column(ui.ColumnOptions{}, func(body *ui.Container) {
			switch s.screen {
			case 0:
				s.dashboard(body)
			case 5:
				s.components(body)
			case 6:
				s.graphics(body)
			case 7:
				s.themeScreen(body)
			case 8:
				s.inputScreen(body)
			case 9:
				s.stress(body)
			default:
				s.telemetry(body)
			}
		})
	}
	if len(s.missing) > 0 {
		p.Label("Unavailable: " + strings.Join(s.missing, ", "))
	}
	p.StatusBar(ui.StatusBarOptions{Items: []ui.StatusItem{ui.StatusKey("F1", "help"), ui.StatusKey("F2", "theme"), ui.StatusKey("F3", "filter"), ui.StatusKey("^K", "palette"), ui.StatusKey("q", "quit")}, Right: []ui.StatusItem{ui.Status(screens[s.screen] + " · " + themes[s.theme])}})
	if s.filtering {
		p.Modal(ui.ModalOptions{Title: "Filter Processes", Message: s.filter + "▏\nEnter applies · Esc clears", Width: 60}, nil)
	}
	if s.help {
		p.Modal(ui.ModalOptions{Title: "hqtui — Help", Width: 66, Message: "1–9/0 / Tab: screen\nF2: theme  F3: filter  F6: sort\nCtrl+K: palette  Space: pause\nArrows / PgUp / PgDn / Home / End: scroll\nMouse: tabs, controls, selection and wheel\ne: edit text in Components/Input\nq / Ctrl+C: quit · Any key: close help"}, nil)
	}
	if s.modal {
		p.Modal(ui.ModalOptions{Title: "Read-only Demo", Width: 58, Message: "No process will be killed and no service changed.\nPress any key to close."}, nil)
	}
	if s.palette {
		items := []ui.PaletteItem{}
		for _, name := range s.commands() {
			items = append(items, ui.PaletteItem{Label: name})
		}
		p.CommandPalette(ui.CommandPaletteOptions{Query: s.query, Items: items, Selected: s.paletteIndex, Placeholder: "Search commands"})
	}
}
