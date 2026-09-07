package demo

import (
	"fmt"
	ui "github.com/profullstack/hqtui/ports/go"
)

func (s *state) overlay() bool { return s.help || s.modal || s.palette || s.filtering }
func (s *state) action(fn func()) func() {
	return func() {
		if !s.overlay() {
			fn()
		}
	}
}
func (s *state) body(p *ui.Container) {
	switch s.screen {
	case 0:
		s.dashboard(p)
	case 5:
		s.components(p)
	case 6:
		s.graphics(p)
	case 7:
		s.themeScreen(p)
	case 8:
		s.inputScreen(p)
	case 9:
		s.stress(p)
	default:
		s.telemetry(p)
	}
}
func (s *state) render(p *ui.Container) {
	t := p.Theme()
	row(p, ui.Cells(1), 0, func(r *ui.Container) {
		r.StyledText(" hqtui.com", ui.TextStyle{Fg: &t.Title, Bold: true}, fixed(12))
		tabs := make([]string, len(screens))
		for i, name := range screens {
			tabs[i] = fmt.Sprintf("%d %s", (i+1)%10, name)
		}
		r.Tabs(ui.TabsOptions{Tabs: tabs, Active: s.screen}, func(i int) {
			if !s.overlay() {
				s.screen = i
			}
		})
		status, color := "live", t.Success
		if s.paused {
			status = "paused"
			color = t.Warning
		}
		source := "simulated"
		if s.real {
			source = "real"
		}
		r.StyledText(fmt.Sprintf("%s  %s  %.0ffps  %s ", status, source, s.fps, s.clock), ui.TextStyle{Fg: &color, Align: ui.AlignRight})
	})
	p.Spacer(ui.Cells(1))
	col(p, ui.Cells(max(0, p.Height()-4)), s.body)
	p.Spacer(ui.Cells(1))
	filter := "Filter"
	if s.filtering {
		filter = "Filter: " + s.filter + "_"
	}
	p.StatusBar(ui.StatusBarOptions{Items: []ui.StatusItem{ui.StatusKey("F1", "Help"), ui.StatusKey("F2", "Theme ("+t.Name+")"), {Key: "F3", Label: filter, Active: s.filtering}, ui.StatusKey("F6", "Sort: "+[]string{"cpu", "mem", "pid", "name"}[s.sort]), ui.StatusKey("^K", "Palette"), ui.StatusKey("Tab", "Screen"), ui.StatusKey("q", "Quit")}, Right: []ui.StatusItem{ui.Status(fmt.Sprintf("%.2fms  %d cells  %dB", s.renderMs, s.changedCells, s.outputBytes))}})
	if s.help {
		p.Modal(ui.ModalOptions{Title: "hqtui — Help", Message: "1–9/0 / Tab: screen\nF2 theme · F3 filter · F6 sort\nCtrl+K palette · Space pause\nArrows / PgUp / PgDn / Home / End: scroll\nMouse tabs, controls, selection and wheel\ne edits text · Esc finishes\nq / Ctrl+C quit · Any key closes help"}, nil)
	}
	if s.modal {
		p.Modal(ui.ModalOptions{Title: "Read-only Demo", Message: "No process will be killed and no service changed.\nPress any key to close."}, nil)
	}
	if s.palette {
		items := []ui.PaletteItem{}
		for _, name := range s.commands() {
			items = append(items, ui.PaletteItem{Label: name})
		}
		p.CommandPalette(ui.CommandPaletteOptions{Query: s.query, Items: items, Selected: s.paletteIndex})
	}
}
