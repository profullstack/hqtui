package hqtui

import (
	"fmt"
	"strings"
)

// Render a view to an in-memory screen. No TTY, no escape codes, no timers —
// which is what makes TUI code written with this library actually testable.
//
//	screen := hqtui.RenderToScreen(80, 24, "dark", func(ui *hqtui.Container) {
//		ui.Panel(hqtui.PanelOptions{Title: "CPU"}, func(p *hqtui.Container) {
//			p.Text("72%")
//		})
//	})
//	if !screen.Contains("72%") { t.Error("missing") }

type CellSnapshot struct {
	Char  string
	Fg    Color
	Bg    Color
	Attrs Attrs
}

type RenderedScreen struct {
	Width  int
	Height int
	Buffer *FrameBuffer
	Theme  Theme
	// Regions are the mouse regions the view registered, in draw order. They
	// let a test assert that a widget is actually reachable by the wheel or a
	// click, which is otherwise only observable by running a real terminal.
	Regions []HitRegion
	// FocusCount is how many controls joined the Tab order.
	FocusCount int
}

// Text is the plain text, one line per row, trailing spaces trimmed.
func (s *RenderedScreen) Text() string { return s.Buffer.Text() }

// Line is one row of plain text.
func (s *RenderedScreen) Line(y int) string { return trimEndSpace(s.Buffer.RowText(y)) }

// ANSI is everything with colors — paste into a terminal to see it.
func (s *RenderedScreen) ANSI() string {
	empty := NewFrameBuffer(s.Width, s.Height)
	return NewEncoder(EncoderOptions{Colors: ColorTrueColor}).Encode(empty, s.Buffer, true).Output
}

func (s *RenderedScreen) Cell(x, y int) CellSnapshot {
	i := s.Buffer.Index(x, y)
	value := s.Buffer.Chars[i]
	char := CellText(value)
	if value == Continuation {
		char = ""
	} else if value == 0 {
		char = " "
	}
	return CellSnapshot{Char: char, Fg: s.Buffer.Fg[i], Bg: s.Buffer.Bg[i], Attrs: s.Buffer.Attrs[i]}
}

// Find returns the column and row of the first occurrence, and whether it was
// found. The column counts cells, not bytes: a row with a wide glyph in it has
// more bytes than columns.
func (s *RenderedScreen) Find(needle string) (int, int, bool) {
	for y := 0; y < s.Height; y++ {
		row := s.Buffer.RowText(y)
		if at := strings.Index(row, needle); at != -1 {
			return len([]rune(row[:at])), y, true
		}
	}
	return 0, 0, false
}

func (s *RenderedScreen) Contains(needle string) bool {
	_, _, ok := s.Find(needle)
	return ok
}

// RenderToScreen renders a view to an in-memory screen.
func RenderToScreen(width, height int, theme string, view func(*Container)) *RenderedScreen {
	return RenderWith(width, height, theme, 0, CapabilityOverrides{}, view)
}

// RenderCollapsedToText renders with adjacent panel borders merged, as
// Options.CollapseBorders does for a running app.
func RenderCollapsedToText(width, height int, theme string, view func(*Container)) string {
	return renderWithCollapse(width, height, theme, 0, CapabilityOverrides{}, true, view).Text()
}

// RenderCollapsedToScreen is the same, returning the whole screen. Cell-level
// parity against the TypeScript reference needs the buffer, not the text.
func RenderCollapsedToScreen(width, height int, theme string, view func(*Container)) *RenderedScreen {
	return renderWithCollapse(width, height, theme, 0, CapabilityOverrides{}, true, view)
}

// RenderWith is the full form: pick the frame number and override capabilities.
func RenderWith(
	width, height int, themeName string, frame int,
	overrides CapabilityOverrides, view func(*Container),
) *RenderedScreen {
	return renderWithCollapse(width, height, themeName, frame, overrides, false, view)
}

func renderWithCollapse(
	width, height int, themeName string, frame int,
	overrides CapabilityOverrides, collapse bool, view func(*Container),
) *RenderedScreen {
	theme := ResolveTheme(themeName)
	buffer := NewFrameBuffer(width, height)
	buffer.Clear(theme.Background, theme.Foreground)

	ctx := &frameCtx{
		theme:           theme,
		capabilities:    headlessCapabilities(overrides),
		width:           width,
		height:          height,
		frame:           frame,
		collapseBorders: collapse,
		invalidate:      func() {},
	}

	root := RootSurface(buffer, theme)
	container := newContainer(root, ctx, DirColumn, Layout{})
	view(container)
	container.Flush()
	for _, overlay := range ctx.overlays {
		overlay(root)
	}

	return &RenderedScreen{
		Width: width, Height: height, Buffer: buffer, Theme: theme,
		Regions: ctx.hits, FocusCount: ctx.focusCursor,
	}
}

