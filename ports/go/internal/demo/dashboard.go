package demo

// Native counterpart of apps/demo/src/screens/dashboard.ts. Keep widget
// options and responsive tracks in sync; parity_test.go compares actual cells.
import (
	"fmt"
	ui "github.com/profullstack/hqtui/ports/go"
	"math"
	"strconv"
	"strings"
)

func ref[T any](v T) *T            { return &v }
func fixed(n int) ui.Layout        { return ui.Layout{Size: ref(ui.Cells(n))} }
func fraction(n float64) ui.Layout { return ui.Layout{Size: ref(ui.Fr(n))} }
func row(p *ui.Container, size ui.Size, gap int, fn func(*ui.Container)) {
	p.Row(ui.RowOptions{Layout: ui.Layout{Size: &size, Gap: gap}}, fn)
}
func col(p *ui.Container, size ui.Size, fn func(*ui.Container)) {
	p.Column(ui.ColumnOptions{Layout: ui.Layout{Size: &size}}, fn)
}
func txt(p *ui.Container, text string, color ui.Color) { p.StyledText(text, ui.TextStyle{Fg: &color}) }
func kv(label, value string, color ui.Color) ui.KeyValueRow {
	return ui.KeyValueRow{Label: label, Value: value, Color: &color}
}
func keys(p *ui.Container, rows []ui.KeyValueRow, spread bool) {
	p.KeyValues(ui.KeyValueOptions{Rows: rows, NoSpread: !spread})
}
func scalar(v any) string {
	if v == nil {
		return "—"
	}
	if n, ok := v.(float64); ok {
		return strconv.FormatFloat(n, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}
func bytes(v float64, digits int) string {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return "—"
	}
	v = math.Max(0, v)
	unit := 0
	units := []string{"B", "KiB", "MiB", "GiB", "TiB", "PiB"}
	for v >= 1024 && unit < 5 {
		v /= 1024
		unit++
	}
	if unit == 0 {
		digits = 0
	}
	return fmt.Sprintf("%.*f %s", digits, v, units[unit])
}
func percent(v float64) string { return fmt.Sprintf("%.0f%%", math.Floor(ui.ClampRatio(v)*100+0.5)) }
func bitRate(v float64) string {
	v = math.Max(0, v) * 8
	for i, scale := range []float64{1e9, 1e6, 1e3} {
		if v >= scale {
			return fmt.Sprintf("%.1f %s", v/scale, []string{"Gb/s", "Mb/s", "Kb/s"}[i])
		}
	}
	return fmt.Sprintf("%.0f b/s", v)
}
func byteRate(v float64) string {
	for i, scale := range []float64{1e9, 1e6, 1e3} {
		if v >= scale {
			return fmt.Sprintf("%.1f %s", v/scale, []string{"GB/s", "MB/s", "KB/s"}[i])
		}
	}
	return fmt.Sprintf("%.0f B/s", math.Max(0, v))
}
func duration(v float64) string {
	n := int(math.Max(0, v))
	d, h, m := n/86400, n%86400/3600, n%3600/60
	if d > 0 {
		return fmt.Sprintf("%dd %dh %dm", d, h, m)
	}
	if h > 0 {
		return fmt.Sprintf("%dh %dm", h, m)
	}
	return fmt.Sprintf("%dm %ds", m, n%60)
}
func plot(p *ui.Container, v any, c ui.Color, maxValue *float64, axis bool) {
	p.Graph(ui.GraphOptions{Values: values(v), Axis: axis, Plot: ui.PlotOptions{Min: ref(0.), Max: maxValue, Fill: ref(true), Color: &c}})
}
func multi(p *ui.Container, a, b any, ca, cb ui.Color) {
	p.Graph(ui.GraphOptions{Series: []ui.Series{{Values: values(a), Color: &ca, Fill: ref(true)}, {Values: values(b), Color: &cb, Fill: ref(true)}}, Plot: ui.PlotOptions{Min: ref(0.)}})
}
func meter(p *ui.Container, v float64, c *ui.Color) {
	p.Meter(ui.MeterOptions{Value: v, Color: c, HideValue: true, Style: ui.BarSegmented})
}

func (s *state) cpuPanel(p *ui.Container, columns int, size *ui.Size) {
	c := obj(s.sample["cpu"])
	p.Panel(ui.PanelOptions{Layout: ui.Layout{Size: size}, Title: "CPU Overview", Subtitle: percent(num(c["total"]))}, func(p *ui.Container) {
		t := p.Theme()
		p.Label(fmt.Sprintf("%s   %.1f GHz", scalar(c["model"]), num(c["frequencyGhz"])))
		plot(p, c["history"], t.Success, ref(100.), false)
		items := []ui.MeterItem{}
		for i, v := range arr(c["cores"]) {
			items = append(items, ui.Meter(fmt.Sprintf("P%d", i), num(v)))
		}
		p.Meters(ui.MetersOptions{Items: items, Columns: columns, LabelWidth: 4, ValueWidth: 5, Style: ui.BarSegmented})
		p.Divider(ui.DividerOptions{})
		load := values(c["load"])
		for len(load) < 3 {
			load = append(load, 0)
		}
		keys(p, []ui.KeyValueRow{kv("Load Avg", fmt.Sprintf("%.2f   %.2f   %.2f", load[0], load[1], load[2]), t.Warning)}, true)
	})
}
func (s *state) memoryPanel(p *ui.Container, size *ui.Size) {
	m := obj(s.sample["memory"])
	used, swap := num(m["used"])/math.Max(1, num(m["total"])), num(m["swapUsed"])/math.Max(1, num(m["swapTotal"]))
	p.Panel(ui.PanelOptions{Layout: ui.Layout{Size: size}, Title: "Memory & Swap"}, func(p *ui.Container) {
		t := p.Theme()
		txt(p, fmt.Sprintf("Memory      %s / %s (%s)", bytes(num(m["used"]), 2), bytes(num(m["total"]), 2), percent(used)), t.Foreground)
		meter(p, used, nil)
		p.Spacer(ui.Cells(1))
		keys(p, []ui.KeyValueRow{kv("Used:", bytes(num(m["used"]), 2), t.Warning), kv("Available:", bytes(num(m["available"]), 2), t.Success), kv("Cached:", bytes(num(m["cached"]), 2), t.Accent), kv("Buffers:", bytes(num(m["buffers"]), 2), t.Secondary), kv("Free:", bytes(num(m["free"]), 2), t.Muted)}, true)
		p.Spacer(ui.Fill())
		p.Divider(ui.DividerOptions{})
		txt(p, fmt.Sprintf("Swap        %s / %s (%s)", bytes(num(m["swapUsed"]), 2), bytes(num(m["swapTotal"]), 2), percent(swap)), t.Foreground)
		meter(p, swap, &t.Secondary)
		keys(p, []ui.KeyValueRow{kv("Used:", bytes(num(m["swapUsed"]), 2), t.Secondary), kv("Free:", bytes(num(m["swapTotal"])-num(m["swapUsed"]), 2), t.Muted)}, true)
	})
}
func (s *state) disksPanel(p *ui.Container, size *ui.Size) {
	disks := arr(s.sample["disks"])
	p.Panel(ui.PanelOptions{Layout: ui.Layout{Size: size}, Title: "Disks"}, func(p *ui.Container) {
		t := p.Theme()
		if len(disks) == 0 {
			p.Label("No disks reported")
			return
		}
		for i, v := range disks[:min(2, len(disks))] {
			d := obj(v)
			used := num(d["used"]) / math.Max(1, num(d["total"]))
			txt(p, fmt.Sprintf("%s — %s (%s)", scalar(d["device"]), bytes(num(d["total"]), 2), scalar(d["type"])), t.Foreground)
			txt(p, fmt.Sprintf("Used: %s (%s)", bytes(num(d["used"]), 2), percent(used)), t.Muted)
			meter(p, used, nil)
			txt(p, "Free: "+bytes(num(d["total"])-num(d["used"]), 2), t.Muted)
			row(p, ui.Cells(1), 0, func(r *ui.Container) {
				txt(r, "Read: "+byteRate(num(d["readRate"])), t.Success)
				r.StyledText("Write: "+byteRate(num(d["writeRate"])), ui.TextStyle{Fg: &t.Secondary, Align: ui.AlignRight})
			})
			multi(p, d["readHistory"], d["writeHistory"], t.Success, t.Secondary)
			if i == 0 && len(disks) > 1 {
				p.Divider(ui.DividerOptions{})
			}
		}
	})
}
func (s *state) systemPanel(p *ui.Container, size *ui.Size) {
	gap := s.panelGap()
	sys, c, m := obj(s.sample["system"]), obj(s.sample["cpu"]), obj(s.sample["memory"])
	p.Panel(ui.PanelOptions{Layout: ui.Layout{Size: size}, Title: "System"}, func(p *ui.Container) {
		t := p.Theme()
		used := num(m["used"]) / math.Max(1, num(m["total"]))
		source := "simulated"
		if s.real {
			source = "linux/proc"
		}
		count := int(num(sys["processCount"]))
		if count == 0 {
			count = len(arr(s.sample["processes"]))
		}
		swap := "—"
		if num(m["swapTotal"]) > 0 {
			swap = percent(num(m["swapUsed"]) / num(m["swapTotal"]))
		}
		load := values(c["load"])
		for len(load) < 3 {
			load = append(load, 0)
		}
		p.Row(ui.RowOptions{Layout: ui.Layout{Size: ref(ui.Cells(6)), Min: ref(6), Gap: 2}}, func(r *ui.Container) {
			keys(r, []ui.KeyValueRow{kv("OS:", scalar(sys["os"]), t.Foreground), kv("Kernel:", scalar(sys["kernel"]), t.Foreground), kv("Uptime:", duration(num(sys["uptime"])), t.Foreground), kv("Hostname:", scalar(sys["hostname"]), t.Foreground), kv("Shell:", scalar(sys["shell"]), t.Foreground), kv("Source:", source, t.Accent)}, false)
			keys(r, []ui.KeyValueRow{kv("CPU:", percent(num(c["total"])), ui.HeatColor(t, num(c["total"]))), kv("Memory:", fmt.Sprintf("%s (%s)", percent(used), bytes(num(m["used"]), 2)), t.Warning), kv("Swap:", swap, t.Secondary), kv("Load:", fmt.Sprintf("%.2f %.2f %.2f", load[0], load[1], load[2]), t.Foreground), kv("Processes:", fmt.Sprint(count), t.Foreground), kv("Threads:", scalar(sys["threadCount"]), t.Foreground)}, false)
		})
		p.Panel(ui.PanelOptions{Title: "CPU History", Layout: ui.Layout{Min: ref(5)}}, func(g *ui.Container) { plot(g, c["history"], t.Success, ref(100.), true) })
		if p.Width() >= 46 && p.Height() >= 16 {
			row(p, ui.Cells(6), gap, func(r *ui.Container) {
				r.Panel(ui.PanelOptions{Title: "Quick Stats"}, func(q *ui.Container) {
					threads := scalar(sys["threadCount"])
					if num(sys["threadCount"]) == 0 {
						threads = "—"
					}
					keys(q, []ui.KeyValueRow{kv("Uptime", duration(num(sys["uptime"])), t.Accent), kv("Procs", fmt.Sprint(count), t.Accent), kv("Threads", threads, t.Accent), kv("Ctx/s", fmt.Sprintf("%.1fK", num(obj(obj(s.sample["telemetry"])["kernel"])["contextSwitchRate"])/1000), t.Accent)}, true)
				})
				r.Panel(ui.PanelOptions{Title: "Memory"}, func(q *ui.Container) {
					txt(q, percent(used), t.Warning)
					plot(q, m["history"], t.Primary, ref(100.), false)
				})
				r.Panel(ui.PanelOptions{Title: "Temp", Layout: fixed(14)}, func(q *ui.Container) {
					v, label := num(c["total"]), percent(num(c["total"]))
					if temps := arr(s.sample["temperatures"]); len(temps) > 0 {
						temp := obj(temps[0])
						maxV := num(temp["max"])
						if maxV == 0 {
							maxV = 100
						}
						v = math.Min(1, num(temp["value"])/maxV)
						label = fmt.Sprintf("%.0f°C", math.Floor(num(temp["value"])+.5))
					}
					q.Gauge(ui.GaugeOptions{Value: v, Label: label})
				})
			})
		} else {
			p.Divider(ui.DividerOptions{})
			keys(p, []ui.KeyValueRow{kv("Threads", scalar(sys["threadCount"]), t.Accent), kv("Ctx switches", fmt.Sprintf("%.1fK", num(sys["contextSwitches"])/1000), t.Accent)}, true)
		}
	})
}

// Table formatting stays native. Per-cell colors preserve TS render callbacks.
type dataColumn struct {
	key string
	ui.TableColumn
	format func(object) string
	color  func(object) ui.Color
}

func dc(key, title string, width, minWidth int, color *ui.Color, right bool) dataColumn {
	c := ui.Col(title)
	if width > 0 {
		c = c.Sized(ui.Cells(width))
	}
	if minWidth > 0 {
		c.Min = ref(minWidth)
	}
	c.Color = color
	if right {
		c = c.Right()
	}
	return dataColumn{key: key, TableColumn: c}
}
func (s *state) dataTable(p *ui.Container, name string, data []any, cols []dataColumn, zebra bool, flags ...bool) {
	p.Column(ui.ColumnOptions{}, func(surface *ui.Container) { s.drawDataTable(surface, name, data, cols, zebra, flags...) })
}
func (s *state) drawDataTable(p *ui.Container, name string, data []any, cols []dataColumn, zebra bool, flags ...bool) {
	pane := s.pane(name, len(data))
	headerRows := 1
	if len(flags) > 0 && flags[0] {
		headerRows = 0
	}
	pane.offset = ui.ResolveOffset(&pane.offset, &pane.selected, max(0, p.Height()-headerRows), len(data), true)
	rows := make([]ui.TableRow, 0, len(data))
	columns := make([]ui.TableColumn, 0, len(cols))
	for _, c := range cols {
		columns = append(columns, c.TableColumn)
	}
	for _, v := range data {
		d := obj(v)
		r := ui.TableRow{}
		for _, c := range cols {
			text := scalar(d[c.key])
			if c.format != nil {
				text = c.format(d)
			}
			r.Cells = append(r.Cells, text)
			color := c.Color
			if c.color != nil {
				color = ref(c.color(d))
			}
			r.CellColors = append(r.CellColors, color)
		}
		rows = append(rows, r)
	}
	p.Table(ui.TableOptions{Rows: rows, Columns: columns, Selected: &pane.selected, Offset: &pane.offset, FollowSelection: true, Zebra: zebra, Scrollbar: len(flags) < 2 || !flags[1], NoHeader: len(flags) > 0 && flags[0]}, ui.ScrollHandlers{OnFocus: s.action(func() { s.focused[s.screen] = name }), OnScroll: func(d int) {
		if !s.overlay() {
			s.focused[s.screen] = name
			pane.move(d)
		}
	}, OnSelectRow: func(i int) {
		if !s.overlay() {
			pane.selected = clamp(pane.offset+i, 0, len(data)-1)
		}
	}})
}
func (s *state) processesPanel(p *ui.Container, size *ui.Size) {
	p.Panel(ui.PanelOptions{Layout: ui.Layout{Size: size}, Title: "Processes (sorted by " + []string{"CPU", "MEM", "PID", "NAME"}[s.sort] + ")", Subtitle: func() string {
		if s.filter != "" {
			return "filter: " + s.filter
		}
		return ""
	}(), Focusable: true}, func(p *ui.Container) {
		t := p.Theme()
		cols := []dataColumn{dc("pid", "PID", 7, 0, nil, true), dc("name", "Name", 0, 8, &t.Primary, false), dc("cpu", "CPU%", 6, 0, nil, true), dc("mem", "MEM%", 6, 0, &t.Warning, true), dc("rss", "RSS", 9, 0, nil, true), dc("threads", "Threads", 7, 0, nil, true), dc("state", "S", 2, 0, nil, false), dc("user", "User", 10, 0, &t.Muted, false), dc("command", "Command", 0, 10, &t.Muted, false)}
		cols[2].format = func(d object) string { return fmt.Sprintf("%.1f", num(d["cpu"])) }
		cols[2].color = func(d object) ui.Color { return ui.HeatColor(t, math.Min(1, num(d["cpu"])/100)) }
		cols[3].format = func(d object) string { return fmt.Sprintf("%.1f", num(d["mem"])) }
		cols[4].format = func(d object) string { return bytes(num(d["rss"]), 0) }
		cols[6].color = func(d object) ui.Color {
			if d["state"] == "R" {
				return t.Success
			}
			return t.Muted
		}
		s.dataTable(p, "dashboard.processes", s.processes(), cols, false)
	})
}
func (s *state) networkPanel(p *ui.Container, size *ui.Size) {
	n := obj(s.sample["network"])
	p.Panel(ui.PanelOptions{Layout: ui.Layout{Size: size}, Title: "Network"}, func(p *ui.Container) {
		t := p.Theme()
		row(p, ui.Cells(1), 0, func(r *ui.Container) {
			txt(r, "Download: "+bitRate(num(n["downRate"])), t.Primary)
			r.StyledText("Upload: "+bitRate(num(n["upRate"])), ui.TextStyle{Fg: &t.Secondary, Align: ui.AlignRight})
		})
		for i, key := range []string{"downHistory", "upHistory"} {
			color := []ui.Color{t.Primary, t.Secondary}[i]
			p.Graph(ui.GraphOptions{Values: values(n[key]), Axis: true, AxisFormat: func(v float64) string { return strings.ReplaceAll(bitRate(v), " ", "") }, Plot: ui.PlotOptions{Min: ref(0.), Color: &color, Fill: ref(true)}})
		}
		p.Divider(ui.DividerOptions{})
		row(p, ui.Cells(3), 2, func(r *ui.Container) {
			for i, prefix := range []string{"down", "up"} {
				color := []ui.Color{t.Primary, t.Secondary}[i]
				keys(r, []ui.KeyValueRow{kv("Total:", bytes(num(n[prefix+"Total"]), 2), color), kv("Current:", bitRate(num(n[prefix+"Rate"])), color), kv("Peak:", bitRate(num(n[prefix+"Peak"])), color)}, false)
			}
		})
	})
}
func (s *state) diskUsagePanel(p *ui.Container, size *ui.Size) {
	disks := arr(s.sample["disks"])
	first := object{}
	if len(disks) > 0 {
		first = obj(disks[0])
	}
	subtitle := ""
	if len(disks) > 0 {
		subtitle = scalar(first["device"])
	}
	p.Panel(ui.PanelOptions{Layout: ui.Layout{Size: size}, Title: "Disk Usage", Subtitle: subtitle}, func(p *ui.Container) {
		t := p.Theme()
		for _, v := range disks {
			d := obj(v)
			used := num(d["used"]) / math.Max(1, num(d["total"]))
			p.Meter(ui.MeterOptions{Value: used, Text: fmt.Sprintf("%s %s / %s", percent(used), bytes(num(d["used"]), 0), bytes(num(d["total"]), 0)), Style: ui.BarSegmented})
			p.Label(fmt.Sprintf("%s (%s)", scalar(d["mount"]), scalar(d["device"])))
		}
		p.Spacer(ui.Cells(1))
		p.Panel(ui.PanelOptions{Title: "I/O Summary"}, func(io *ui.Container) {
			row(io, ui.Fill(), 2, func(r *ui.Container) {
				for i, prefix := range []string{"read", "write"} {
					color := []ui.Color{t.Success, t.Secondary}[i]
					label := []string{"Read: ", "Write: "}[i]
					col(r, ui.Fill(), func(c *ui.Container) {
						txt(c, label+byteRate(num(first[prefix+"Rate"])), color)
						plot(c, first[prefix+"History"], color, nil, false)
					})
				}
			})
		})
	})
}
func (s *state) temperaturesPanel(p *ui.Container) {
	p.Panel(ui.PanelOptions{Title: "Temperatures"}, func(p *ui.Container) {
		t := p.Theme()
		temps := arr(s.sample["temperatures"])
		if len(temps) == 0 {
			txt(p, "No thermal sensors on this host.", t.Muted)
			p.Spacer(ui.Cells(1))
			p.Label("Run with --sim to see this panel populated.")
			return
		}
		for _, v := range temps[:min(10, len(temps))] {
			temp := obj(v)
			maxV := num(temp["max"])
			if maxV == 0 {
				maxV = 100
			}
			ratio := math.Min(1, num(temp["value"])/maxV)
			row(p, ui.Cells(1), 0, func(r *ui.Container) {
				r.StyledText(scalar(temp["label"]), ui.TextStyle{Fg: &t.Muted}, fixed(16))
				r.HeatBar(ui.HeatBarOptions{Value: ratio})
				r.StyledText(fmt.Sprintf("%.0f°C", math.Floor(num(temp["value"])+.5)), ui.TextStyle{Fg: ref(ui.HeatColor(t, ratio)), Align: ui.AlignRight}, fixed(6))
			})
		}
	})
}
func (s *state) sensorsPanel(p *ui.Container) {
	p.Panel(ui.PanelOptions{Title: "Sensors"}, func(p *ui.Container) {
		t := p.Theme()
		sensors := arr(s.sample["sensors"])
		if len(sensors) == 0 {
			p.Label("No hardware sensors on this host.")
			p.Spacer(ui.Cells(1))
			p.Label("Probed: /sys/class/hwmon, thermal zones, lm-sensors,")
			p.Label("power supplies and nvidia-smi.")
			return
		}
		rows := []ui.KeyValueRow{}
		for _, v := range sensors {
			d := obj(v)
			rows = append(rows, kv(scalar(d["label"]), scalar(d["value"]), t.Accent))
		}
		keys(p, rows, true)
	})
}
func (s *state) logsPanel(p *ui.Container, size *ui.Size) {
	p.Panel(ui.PanelOptions{Layout: ui.Layout{Size: size}, Title: "Logs"}, func(p *ui.Container) {
		data := arr(s.sample["logs"])
		pane := s.pane("dashboard.logs", len(data))
		pane.log = true
		entries := []ui.LogEntry{}
		for _, v := range data {
			d := obj(v)
			entries = append(entries, ui.LogEntry{Time: scalar(d["time"]), Level: scalar(d["level"]), Message: scalar(d["message"]), Meta: "{" + scalar(d["meta"]) + "}"})
		}
		p.Log(ui.LogOptions{Entries: entries, FromEnd: pane.offset, Scrollbar: true}, ui.ScrollHandlers{OnFocus: s.action(func() { s.focused[s.screen] = "dashboard.logs" }), OnScroll: func(delta int) {
			if !s.overlay() {
				s.focused[s.screen] = "dashboard.logs"
				pane.offset = clamp(pane.offset-delta, 0, len(data)-1)
			}
		}})
	})
}

// dashboard is the reference screen. Three layouts, chosen by terminal width.
//
// Panels go straight into their row rather than each inside a sizing column. A
// column is not a bordered child, so a row of them has no seam to merge and c
// could never change this screen; a size on the panel does the same job and
// leaves the borders adjacent to each other.
func (s *state) dashboard(p *ui.Container) {
	gap := s.panelGap()
	if p.Width() >= 150 {
		height := 16
		if p.Height() >= 44 {
			height = 19
		}
		row(p, ui.Cells(height), gap, func(r *ui.Container) {
			s.cpuPanel(r, 2, ref(ui.Fr(1)))
			s.memoryPanel(r, ref(ui.Fr(.95)))
			s.disksPanel(r, ref(ui.Fr(.95)))
			s.systemPanel(r, ref(ui.Fr(1.35)))
		})
		row(p, ui.Fr(1), gap, func(r *ui.Container) {
			s.processesPanel(r, ref(ui.Fr(2)))
			s.networkPanel(r, ref(ui.Fr(1.2)))
			s.diskUsagePanel(r, ref(ui.Fr(1.2)))
		})
		row(p, ui.Cells(12), gap, func(r *ui.Container) {
			s.temperaturesPanel(r)
			s.sensorsPanel(r)
			s.logsPanel(r, ref(ui.Fr(1.6)))
		})
	} else if p.Width() >= 100 {
		row(p, ui.Cells(14), gap, func(r *ui.Container) {
			s.cpuPanel(r, 2, nil)
			s.memoryPanel(r, nil)
			s.systemPanel(r, nil)
		})
		row(p, ui.Fr(1), gap, func(r *ui.Container) {
			s.processesPanel(r, ref(ui.Fr(1.6)))
			// Fill explicitly: the column this replaced carried it, and a nil
			// size is not the same thing here.
			s.networkPanel(r, ref(ui.Fill()))
		})
		row(p, ui.Cells(10), gap, func(r *ui.Container) { s.temperaturesPanel(r); s.logsPanel(r, nil) })
	} else {
		row(p, ui.Cells(10), gap, func(r *ui.Container) { s.cpuPanel(r, 1, nil); s.memoryPanel(r, nil) })
		col(p, ui.Fill(), func(c *ui.Container) { s.processesPanel(c, nil) })
		row(p, ui.Cells(8), gap, func(r *ui.Container) { s.networkPanel(r, nil) })
	}
}
