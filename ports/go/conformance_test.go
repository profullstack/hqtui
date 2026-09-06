package hqtui

// Replays the shared conformance fixtures, which are generated from the
// TypeScript reference implementation. A failure here means this port and the
// reference disagree about something observable — which is a bug in one of
// them, never an acceptable difference.
//
// Regenerate the fixtures with `bun ports/conformance/generate.ts`.

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// fixture reads and decodes one golden file. `any` rather than typed structs:
// the corpus is heterogeneous by design, and a struct per group would be more
// code than the assertions it serves.
func fixture(t *testing.T, name string) any {
	t.Helper()
	path := filepath.Join("..", "conformance", "fixtures", name+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("cannot read %s: %v", path, err)
	}
	var out any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("cannot parse %s: %v", path, err)
	}
	return out
}

type obj = map[string]any

func get(v any, key string) any {
	m, ok := v.(obj)
	if !ok {
		return nil
	}
	return m[key]
}

func arr(v any) []any {
	a, _ := v.([]any)
	return a
}

func num(v any) float64 {
	f, ok := v.(float64)
	if !ok {
		return math.NaN()
	}
	return f
}

func i(v any) int      { return int(num(v)) }
func u32(v any) uint32 { return uint32(int64(num(v))) }
func str(v any) string {
	s, _ := v.(string)
	return s
}
func boolean(v any) bool {
	b, _ := v.(bool)
	return b
}

func has(v any, key string) bool {
	m, ok := v.(obj)
	if !ok {
		return false
	}
	x, present := m[key]
	return present && x != nil
}

func colorOf(v any) Color { return Color(u32(v)) }

func optColor(v any, key string) *Color {
	if !has(v, key) {
		return nil
	}
	c := colorOf(get(v, key))
	return &c
}

func optFloat(v any, key string) *float64 {
	if !has(v, key) {
		return nil
	}
	f := num(get(v, key))
	return &f
}

func optInt(v any, key string) *int {
	if !has(v, key) {
		return nil
	}
	n := i(get(v, key))
	return &n
}

func alignOf(v any) Align { return ParseAlign(str(v)) }

func approx(t *testing.T, got, want float64, what string) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 && !(math.IsNaN(got) && math.IsNaN(want)) {
		t.Errorf("%s: %v != %v", what, got, want)
	}
}

// decodeRLE expands a run-length encoded plane, [[count, value], …].
func decodeRLE(plane any) []uint32 {
	var out []uint32
	for _, run := range arr(plane) {
		r := arr(run)
		count, value := i(r[0]), u32(r[1])
		for k := 0; k < count; k++ {
			out = append(out, value)
		}
	}
	return out
}

