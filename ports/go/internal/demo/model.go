package demo

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
)

//go:embed sample.json
var fixture []byte

var screens = []string{"dashboard", "traffic", "sessions", "network", "services", "components", "graphics", "themes", "input", "stress"}
var themes = []string{"dark", "dracula", "nord", "tokyo-night", "gruvbox", "matrix", "monochrome", "high-contrast", "light"}

type object = map[string]any

func obj(v any) object {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return object{}
}
func arr(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return nil
}
func num(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case uint64:
		return float64(n)
	}
	return 0
}
func str(v any) string {
	if v == nil {
		return "—"
	}
	if f, ok := v.(float64); ok {
		return fmt.Sprintf("%.1f", f)
	}
	return fmt.Sprint(v)
}
func values(v any) []float64 {
	out := []float64{}
	for _, x := range arr(v) {
		out = append(out, num(x))
	}
	return out
}
func push(m object, key string, v float64) {
	a := append(arr(m[key]), v)
	if len(a) > 240 {
		a = a[len(a)-240:]
	}
	m[key] = a
}
func index(a []string, key string) int {
	for i, v := range a {
		if v == key {
			return i
		}
	}
	return -1
}
func clamp(v, lo, hi int) int { return max(lo, min(v, max(lo, hi))) }
func blank(v any) any {
	switch x := v.(type) {
	case map[string]any:
		o := object{}
		for k, v := range x {
			o[k] = blank(v)
		}
		return o
	case []any:
		return []any{}
	case float64:
		return float64(0)
	case string:
		return ""
	case bool:
		return false
	}
	return nil
}
func loadSample(real bool) object {
	var sample object
	if err := json.Unmarshal(fixture, &sample); err != nil {
		panic(err)
	}
	if real {
		sample = obj(blank(sample))
		obj(sample["cpu"])["load"] = []any{0., 0., 0.}
		obj(sample["telemetry"])["http"] = nil
		obj(sample["telemetry"])["power"] = nil
	}
	return sample
}
func clone(sample object) object {
	b, _ := json.Marshal(sample)
	var result object
	_ = json.Unmarshal(b, &result)
	return result
}

type pane struct{ selected, offset, total int }

func (p *pane) move(delta int) { p.selected = clamp(p.selected+delta, 0, p.total-1) }

type state struct {
	sample                                                                              object
	screen, theme, sort                                                                 int
	real, paused, help, modal, palette, filtering, editing, checked, toggle, selectOpen bool
	filter, input, query, lastKey, lastMouse                                            string
	paletteIndex, selectIndex                                                           int
	keyLog                                                                              []any
	panes                                                                               map[string]*pane
	focused                                                                             map[int]string
	missing                                                                             []string
	tick                                                                                int
	seed                                                                                uint32
}

