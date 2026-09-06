package hqtui

// Conformance for the drawing layer: the Braille canvas, the block-element
// ramps, and Surface.Box, which every panel in the library goes through.

import "testing"

// scene builds a framebuffer plus a root surface over it, cleared to the theme
// the way the renderer does before any widget draws.
func scene(width, height int, themeName string) (*FrameBuffer, Surface) {
	theme := ResolveTheme(themeName)
	buffer := NewFrameBuffer(width, height)
	buffer.Clear(theme.Background, theme.Foreground)
	return buffer, RootSurface(buffer, theme)
}

func TestBrailleMatchesReference(t *testing.T) {
	for _, c := range arr(fixture(t, "braille")) {
		name := str(get(c, "name"))
		canvas := NewBrailleCanvas(i(get(c, "cols")), i(get(c, "rows")))

		for _, op := range arr(get(c, "ops")) {
			f := func(k string) float64 { return num(get(op, k)) }
			points := func() []Point {
				var out []Point
				for _, p := range arr(get(op, "points")) {
					pair := arr(p)
					out = append(out, Point{X: num(pair[0]), Y: num(pair[1])})
				}
				return out
			}
			switch str(get(op, "op")) {
			case "pixel":
				canvas.Pixel(f("x"), f("y"))
			case "unset":
				canvas.Unset(f("x"), f("y"))
			case "line":
				canvas.Line(f("x0"), f("y0"), f("x1"), f("y1"))
			case "hline":
				canvas.HLine(f("y"), f("x0"), f("x1"))
			case "vline":
				canvas.VLine(f("x"), f("y0"), f("y1"))
			case "rect":
				canvas.Rect(f("x0"), f("y0"), f("x1"), f("y1"))
			case "fillRect":
				canvas.FillRect(f("x0"), f("y0"), f("x1"), f("y1"))
			case "circle":
				canvas.Circle(f("cx"), f("cy"), f("r"))
			case "polyline":
				canvas.Polyline(points())
			case "fillUnder":
				canvas.FillUnder(points(), f("baseline"))
			default:
				t.Fatalf("unknown braille op %q", str(get(op, "op")))
			}
		}

		want := arr(get(c, "cells"))
		k := 0
		for row := 0; row < canvas.Rows; row++ {
			for col := 0; col < canvas.Cols; col++ {
				if uint32(canvas.Cell(col, row)) != u32(want[k]) {
					t.Errorf("%s: cell %d,%d = %d, want %d",
						name, col, row, canvas.Cell(col, row), u32(want[k]))
				}
				k++
			}
		}
		if k != len(want) {
			t.Errorf("%s: %d cells, want %d", name, k, len(want))
		}

		lines := canvas.Lines()
		for k, want := range arr(get(c, "lines")) {
			if lines[k] != str(want) {
				t.Errorf("%s: line %d = %q, want %q", name, k, lines[k], str(want))
			}
		}
	}
}

func TestBlocksMatchReference(t *testing.T) {
	f := fixture(t, "blocks")
	for _, c := range arr(get(f, "verticalGlyph")) {
		got := VerticalGlyph(num(get(c, "ratio")), ParseFillMode(str(get(c, "mode"))))
		if got != str(get(c, "out")) {
			t.Errorf("VerticalGlyph(%v, %s) = %q, want %q",
				num(get(c, "ratio")), str(get(c, "mode")), got, str(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "horizontalGlyph")) {
		got := HorizontalGlyph(num(get(c, "ratio")), ParseFillMode(str(get(c, "mode"))))
		if got != str(get(c, "out")) {
			t.Errorf("HorizontalGlyph(%v, %s) = %q, want %q",
				num(get(c, "ratio")), str(get(c, "mode")), got, str(get(c, "out")))
		}
	}
	for _, c := range arr(get(f, "shadeGlyph")) {
		got := ShadeGlyph(num(get(c, "ratio")), boolean(get(c, "unicode")))
		if got != str(get(c, "out")) {
			t.Errorf("ShadeGlyph(%v, %v) = %q, want %q",
				num(get(c, "ratio")), boolean(get(c, "unicode")), got, str(get(c, "out")))
		}
	}
}

func TestSurfaceBoxMatchesReference(t *testing.T) {
	for _, c := range arr(fixture(t, "surface")) {
		name := str(get(c, "name"))
		buffer, surface := scene(i(get(c, "width")), i(get(c, "height")), str(get(c, "theme")))

		spec := get(c, "box")
		o := BoxOptions{
			Title:    str(get(spec, "title")),
			Subtitle: str(get(spec, "subtitle")),
			Footer:   str(get(spec, "footer")),
		}
		if has(spec, "border") {
			o.Border = ParseBorder(str(get(spec, "border")))
		}
		if has(spec, "titleAlign") {
			o.TitleAlign = alignOf(get(spec, "titleAlign"))
		}

		inner := surface.Box(o)
		if inner.Rect != rectOf(get(c, "innerRect")) {
			t.Errorf("%s: inner rect %+v, want %+v", name, inner.Rect, rectOf(get(c, "innerRect")))
		}
		assertBuffer(t, buffer, get(c, "result"), name)
	}
}