// assertBuffer compares a rendered buffer against a fixture's planes.
func assertBuffer(t *testing.T, b *FrameBuffer, want any, what string) {
	t.Helper()
	if b.Width != i(get(want, "width")) || b.Height != i(get(want, "height")) {
		t.Errorf("%s: size %dx%d != %dx%d", what, b.Width, b.Height,
			i(get(want, "width")), i(get(want, "height")))
		return
	}

	n := b.Width * b.Height
	chars := decodeRLE(get(want, "chars"))
	fg := decodeRLE(get(want, "fg"))
	bg := decodeRLE(get(want, "bg"))
	attrs := decodeRLE(get(want, "attrs"))
	if len(chars) != n {
		t.Errorf("%s: fixture has %d cells, buffer has %d", what, len(chars), n)
		return
	}

	// Text first: when a port drifts, the row text says *what* is wrong in one
	// line, where a cell index only says where.
	wantText := arr(get(want, "text"))
	for y := 0; y < b.Height; y++ {
		if got := b.RowText(y); got != str(wantText[y]) {
			t.Errorf("%s: row %d\n got %q\nwant %q", what, y, got, str(wantText[y]))
			return
		}
	}

	// A cluster's cell value indexes the interning process's own table, so the
	// fixture renumbers them by first appearance. Rebuild the same numbering
	// here, and check the cluster texts line up too.
	var local []Cell
	renumber := func(value Cell) uint32 {
		if value < ClusterBase || value == Continuation {
			return uint32(value)
		}
		for k, v := range local {
			if v == value {
				return uint32(ClusterBase) + uint32(k)
			}
		}
		local = append(local, value)
		return uint32(ClusterBase) + uint32(len(local)-1)
	}

	for idx := 0; idx < n; idx++ {
		x, y := idx%b.Width, idx/b.Width
		if got := renumber(b.Chars[idx]); got != chars[idx] {
			t.Errorf("%s: char at %d,%d: %d != %d", what, x, y, got, chars[idx])
			return
		}
		if uint32(b.Fg[idx]) != fg[idx] {
			t.Errorf("%s: fg at %d,%d: %d != %d", what, x, y, b.Fg[idx], fg[idx])
			return
		}
		if uint32(b.Bg[idx]) != bg[idx] {
			t.Errorf("%s: bg at %d,%d: %d != %d", what, x, y, b.Bg[idx], bg[idx])
			return
		}
		if uint32(b.Attrs[idx]) != attrs[idx] {
			t.Errorf("%s: attrs at %d,%d: %d != %d", what, x, y, b.Attrs[idx], attrs[idx])
			return
		}
	}

	wantClusters := arr(get(want, "clusters"))
	if len(local) != len(wantClusters) {
		t.Errorf("%s: %d clusters, want %d", what, len(local), len(wantClusters))
		return
	}
	for k, v := range local {
		if CellText(v) != str(wantClusters[k]) {
			t.Errorf("%s: cluster %d: %q != %q", what, k, CellText(v), str(wantClusters[k]))
		}
	}
}

// ---------------------------------------------------------------------- color

