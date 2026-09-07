package demo

import (
	"fmt"
	ui "github.com/profullstack/hqtui/ports/go"
	"io"
	"reflect"
	"strings"
	"testing"
)

func TestHTTPPaneUsesFinalViewport(t *testing.T) {
	s := newState(false, 1337)
	s.screen = 1
	paths := []any{}
	for i := 0; i < 50; i++ {
		paths = append(paths, object{"path": fmt.Sprintf("/route-%03d", i), "count": i})
	}
	obj(obj(s.sample["telemetry"])["http"])["topPaths"] = paths
	pane := s.pane("traffic.paths", 50)
	pane.selected = 49
	frame := ui.RenderToScreen(200, 60, "dark", s.render)
	x, y, found := frame.Find("/route-049")
	if !found {
		t.Fatal("last HTTP path is not visible")
	}
	for _, region := range frame.Regions {
		if region.OnClick != nil && x >= region.Rect.X && x < region.Rect.X+region.Rect.Width && y >= region.Rect.Y && y < region.Rect.Y+region.Rect.Height {
			if pane.offset != 50-region.Rect.Height {
				t.Fatalf("offset %d does not match final height %d", pane.offset, region.Rect.Height)
			}
			region.OnClick(0, 0, "left")
			if pane.selected != pane.offset {
				t.Fatal("no-header click selected wrong row")
			}
			return
		}
	}
	t.Fatal("HTTP path table has no hit region")
}

func TestAllScreensThemesAndSizes(t *testing.T) {
	s := newState(false, 1337)
	for screen, name := range screens {
		for theme, themeName := range themes {
			t.Run(name+"/"+themeName, func(t *testing.T) {
				s.screen = screen
				s.theme = theme
				frame := ui.RenderToScreen(120, 40, themeName, s.render)
				title := []string{"CPU Overview", "Protocols", "Active Sessions", "Connections", "Filesystems", "Buttons & Inputs", "Braille (2×4", "Theme ", "Last Events", "Full-screen churn"}[screen]
				if !frame.Contains("hqtui") || !frame.Contains(title) {
					t.Fatal("missing screen header")
				}
			})
		}
		for _, size := range [][2]int{{1, 1}, {20, 5}, {40, 12}, {80, 24}, {160, 50}} {
			s.screen = screen
			frame := ui.RenderToScreen(size[0], size[1], "dark", s.render)
			if frame.Width != size[0] || frame.Height != size[1] {
				t.Fatal("bad dimensions")
			}
		}
	}
}
func TestSimulationRepeatableAndBounded(t *testing.T) {
	a, b, c := newState(false, 42), newState(false, 42), newState(false, 43)
	if !reflect.DeepEqual(a.sample, b.sample) {
		t.Fatal("seed not deterministic")
	}
	if reflect.DeepEqual(a.sample, c.sample) {
		t.Fatal("seed ignored")
	}
	for i := 0; i < 500; i++ {
		a.simulate()
	}
	if len(arr(obj(a.sample["cpu"])["history"])) > 240 {
		t.Fatal("unbounded history")
	}
}
func TestOverlayPriority(t *testing.T) {
	s := newState(false, 42)
	s.key("f3", "")
	if s.key("q", "q") || s.filter != "q" {
		t.Fatal("filter key escaped")
	}
	s.key("escape", "")
	s.key("ctrl+k", "")
	s.key("t", "themes")
	s.key("enter", "")
	if s.screen != 7 {
		t.Fatal("palette did not select theme screen")
	}
	s.key("f1", "")
	if s.key("q", "q") {
		t.Fatal("help did not capture q")
	}
	if !s.key("q", "q") {
		t.Fatal("quit ignored")
	}
}
func TestEditAndPause(t *testing.T) {
	s := newState(false, 42)
	s.screen = 8
	s.key("e", "e")
	s.key("q", "q")
	s.key("1", "1")
	if s.input != "q1" || s.screen != 8 {
		t.Fatal("editing triggered a shortcut")
	}
	s.key("escape", "")
	s.key("space", " ")
	if !s.paused {
		t.Fatal("pause ignored")
	}
}
func TestIndependentPanes(t *testing.T) {
	s := newState(false, 42)
	ui.RenderToScreen(160, 55, "dark", s.render)
	process, log := s.panes["dashboard.processes"], s.panes["dashboard.logs"]
	if process == nil || log == nil {
		t.Fatal("missing panes")
	}
	process.move(20)
	if log.selected != 0 {
		t.Fatal("shared pane state")
	}
	frame := ui.RenderToScreen(160, 55, "dark", s.render)
	regions := []ui.HitRegion{}
	for _, r := range frame.Regions {
		if r.OnScroll != nil {
			regions = append(regions, r)
		}
	}
	if len(regions) < 2 {
		t.Fatal("missing scroll regions")
	}
	regions[1].OnScroll(-3)
	if log.offset != 3 || log.selected != 0 {
		t.Fatal("wheel ignored")
	}
}
func TestOptions(t *testing.T) {
	for _, args := range [][]string{{"--fps", "0"}, {"--interval", "NaN"}, {"--width", "99999"}, {"--seed", "-1"}, {"--ticks", "-1"}, {"--theme", "no"}, {"--sim", "--real"}} {
		if _, err := parse(args, io.Discard); err == nil {
			t.Errorf("accepted %v", args)
		}
	}
}
func TestRealStartsEmpty(t *testing.T) {
	s := newState(true, 1337)
	if len(arr(s.sample["processes"])) != 0 || len(arr(obj(s.sample["telemetry"])["sessions"])) != 0 {
		t.Fatal("real mode contains simulated rows")
	}
}
func TestCounterResets(t *testing.T) {
	if counterRate(100, 50, 2, true) != 25 || counterRate(10, 50, 1, true) != 0 || counterRate(100, 0, 1, false) != 0 || counterRate(100, 0, 0, true) != 0 {
		t.Fatal("counter rate mismatch")
	}
}
func TestFilterAndSort(t *testing.T) {
	s := newState(false, 1)
	s.filter = "node"
	s.sort = 1
	rows := s.processes()
	for i, row := range rows {
		if !strings.Contains(strings.ToLower(str(obj(row)["name"])+str(obj(row)["command"])), "node") {
			t.Fatal("filter ignored")
		}
		if i > 0 && num(obj(rows[i-1])["mem"]) < num(obj(row)["mem"]) {
			t.Fatal("sort ignored")
		}
	}
}
