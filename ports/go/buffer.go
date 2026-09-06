package hqtui

import (
	"strings"
	"unicode/utf8"
)

// The screen is one grid of cells, not a tree of widgets. Four parallel slices
// keep a frame allocation-free: no object is created per cell, ever.

// Attrs are the style attribute bits packed into a cell's 16-bit slot.
type Attrs uint16

const (
	AttrNone      Attrs = 0
	AttrBold      Attrs = 1 << 0
	AttrDim       Attrs = 1 << 1
	AttrItalic    Attrs = 1 << 2
	AttrUnderline Attrs = 1 << 3
	AttrBlink     Attrs = 1 << 4
	AttrReverse   Attrs = 1 << 5
	AttrStrike    Attrs = 1 << 6
)

func (a Attrs) Has(other Attrs) bool { return a&other == other }

// Style is a partial style. A nil field means "leave whatever is already
// there", which is what lets a widget set only the foreground of a region.
//
// The reference uses optional object properties; Go uses pointers, and the
// helpers below keep call sites from spelling out `&c` everywhere.
type Style struct {
	Fg    *Color
	Bg    *Color
	Attrs *Attrs
}

// NoStyle changes nothing.
var NoStyle = Style{}

func FG(c Color) Style              { return Style{Fg: &c} }
func BG(c Color) Style              { return Style{Bg: &c} }
func FGBG(fg, bg Color) Style       { return Style{Fg: &fg, Bg: &bg} }
func AT(a Attrs) Style              { return Style{Attrs: &a} }
func (s Style) WithFg(c Color) Style { s.Fg = &c; return s }
func (s Style) WithBg(c Color) Style { s.Bg = &c; return s }
func (s Style) WithAttrs(a Attrs) Style {
	s.Attrs = &a
	return s
}

// OptColor is the pointer form of an optional color, for building a Style from
// a value that may or may not be set.
func OptColor(c Color, set bool) *Color {
	if !set {
		return nil
	}
	return &c
}

// FrameBuffer is a grid of styled cells. It is the only thing the encoder ever
// reads.
type FrameBuffer struct {
	Width  int
	Height int
	Chars  []Cell
	Fg     []Color
	Bg     []Color
	Attrs  []Attrs
}

func NewFrameBuffer(width, height int) *FrameBuffer {
	if width < 0 {
		width = 0
	}
	if height < 0 {
		height = 0
	}
	n := width * height
	b := &FrameBuffer{
		Width:  width,
		Height: height,
		Chars:  make([]Cell, n),
		Fg:     make([]Color, n),
		Bg:     make([]Color, n),
		Attrs:  make([]Attrs, n),
	}
	b.Clear(DefaultColor, DefaultColor)
	return b
}

// Resize reuses the existing allocation when it is large enough.
func (b *FrameBuffer) Resize(width, height int) {
	if width < 0 {
		width = 0
	}
	if height < 0 {
		height = 0
	}
	if width == b.Width && height == b.Height {
		return
	}
	n := width * height
	if n > len(b.Chars) {
		b.Chars = make([]Cell, n)
		b.Fg = make([]Color, n)
		b.Bg = make([]Color, n)
		b.Attrs = make([]Attrs, n)
	}
	b.Width, b.Height = width, height
	b.Clear(DefaultColor, DefaultColor)
}

func (b *FrameBuffer) Index(x, y int) int { return y*b.Width + x }

func (b *FrameBuffer) Clear(bg, fg Color) {
	n := b.Width * b.Height
	for i := 0; i < n; i++ {
		b.Chars[i] = 32
		b.Fg[i] = fg
		b.Bg[i] = bg
		b.Attrs[i] = AttrNone
	}
}

func (b *FrameBuffer) InBounds(x, y int) bool {
	return x >= 0 && y >= 0 && x < b.Width && y < b.Height
}

func (b *FrameBuffer) applyStyle(i int, s Style) {
	if s.Fg != nil {
		b.Fg[i] = *s.Fg
	}
	if s.Bg != nil {
		b.Bg[i] = *s.Bg
	}
	if s.Attrs != nil {
		b.Attrs[i] = *s.Attrs
	}
}