func TestColorMatchesReference(t *testing.T) {
	f := fixture(t, "color")

	for _, c := range arr(get(f, "hex")) {
		if got := Hex(str(get(c, "input"))); uint32(got) != u32(get(c, "color")) {
			t.Errorf("Hex(%q) = %d, want %d", str(get(c, "input")), got, u32(get(c, "color")))
		}
	}
	for _, c := range arr(get(f, "hexNumber")) {
		if got := HexN(u32(get(c, "input"))); uint32(got) != u32(get(c, "color")) {
			t.Errorf("HexN: %d != %d", got, u32(get(c, "color")))
		}
	}
	for _, c := range arr(get(f, "rgb")) {
		got := RGB(i(get(c, "r")), i(get(c, "g")), i(get(c, "b")))
		if uint32(got) != u32(get(c, "color")) {
			t.Errorf("RGB: %d != %d", got, u32(get(c, "color")))
		}
	}
	for _, c := range arr(get(f, "ansi256")) {
		if got := Ansi256(i(get(c, "index"))); uint32(got) != u32(get(c, "color")) {
			t.Errorf("Ansi256: %d != %d", got, u32(get(c, "color")))
		}
	}
	if uint32(DefaultColor) != u32(get(f, "defaultColor")) {
		t.Error("DefaultColor differs")
	}

	mixes := append(append([]any{}, arr(get(f, "mix"))...), arr(get(f, "mixDefault"))...)
	for _, c := range mixes {
		got := colorOf(get(c, "a")).Mix(colorOf(get(c, "b")), num(get(c, "t")))
		if uint32(got) != u32(get(c, "out")) {
			t.Errorf("Mix(%d, %d, %v) = %d, want %d",
				u32(get(c, "a")), u32(get(c, "b")), num(get(c, "t")), got, u32(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "alpha")) {
		got := colorOf(get(c, "fg")).Alpha(colorOf(get(c, "bg")), num(get(c, "a")))
		if uint32(got) != u32(get(c, "out")) {
			t.Errorf("Alpha: %d != %d", got, u32(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "lighten")) {
		if got := colorOf(get(c, "c")).Lighten(num(get(c, "amount"))); uint32(got) != u32(get(c, "out")) {
			t.Errorf("Lighten: %d != %d", got, u32(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "darken")) {
		if got := colorOf(get(c, "c")).Darken(num(get(c, "amount"))); uint32(got) != u32(get(c, "out")) {
			t.Errorf("Darken: %d != %d", got, u32(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "luminance")) {
		approx(t, colorOf(get(c, "c")).Luminance(), num(get(c, "out")), "Luminance")
	}
	for _, c := range arr(get(f, "contrast")) {
		approx(t, colorOf(get(c, "a")).Contrast(colorOf(get(c, "b"))), num(get(c, "out")), "Contrast")
	}
	for _, c := range arr(get(f, "grayscale")) {
		if got := colorOf(get(c, "c")).Grayscale(); uint32(got) != u32(get(c, "out")) {
			t.Errorf("Grayscale: %d != %d", got, u32(get(c, "out")))
		}
	}
	if uint32(DefaultColor.Grayscale()) != u32(get(f, "grayscaleDefault")) {
		t.Error("Grayscale of default differs")
	}

	for _, c := range arr(get(f, "to256")) {
		if got := colorOf(get(c, "c")).To256(); got != i(get(c, "out")) {
			t.Errorf("To256(%d) = %d, want %d", u32(get(c, "c")), got, i(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "to16")) {
		if got := colorOf(get(c, "c")).To16(); got != i(get(c, "out")) {
			t.Errorf("To16(%d) = %d, want %d", u32(get(c, "c")), got, i(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "from256")) {
		if got := From256(i(get(c, "index"))); uint32(got) != u32(get(c, "out")) {
			t.Errorf("From256(%d) = %d, want %d", i(get(c, "index")), got, u32(get(c, "out")))
		}
	}

	g := get(f, "gradient")
	var stops []Color
	for _, s := range arr(get(g, "stops")) {
		stops = append(stops, colorOf(s))
	}
	gradient := GradientOf(stops)
	for _, s := range arr(get(g, "samples")) {
		if got := gradient.Sample(num(get(s, "t"))); uint32(got) != u32(get(s, "out")) {
			t.Errorf("Gradient.Sample(%v) = %d, want %d", num(get(s, "t")), got, u32(get(s, "out")))
		}
	}
	wantSteps := arr(get(g, "steps"))
	steps := gradient.Steps(len(wantSteps))
	for k, want := range wantSteps {
		if uint32(steps[k]) != u32(want) {
			t.Errorf("Gradient.Steps[%d]: %d != %d", k, steps[k], u32(want))
		}
	}
	if got := NewGradient(HexN(0xff0000)).Sample(0.5); uint32(got) != u32(get(g, "single")) {
		t.Errorf("single-stop gradient: %d != %d", got, u32(get(g, "single")))
	}
	if got := NewGradient().Sample(0.5); uint32(got) != u32(get(g, "empty")) {
		t.Errorf("empty gradient: %d != %d", got, u32(get(g, "empty")))
	}
}

// -------------------------------------------------------------------- unicode

func TestUnicodeMatchesReference(t *testing.T) {
	f := fixture(t, "unicode")

	for _, c := range arr(get(f, "charWidth")) {
		cp := rune(i(get(c, "cp")))
		if got := CharWidth(cp); got != i(get(c, "width")) {
			t.Errorf("CharWidth(U+%04X) = %d, want %d", cp, got, i(get(c, "width")))
		}
	}
	for _, c := range arr(get(f, "stringWidth")) {
		if got := StringWidth(str(get(c, "s"))); got != i(get(c, "width")) {
			t.Errorf("StringWidth(%q) = %d, want %d", str(get(c, "s")), got, i(get(c, "width")))
		}
	}
	for _, c := range arr(get(f, "truncate")) {
		got := Truncate(str(get(c, "s")), i(get(c, "max")))
		if got != str(get(c, "out")) {
			t.Errorf("Truncate(%q, %d) = %q, want %q",
				str(get(c, "s")), i(get(c, "max")), got, str(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "truncateCustomEllipsis")) {
		got := TruncateWith(str(get(c, "s")), i(get(c, "max")), str(get(c, "ellipsis")))
		if got != str(get(c, "out")) {
			t.Errorf("TruncateWith: %q != %q", got, str(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "fit")) {
		got := Fit(str(get(c, "s")), i(get(c, "w")), alignOf(get(c, "align")))
		if got != str(get(c, "out")) {
			t.Errorf("Fit(%q, %d, %s) = %q, want %q",
				str(get(c, "s")), i(get(c, "w")), str(get(c, "align")), got, str(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "wrap")) {
		got := Wrap(str(get(c, "s")), i(get(c, "width")))
		want := arr(get(c, "out"))
		if len(got) != len(want) {
			t.Errorf("Wrap(%q, %d): %d lines, want %d — %q",
				str(get(c, "s")), i(get(c, "width")), len(got), len(want), got)
			continue
		}
		for k := range want {
			if got[k] != str(want[k]) {
				t.Errorf("Wrap(%q, %d)[%d] = %q, want %q",
					str(get(c, "s")), i(get(c, "width")), k, got[k], str(want[k]))
			}
		}
	}
	for _, c := range arr(get(f, "stripUnsafe")) {
		if got := StripUnsafe(str(get(c, "s"))); got != str(get(c, "out")) {
			t.Errorf("StripUnsafe: %q != %q", got, str(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "graphemes")) {
		cells := Graphemes(str(get(c, "s")))
		want := arr(get(c, "cells"))
		if len(cells) != len(want) {
			t.Errorf("Graphemes(%q): %d cells, want %d", str(get(c, "s")), len(cells), len(want))
			continue
		}
		for k, w := range want {
			if cells[k].Width != i(get(w, "width")) {
				t.Errorf("grapheme %d width: %d != %d", k, cells[k].Width, i(get(w, "width")))
			}
			if (cells[k].Value >= ClusterBase) != boolean(get(w, "cluster")) {
				t.Errorf("grapheme %d clustered: %v", k, cells[k].Value >= ClusterBase)
			}
			if CellText(cells[k].Value) != str(get(w, "text")) {
				t.Errorf("grapheme %d text: %q != %q", k, CellText(cells[k].Value), str(get(w, "text")))
			}
		}
	}

	if uint32(ClusterBase) != u32(get(get(f, "constants"), "clusterBase")) {
		t.Error("ClusterBase differs")
	}
	if uint32(Continuation) != u32(get(get(f, "constants"), "continuation")) {
		t.Error("Continuation differs")
	}
}

// ----------------------------------------------------------------------- ansi

func TestAnsiMatchesReference(t *testing.T) {
	f := fixture(t, "ansi")
	for _, c := range arr(get(f, "stripAnsi")) {
		if got := StripAnsi(str(get(c, "s"))); got != str(get(c, "out")) {
			t.Errorf("StripAnsi(%q) = %q, want %q", str(get(c, "s")), got, str(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "moveTo")) {
		if got := MoveTo(i(get(c, "x")), i(get(c, "y"))); got != str(get(c, "out")) {
			t.Errorf("MoveTo: %q != %q", got, str(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "setTitle")) {
		if got := SetTitle(str(get(c, "title"))); got != str(get(c, "out")) {
			t.Errorf("SetTitle: %q != %q", got, str(get(c, "out")))
		}
	}
}

// --------------------------------------------------------------------- layout

func constraintOf(v any) Constraint {
	c := Constraint{Min: optInt(v, "min"), Max: optInt(v, "max"), Intrinsic: optInt(v, "intrinsic")}
	if raw, ok := v.(obj); ok {
		switch s := raw["size"].(type) {
		case float64:
			size := Cells(int(s))
			c.Size = &size
		case string:
			size := ParseSize(s)
			c.Size = &size
		}
	}
	return c
}

func rectOf(v any) Rect {
	return Rect{X: i(get(v, "x")), Y: i(get(v, "y")),
		Width: i(get(v, "width")), Height: i(get(v, "height"))}
}

func TestLayoutMatchesReference(t *testing.T) {
	f := fixture(t, "layout")

	for _, c := range arr(get(f, "solve")) {
		var items []Constraint
		for _, it := range arr(get(c, "items")) {
			items = append(items, constraintOf(it))
		}
		got := Solve(i(get(c, "total")), items, i(get(c, "gap")))
		want := arr(get(c, "out"))
		if len(got) != len(want) {
			t.Errorf("Solve(total=%d): %d results, want %d", i(get(c, "total")), len(got), len(want))
			continue
		}
		for k := range want {
			if got[k] != i(want[k]) {
				t.Errorf("Solve(total=%d, gap=%d)[%d] = %d, want %d",
					i(get(c, "total")), i(get(c, "gap")), k, got[k], i(want[k]))
			}
		}
	}

	for _, c := range arr(get(f, "stack")) {
		var items []Constraint
		for _, it := range arr(get(c, "items")) {
			items = append(items, constraintOf(it))
		}
		dir := DirColumn
		if str(get(c, "direction")) == "row" {
			dir = DirRow
		}
		got := Stack(rectOf(get(c, "rect")), items, dir, i(get(c, "gap")))
		want := arr(get(c, "out"))
		for k := range want {
			if got[k] != rectOf(want[k]) {
				t.Errorf("Stack %s [%d] = %+v, want %+v",
					str(get(c, "direction")), k, got[k], rectOf(want[k]))
			}
		}
	}

	for _, c := range arr(get(f, "inset")) {
		var p Padding
		switch v := get(c, "padding").(type) {
		case float64:
			p = PadAll(int(v))
		case []any:
			if len(v) == 2 {
				p = PadAxes(i(v[0]), i(v[1]))
			} else {
				p = Padding{Top: i(v[0]), Right: i(v[1]), Bottom: i(v[2]), Left: i(v[3])}
			}
		}
		if got := rectOf(get(c, "rect")).Inset(p); got != rectOf(get(c, "out")) {
			t.Errorf("Inset = %+v, want %+v", got, rectOf(get(c, "out")))
		}
	}

	for _, c := range arr(get(f, "intersect")) {
		got := rectOf(get(c, "a")).Intersect(rectOf(get(c, "b")))
		if got != rectOf(get(c, "out")) {
			t.Errorf("Intersect = %+v, want %+v", got, rectOf(get(c, "out")))
		}
	}
}

// --------------------------------------------------------------------- buffer

func styleOf(op any) Style {
	s := Style{Fg: optColor(op, "fg"), Bg: optColor(op, "bg")}
	if has(op, "attrs") {
		a := Attrs(i(get(op, "attrs")))
		s.Attrs = &a
	}
	return s
}

func applyOps(b *FrameBuffer, ops []any) {
	for _, op := range ops {
		style := styleOf(op)
		x, y := i(get(op, "x")), i(get(op, "y"))
		switch str(get(op, "op")) {
		case "write":
			maxWidth := 1 << 30
			if has(op, "maxWidth") {
				maxWidth = i(get(op, "maxWidth"))
			}
			b.WriteCapped(x, y, str(get(op, "text")), style, maxWidth)
		case "setCell":
			b.SetCell(x, y, Cell(u32(get(op, "value"))), style)
		case "fillRect":
			b.FillRect(x, y, i(get(op, "w")), i(get(op, "h")), Cell(u32(get(op, "ch"))), style)
		case "styleRect":
			b.StyleRect(x, y, i(get(op, "w")), i(get(op, "h")), style)
		case "clear":
			bg, fg := DefaultColor, DefaultColor
			if has(op, "bg") {
				bg = colorOf(get(op, "bg"))
			}
			if has(op, "fg") {
				fg = colorOf(get(op, "fg"))
			}
			b.Clear(bg, fg)
		}
	}
}

func TestBufferMatchesReference(t *testing.T) {
	for _, c := range arr(fixture(t, "buffer")) {
		name := str(get(c, "name"))
		b := NewFrameBuffer(i(get(c, "width")), i(get(c, "height")))
		applyOps(b, arr(get(c, "ops")))
		assertBuffer(t, b, get(c, "result"), name)
	}
}

// ----------------------------------------------------------------------- diff

func TestDiffMatchesReference(t *testing.T) {
	for _, c := range arr(fixture(t, "diff")) {
		name := str(get(c, "name"))
		w, h := i(get(c, "width")), i(get(c, "height"))
		prev, next := NewFrameBuffer(w, h), NewFrameBuffer(w, h)
		applyOps(prev, arr(get(c, "before")))
		applyOps(next, arr(get(c, "after")))

		colors, _ := ParseColorDepth(str(get(c, "colors")))
		enc := NewEncoder(EncoderOptions{Colors: colors, Monochrome: boolean(get(c, "monochrome"))})
		got := enc.Encode(prev, next, boolean(get(c, "full")))
		want := get(c, "result")

		if got.Output != str(get(want, "output")) {
			t.Errorf("%s: output\n got %q\nwant %q", name, got.Output, str(get(want, "output")))
		}
		if got.ChangedCells != i(get(want, "changedCells")) {
			t.Errorf("%s: changedCells %d != %d", name, got.ChangedCells, i(get(want, "changedCells")))
		}
		if got.DirtyRows != i(get(want, "dirtyRows")) {
			t.Errorf("%s: dirtyRows %d != %d", name, got.DirtyRows, i(get(want, "dirtyRows")))
		}
	}
}

// ---------------------------------------------------------------------- theme

func TestThemeMatchesReference(t *testing.T) {
	f := fixture(t, "theme")

	for _, entry := range arr(get(f, "themes")) {
		key := str(get(entry, "key"))
		want := get(entry, "theme")
		th := ResolveTheme(key)

		if th.Name != str(get(want, "name")) {
			t.Errorf("%s: name %q != %q", key, th.Name, str(get(want, "name")))
		}
		if th.Dark != boolean(get(want, "dark")) {
			t.Errorf("%s: dark differs", key)
		}
		for field, got := range map[string]Color{
			"background": th.Background, "surface": th.Surface,
			"foreground": th.Foreground, "muted": th.Muted,
			"primary": th.Primary, "secondary": th.Secondary, "accent": th.Accent,
			"success": th.Success, "warning": th.Warning, "danger": th.Danger, "info": th.Info,
			"border": th.Border, "borderFocused": th.BorderFocused, "title": th.Title,
			"selection": th.Selection, "selectionText": th.SelectionText, "cursor": th.Cursor,
		} {
			if uint32(got) != u32(get(want, field)) {
				t.Errorf("%s: %s = %d, want %d", key, field, got, u32(get(want, field)))
			}
		}
		for k, c := range arr(get(want, "graph")) {
			if uint32(th.Graph[k]) != u32(c) {
				t.Errorf("%s: graph[%d] differs", key, k)
			}
		}
		for k, c := range arr(get(want, "heat")) {
			if uint32(th.Heat[k]) != u32(c) {
				t.Errorf("%s: heat[%d] differs", key, k)
			}
		}
	}

	for _, c := range arr(get(f, "resolve")) {
		if got := ResolveTheme(str(get(c, "name"))).Name; got != str(get(c, "resolved")) {
			t.Errorf("ResolveTheme(%q) = %q, want %q", str(get(c, "name")), got, str(get(c, "resolved")))
		}
	}
	for _, c := range arr(get(f, "elevate")) {
		th := ResolveTheme(str(get(c, "theme")))
		if got := Elevate(th, num(get(c, "amount"))); uint32(got) != u32(get(c, "out")) {
			t.Errorf("Elevate(%s): %d != %d", str(get(c, "theme")), got, u32(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "heatColor")) {
		th := ResolveTheme(str(get(c, "theme")))
		if got := HeatColor(th, num(get(c, "ratio"))); uint32(got) != u32(get(c, "out")) {
			t.Errorf("HeatColor(%s): %d != %d", str(get(c, "theme")), got, u32(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "seriesColor")) {
		th := ResolveTheme(str(get(c, "theme")))
		if got := SeriesColor(th, i(get(c, "index"))); uint32(got) != u32(get(c, "out")) {
			t.Errorf("SeriesColor(%s, %d): %d != %d",
				str(get(c, "theme")), i(get(c, "index")), got, u32(get(c, "out")))
		}
	}
}