// headlessCapabilities make a render look like a capable terminal rather than
// whatever is running the test suite — otherwise a plot silently degrades to
// ASCII in CI.
func headlessCapabilities(o CapabilityOverrides) Capabilities {
	merged := CapabilityOverrides{
		TTY: o.TTY, Colors: o.Colors, Unicode: o.Unicode, Braille: o.Braille,
		Mouse: o.Mouse, SynchronizedOutput: o.SynchronizedOutput,
	}
	if merged.TTY == nil {
		merged.TTY = ptrBool(true)
	}
	if merged.Colors == nil {
		c := ColorTrueColor
		merged.Colors = &c
	}
	if merged.Unicode == nil {
		merged.Unicode = ptrBool(true)
	}
	if merged.Braille == nil {
		merged.Braille = ptrBool(true)
	}
	return DetectCapabilitiesIn(merged, Env{}, true)
}

// RenderToText is shorthand: render and return plain text. Ideal for snapshot
// tests.
func RenderToText(width, height int, theme string, view func(*Container)) string {
	return RenderToScreen(width, height, theme, view).Text()
}

// RenderToANSI renders with colors, e.g. to write a demo screenshot to a file.
func RenderToANSI(width, height int, theme string, view func(*Container)) string {
	return RenderToScreen(width, height, theme, view).ANSI()
}

type HTMLOptions struct {
	// FontSize and Padding in pixels. Zero means 14 and 16.
	FontSize  float64
	Padding   float64
	ClassName string
	// FontFamily defaults to a stack ordered by box-drawing and Braille
	// coverage.
	FontFamily string
}

var htmlEscapes = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
var attrEscapes = strings.NewReplacer(
	"&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")

func cssColor(c Color, fallback string) string {
	if c.IsDefault() {
		return fallback
	}
	return fmt.Sprintf("#%06x", uint32(c)&0xffffff)
}

// RenderToHTML renders to standalone HTML — a real screenshot of the UI, no
// terminal needed.
func RenderToHTML(screen *RenderedScreen, o HTMLOptions) string {
	theme := screen.Theme
	bgFallback := cssColor(theme.Background, "#000")
	fgFallback := cssColor(theme.Foreground, "#fff")
	buffer := screen.Buffer
	rows := make([]string, 0, screen.Height)

	for y := 0; y < screen.Height; y++ {
		var row strings.Builder
		var run strings.Builder
		runFg, runBg, runAttrs := Color(0), Color(0), Attrs(0)
		started := false

		flush := func() {
			if run.Len() == 0 {
				return
			}
			style := "color:" + cssColor(runFg, fgFallback) + ";background:" + cssColor(runBg, bgFallback)
			if runAttrs.Has(AttrBold) {
				style += ";font-weight:700"
			}
			if runAttrs.Has(AttrDim) {
				style += ";opacity:.65"
			}
			if runAttrs.Has(AttrItalic) {
				style += ";font-style:italic"
			}
			if runAttrs.Has(AttrUnderline) {
				style += ";text-decoration:underline"
			}
			row.WriteString(`<span style="` + style + `">` + htmlEscapes.Replace(run.String()) + `</span>`)
			run.Reset()
		}

		for x := 0; x < screen.Width; x++ {
			i := buffer.Index(x, y)
			if buffer.Chars[i] == Continuation {
				continue
			}
			fg, bg, attrs := buffer.Fg[i], buffer.Bg[i], buffer.Attrs[i]
			if !started || fg != runFg || bg != runBg || attrs != runAttrs {
				flush()
				runFg, runBg, runAttrs, started = fg, bg, attrs, true
			}
			if buffer.Chars[i] == 0 {
				run.WriteByte(' ')
			} else {
				run.WriteString(CellText(buffer.Chars[i]))
			}
		}
		flush()
		rows = append(rows, row.String())
	}

	// Every one of these is spliced into an attribute, so none may be trusted.
	// Numbers are bounded, and a font stack is reduced to the characters a font
	// stack can legitimately contain — escaping alone still lets `;` open a new
	// CSS property.
	number := func(v, fallback float64) float64 {
		if v > 0 && v <= 1000 {
			return v
		}
		return fallback
	}
	fontSize := number(o.FontSize, 14)
	padding := number(o.Padding, 16)
	className := o.ClassName
	if className == "" {
		className = "hqtui-screen"
	}
	fontFamily := o.FontFamily
	if fontFamily == "" {
		fontFamily = "ui-monospace,SFMono-Regular,Menlo,'DejaVu Sans Mono'," +
			"'Liberation Mono',Consolas,'Segoe UI Symbol',monospace"
	}
	var font strings.Builder
	for _, r := range fontFamily {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
			strings.ContainsRune(" ,._'-", r) {
			font.WriteRune(r)
		}
	}

	// One <pre> with newline-separated rows: wrapping each row in its own
	// element gives the browser licence to lay out lines independently, which
	// pulls box-drawing rules apart. A single text flow tiles the grid exactly.
	return fmt.Sprintf(
		`<pre class="%s" style="background:%s;color:%s;padding:%gpx;font-size:%gpx;`+
			`line-height:%.2fpx;font-family:%s;margin:0;overflow-x:auto;border-radius:8px;`+
			`white-space:pre;font-variant-ligatures:none;-webkit-font-smoothing:antialiased">%s</pre>`,
		attrEscapes.Replace(className), bgFallback, fgFallback, padding, fontSize,
		fontSize*1.18, attrEscapes.Replace(font.String()), strings.Join(rows, "\n"),
	)
}