// SetCell writes one already-decoded cell value and returns columns consumed.
//
// This is the only path that writes a character into the grid, and the encoder
// hands cell text straight to the terminal. Refusing unsafe values here means
// the buffer *cannot* hold a live escape, whatever the caller passes —
// including the low-level escape hatch.
func (b *FrameBuffer) SetCell(x, y int, value Cell, s Style) int {
	if !b.InBounds(x, y) {
		return 0
	}
	// Ordered so printable ASCII costs one comparison. A lead-less continuation
	// is not writable either; it would silently eat a column out of the row.
	if value >= 0x7f {
		if IsUnsafeCodepoint(rune(value)) || value == Continuation {
			value = 32
		} else if !validScalar(value) {
			value = Replacement
		}
	} else if value < 0x20 {
		value = 32
	}

	w := CellWidth(value)
	i := b.Index(x, y)
	// Overwriting the tail of a wide char to our left would orphan it.
	if b.Chars[i] == Continuation && x > 0 {
		b.Chars[i-1] = 32
	}
	b.Chars[i] = value
	b.applyStyle(i, s)

	if w == 2 {
		if x+1 < b.Width {
			b.Chars[i+1] = Continuation
			b.applyStyle(i+1, s)
		} else {
			// No room for the second half: draw a space rather than corrupt
			// the row.
			b.Chars[i] = 32
			return 1
		}
	}
	if w < 1 {
		return 1
	}
	return w
}

// A cell value only holds a real character if it is a Unicode scalar. The
// reference reaches this check via lone surrogates, which UTF-8 text cannot
// contain; a caller using the raw SetCell escape hatch still can, so the guard
// stays.
func validScalar(value Cell) bool {
	if value >= ClusterBase {
		return true
	}
	r := rune(value)
	return r <= utf8.MaxRune && !(r >= 0xd800 && r <= 0xdfff)
}

// Write draws text left to right and returns the number of columns written.
func (b *FrameBuffer) Write(x, y int, text string, s Style) int {
	return b.WriteCapped(x, y, text, s, 1<<30)
}

func (b *FrameBuffer) WriteCapped(x, y int, text string, s Style, maxWidth int) int {
	if y < 0 || y >= b.Height {
		return 0
	}
	cx, used := x, 0
	for _, g := range Graphemes(text) {
		if used+g.Width > maxWidth {
			break
		}
		if cx >= b.Width || cx+g.Width > b.Width {
			break
		}
		if cx >= 0 {
			b.SetCell(cx, y, g.Value, s)
		}
		cx += g.Width
		used += g.Width
	}
	return used
}

func (b *FrameBuffer) FillRect(x, y, w, h int, ch Cell, s Style) {
	x0, y0 := max(0, x), max(0, y)
	x1, y1 := min(b.Width, x+w), min(b.Height, y+h)
	for cy := y0; cy < y1; cy++ {
		for cx := x0; cx < x1; cx++ {
			b.SetCell(cx, cy, ch, s)
		}
	}
}

// StyleRect restyles a region without touching its characters.
func (b *FrameBuffer) StyleRect(x, y, w, h int, s Style) {
	x0, y0 := max(0, x), max(0, y)
	x1, y1 := min(b.Width, x+w), min(b.Height, y+h)
	for cy := y0; cy < y1; cy++ {
		for cx := x0; cx < x1; cx++ {
			b.applyStyle(b.Index(cx, cy), s)
		}
	}
}

// CopyFrom copies another buffer's contents (same dimensions assumed).
func (b *FrameBuffer) CopyFrom(other *FrameBuffer) {
	n := min(b.Width*b.Height, other.Width*other.Height)
	copy(b.Chars[:n], other.Chars[:n])
	copy(b.Fg[:n], other.Fg[:n])
	copy(b.Bg[:n], other.Bg[:n])
	copy(b.Attrs[:n], other.Attrs[:n])
}

// RowText is the plain text of one row, for tests and headless rendering.
func (b *FrameBuffer) RowText(y int) string {
	if y < 0 || y >= b.Height {
		return ""
	}
	var out strings.Builder
	for x := 0; x < b.Width; x++ {
		v := b.Chars[b.Index(x, y)]
		if v == Continuation {
			continue
		}
		if v == 0 {
			out.WriteByte(' ')
		} else {
			out.WriteString(CellText(v))
		}
	}
	return out.String()
}

// Text is the whole buffer as plain text, trailing whitespace trimmed per row.
func (b *FrameBuffer) Text() string {
	rows := make([]string, 0, b.Height)
	for y := 0; y < b.Height; y++ {
		rows = append(rows, trimEndSpace(b.RowText(y)))
	}
	return strings.Join(rows, "\n")
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