func newState(real bool, seed uint32) *state {
	s := &state{sample: loadSample(real), real: real, seed: seed, checked: true, toggle: true, panes: map[string]*pane{}, focused: map[int]string{}}
	if !real {
		for i := 0; i < 120; i++ {
			s.simulate()
		}
	}
	return s
}
func (s *state) pane(name string, total int) *pane {
	p := s.panes[name]
	if p == nil {
		p = &pane{}
		s.panes[name] = p
	}
	p.total = total
	p.move(0)
	if s.focused[s.screen] == "" {
		s.focused[s.screen] = name
	}
	return p
}
func (s *state) simulate() {
	s.tick++
	t := float64(s.tick) * .1
	phase := float64(s.seed%10000) / 100
	s.sample["time"] = t
	c := obj(s.sample["cpu"])
	core := []any{}
	total := 0.
	for i := 0; i < 12; i++ {
		v := math.Max(.02, math.Min(.98, .4+.22*math.Sin(t/3+phase+float64(i)*.7)))
		core = append(core, v)
		total += v
	}
	total /= 12
	c["cores"] = core
	c["total"] = total
	c["frequencyGhz"] = 2.1 + num(core[0])
	c["load"] = []any{total * 4, total * 3.5, total * 3}
	push(c, "history", total*100)
	m := obj(s.sample["memory"])
	m["used"] = num(m["total"]) * (.42 + .05*math.Sin(t/13+phase))
	m["available"] = num(m["total"]) - num(m["used"])
	m["free"] = math.Max(0, num(m["available"])-num(m["cached"])-num(m["buffers"]))
	push(m, "history", num(m["used"])/num(m["total"])*100)
	n := obj(s.sample["network"])
	for _, d := range []string{"down", "up"} {
		factor := 1.
		if d == "up" {
			factor = .35
		}
		r := (2 + math.Sin(t/2+phase)) * 1048576 * factor
		n[d+"Rate"] = r
		n[d+"Total"] = num(n[d+"Total"]) + r*.1
		n[d+"Peak"] = math.Max(num(n[d+"Peak"]), r)
		push(n, d+"History", r)
	}
	for i, p := range arr(s.sample["processes"]) {
		obj(p)["cpu"] = math.Max(0, 8+8*math.Sin(t/3+phase+float64(i)))
	}
	for i, d := range arr(s.sample["disks"]) {
		for _, dir := range []string{"read", "write"} {
			factor := 1.
			if dir == "write" {
				factor = .4
			}
			r := (1 + math.Sin(t/4+float64(i)+phase)) * 1048576 * factor
			obj(d)[dir+"Rate"] = r
			push(obj(d), dir+"History", r)
		}
	}
	obj(s.sample["system"])["uptime"] = 9254 + t
	tele := obj(s.sample["telemetry"])
	for i, v := range arr(tele["interfaces"]) {
		o := obj(v)
		o["rxRate"] = num(n["downRate"]) / float64(i+1)
		o["txRate"] = num(n["upRate"]) / float64(i+1)
		push(o, "rxHistory", num(o["rxRate"]))
		push(o, "txHistory", num(o["txRate"]))
	}
	for k, v := range map[string]float64{"netInHistory": num(n["downRate"]) / 1400, "netOutHistory": num(n["upRate"]) / 1400, "retransHistory": .1 + .1*math.Sin(t), "connectionHistory": float64(len(arr(tele["connections"]))), "sessionHistory": float64(len(arr(tele["sessions"])))} {
		push(tele, k, v)
	}
	if h := obj(tele["http"]); len(h) > 0 {
		h["requestsPerSecond"] = 60 + 30*math.Sin(t+phase)
		push(h, "history", num(h["requestsPerSecond"]))
	}
}
func (s *state) processes() []any {
	rows := []any{}
	for _, p := range arr(s.sample["processes"]) {
		o := obj(p)
		if strings.Contains(strings.ToLower(str(o["name"])+" "+str(o["command"])), strings.ToLower(s.filter)) {
			rows = append(rows, p)
		}
	}
	key := []string{"cpu", "mem", "pid", "name"}[s.sort]
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := obj(rows[i])[key], obj(rows[j])[key]
		if key == "name" {
			return str(a) < str(b)
		}
		if key == "pid" {
			return num(a) < num(b)
		}
		return num(a) > num(b)
	})
	return rows
}
func (s *state) commands() []string {
	out := []string{}
	for _, name := range append(append([]string{}, screens...), "pause", "sort CPU", "sort memory") {
		if strings.Contains(strings.ToLower(name), strings.ToLower(s.query)) {
			out = append(out, name)
		}
	}
	return out
}
func backspace(value string) string {
	r := []rune(value)
	if len(r) > 0 {
		r = r[:len(r)-1]
	}
	return string(r)
}
func appendText(value, char string) string {
	r := []rune(value + char)
	return string(r[:min(len(r), 4096)])
}
func (s *state) key(key, char string) bool {
	s.lastKey = key
	s.keyLog = append(s.keyLog, object{"event": key})
	if len(s.keyLog) > 100 {
		s.keyLog = s.keyLog[1:]
	}
	if key == "ctrl+c" {
		return true
	}
	if s.palette {
		matches := s.commands()
		switch key {
		case "escape":
			s.palette = false
		case "up":
			s.paletteIndex = max(0, s.paletteIndex-1)
		case "down":
			s.paletteIndex = clamp(s.paletteIndex+1, 0, len(matches)-1)
		case "enter":
			if len(matches) > 0 {
				action := matches[clamp(s.paletteIndex, 0, len(matches)-1)]
				if i := index(screens, action); i >= 0 {
					s.screen = i
				} else if action == "pause" {
					s.paused = !s.paused
				} else if action == "sort CPU" {
					s.sort = 0
				} else {
					s.sort = 1
				}
			}
			s.palette = false
		case "backspace":
			s.query = backspace(s.query)
			s.paletteIndex = 0
		default:
			s.query = appendText(s.query, char)
			s.paletteIndex = 0
		}
		return false
	}
	if s.help || s.modal {
		s.help = false
		s.modal = false
		return false
	}
	if s.filtering || s.editing {
		target := &s.filter
		if s.editing {
			target = &s.input
		}
		switch key {
		case "escape":
			if s.filtering {
				s.filter = ""
			}
			s.filtering = false
			s.editing = false
		case "enter":
			s.filtering = false
		case "backspace":
			*target = backspace(*target)
		default:
			*target = appendText(*target, char)
		}
		return false
	}
	if s.selectOpen {
		switch key {
		case "escape":
			s.selectOpen = false
		case "up":
			s.selectIndex = (s.selectIndex + len(themes) - 1) % len(themes)
		case "down":
			s.selectIndex = (s.selectIndex + 1) % len(themes)
		case "enter":
			s.theme = s.selectIndex
			s.selectOpen = false
		}
		return false
	}
	switch key {
	case "q", "f10":
		return true
	case "f1":
		s.help = true
	case "f2":
		s.theme = (s.theme + 1) % len(themes)
	case "f3":
		s.filtering = true
	case "f6":
		s.sort = (s.sort + 1) % 4
	case "ctrl+k":
		s.palette = true
		s.query = ""
		s.paletteIndex = 0
	case "space":
		s.paused = !s.paused
	case "enter":
		s.modal = true
	case "e":
		if s.screen == 5 || s.screen == 8 {
			s.editing = true
		}
	case "tab":
		s.screen = (s.screen + 1) % 10
	case "right":
		if s.screen == 7 {
			s.theme = (s.theme + 1) % len(themes)
		}
	case "left":
		if s.screen == 7 {
			s.theme = (s.theme + len(themes) - 1) % len(themes)
		}
	default:
		if len(key) == 1 && strings.Contains("1234567890", key) {
			s.screen = strings.Index("1234567890", key)
		} else if p := s.panes[s.focused[s.screen]]; p != nil {
			p.move(map[string]int{"up": -1, "down": 1, "pageup": -10, "pagedown": 10, "home": -1000000, "end": 1000000}[key])
		}
	}
	return false
}
