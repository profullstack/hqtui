package demo

import ui "github.com/profullstack/hqtui/ports/go"

func (s *state) scrollHandlers(name string, pane *pane) ui.ScrollHandlers {
	return ui.ScrollHandlers{OnFocus: s.action(func() { s.focused[s.screen] = name }), OnScroll: func(d int) {
		if !s.overlay() {
			s.focused[s.screen] = name
			pane.move(d)
		}
	}, OnSelectRow: func(i int) {
		if !s.overlay() {
			pane.selected = clamp(pane.offset+i, 0, pane.total-1)
		}
	}}
}
func processTree() []ui.TreeNode {
	node := func(name, cpu, mem string, children ...ui.TreeNode) ui.TreeNode {
		return ui.TreeNode{Label: name, Values: []ui.TreeValue{{Text: cpu, Width: 6}, {Text: mem, Width: 6}}, Children: children}
	}
	return []ui.TreeNode{node("systemd", "1.3", "0.1", node("bash", "0.1", "0.2"), node("bun", "32.8", "4.2", node("bun:worker", "12.4", "1.8"), node("bun:worker", "8.7", "1.3")), node("node", "18.1", "2.1", node("node:worker", "6.1", "0.8")), node("postgres", "6.7", "1.8"))}
}
func (s *state) components(p *ui.Container) {
	t := p.Theme()
	c, m, n := obj(s.sample["cpu"]), obj(s.sample["memory"]), obj(s.sample["network"])
	row(p, ui.Fr(1), 1, func(r *ui.Container) {
		r.Column(ui.ColumnOptions{Layout: ui.Layout{Gap: 1}}, func(left *ui.Container) {
			left.Panel(ui.PanelOptions{Title: "Buttons & Inputs", Layout: fixed(13)}, func(p *ui.Container) {
				row(p, ui.Cells(1), 1, func(r *ui.Container) {
					for i, label := range []string{"Primary", "Success", "Warning", "Danger"} {
						width := []int{11, 11, 11, 10}[i]
						var action func()
						if i == 0 {
							action = s.action(func() { s.modal = true })
						}
						r.Button(ui.ButtonOptions{Label: label, Width: width, Variant: []ui.ButtonVariant{ui.ButtonPrimary, ui.ButtonSuccess, ui.ButtonWarning, ui.ButtonDanger}[i]}, action, fixed(width))
					}
					r.Spacer(ui.Fill())
				})
				p.Spacer(ui.Cells(1))
				row(p, ui.Cells(1), 2, func(r *ui.Container) {
					options := []string{"Dark", "Dracula", "Nord", "Tokyo Night"}
					r.Select(ui.SelectOptions{Value: options[s.selectIndex%4], Width: 20, Open: s.selectOpen, Options: options, SelectedIndex: s.selectIndex}, s.action(func() { s.selectOpen = !s.selectOpen }), fixed(20))
					r.Checkbox(ui.CheckboxOptions{Label: "Toggle", Checked: s.toggle, Variant: ui.CheckboxToggle}, s.action(func() { s.toggle = !s.toggle }), fixed(12))
					r.Checkbox(ui.CheckboxOptions{Label: "Checkbox", Checked: s.checked}, s.action(func() { s.checked = !s.checked }), fixed(14))
					r.Spacer(ui.Fill())
				})
				p.Spacer(ui.Cells(1))
				p.TextInput(ui.TextInputOptions{Label: "Search", Value: s.input, Placeholder: "type to filter…", Focused: s.editing}, fixed(1))
				p.Spacer(ui.Cells(1))
				p.Meter(ui.MeterOptions{Label: "Slider", Value: s.slider, Heat: ref(false), Color: &t.Primary})
				p.Progress(ui.ProgressOptions{Label: "Progress", Value: 37, Max: ref(120.), ShowCount: true})
			})
			left.Panel(ui.PanelOptions{Title: "Table Widget"}, func(p *ui.Container) {
				rows := []any{}
				for _, r := range [][4]string{{"src", "4.2 KB", "dir", "2m ago"}, {"test", "1.1 KB", "dir", "5m ago"}, {"package.json", "1.2 KB", "file", "10m ago"}, {"README.md", "3.4 KB", "file", "1h ago"}, {"bun.lockb", "12 KB", "file", "1h ago"}} {
					rows = append(rows, object{"name": r[0], "size": r[1], "type": r[2], "modified": r[3]})
				}
				s.dataTable(p, "components.files", rows, []dataColumn{dc("name", "Name", 0, 10, &t.Primary, false), dc("size", "Size", 9, 0, nil, true), dc("type", "Type", 6, 0, nil, false), dc("modified", "Modified", 10, 0, &t.Muted, true)}, true, false, true)
			})
			left.Panel(ui.PanelOptions{Title: "Log Viewer", Layout: fixed(11)}, func(p *ui.Container) {
				data := arr(s.sample["logs"])
				pane := s.pane("components.logs", len(data))
				pane.log = true
				entries := []ui.LogEntry{}
				for _, v := range data {
					d := obj(v)
					entries = append(entries, ui.LogEntry{Time: scalar(d["time"]), Level: scalar(d["level"]), Message: scalar(d["message"]), Meta: "{" + scalar(d["meta"]) + "}"})
				}
				p.Log(ui.LogOptions{Entries: entries, FromEnd: pane.offset, Scrollbar: true}, ui.ScrollHandlers{OnFocus: s.action(func() { s.focused[s.screen] = "components.logs" }), OnScroll: func(d int) {
					if !s.overlay() {
						s.focused[s.screen] = "components.logs"
						pane.offset = clamp(pane.offset-d, 0, len(data)-1)
					}
				}})
			})
		})
		r.Column(ui.ColumnOptions{Layout: ui.Layout{Gap: 1}}, func(right *ui.Container) {
			right.Panel(ui.PanelOptions{Title: "Process Tree", Layout: fixed(13)}, func(p *ui.Container) {
				row(p, ui.Cells(1), 0, func(r *ui.Container) {
					r.StyledText("Name", ui.TextStyle{Fg: &t.Muted, Bold: true})
					r.StyledText("CPU%   MEM%", ui.TextStyle{Fg: &t.Muted, Bold: true, Align: ui.AlignRight})
				})
				pane := s.pane("components.tree", 8)
				p.Tree(ui.TreeOptions{Nodes: processTree(), Selected: &pane.selected, Offset: &pane.offset, FollowSelection: true}, s.scrollHandlers("components.tree", pane))
			})
			right.Panel(ui.PanelOptions{Title: "Sparklines & Gauges", Layout: fixed(12)}, func(p *ui.Container) {
				p.Sparkline(ui.SparklineWidgetOptions{Label: "CPU ", Values: values(c["history"]), Text: percent(num(c["total"])), Color: &t.Success})
				p.Sparkline(ui.SparklineWidgetOptions{Label: "Mem ", Values: values(m["history"]), Text: percent(num(m["used"]) / num(m["total"])), Color: &t.Warning})
				p.Sparkline(ui.SparklineWidgetOptions{Label: "Net ", Values: values(n["downHistory"]), Text: bytes(num(n["downRate"]), 2) + "/s", Color: &t.Primary})
				p.Spacer(ui.Cells(1))
				row(p, ui.Fr(1), 2, func(r *ui.Container) {
					r.Gauge(ui.GaugeOptions{Value: num(c["total"]), Label: percent(num(c["total"]))})
					r.Donut(ui.DonutOptions{Segments: []ui.DonutSegment{{Value: num(m["used"]), Color: &t.Primary, Label: "Used"}, {Value: num(m["available"]), Color: &t.Warning, Label: "Free"}}})
				})
			})
			right.Panel(ui.PanelOptions{Title: "Lists & Badges"}, func(p *ui.Container) {
				row(p, ui.Cells(1), 1, func(r *ui.Container) {
					r.Badge(ui.BadgeOptions{Text: "active", Color: &t.Success}, fixed(10))
					r.Badge(ui.BadgeOptions{Text: "idle", Color: &t.Warning, Variant: ui.BadgeSubtle}, fixed(8))
					r.Badge(ui.BadgeOptions{Text: "failed", Color: &t.Danger, Variant: ui.BadgeOutline}, fixed(10))
					r.Spacer(ui.Fill())
				})
				p.Spacer(ui.Cells(1))
				pane := s.pane("components.list", 4)
				p.List(ui.ListOptions{Items: []ui.ListItem{{Label: "apps/demo", Color: &t.Primary}, {Label: "packages/hqtui"}, {Label: "apps/web"}, {Label: "docs"}}, Selected: &pane.selected, Offset: &pane.offset, FollowSelection: true, Bullet: "▸", Scrollbar: true}, s.scrollHandlers("components.list", pane))
			})
		})
	})
}
