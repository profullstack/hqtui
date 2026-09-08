package hqtui

import (
	"strings"
	"unicode/utf8"
)

// A clipped, translated view onto the framebuffer. Widgets only ever see a
// Surface, so nothing can draw outside the rectangle it was given.

type BorderStyle int

const (
	BorderRounded BorderStyle = iota
	BorderSingle
	BorderDouble
	BorderThick
	BorderDashed
	BorderASCII
	BorderNone
)

func ParseBorder(name string) BorderStyle {
	switch name {
	case "single":
		return BorderSingle
	case "double":
		return BorderDouble
	case "thick":
		return BorderThick
	case "dashed":
		return BorderDashed
	case "ascii":
		return BorderASCII
	case "none":
		return BorderNone
	}
	return BorderRounded
}

type BorderChars struct {
	TL, TR, BL, BR rune
	H, V           rune
	ML, MR, MT, MB rune
	Cross          rune
}

func (b BorderStyle) Chars() (BorderChars, bool) {
	switch b {
	case BorderRounded:
		return BorderChars{'╭', '╮', '╰', '╯', '─', '│', '├', '┤', '┬', '┴', '┼'}, true
	case BorderSingle:
		return BorderChars{'┌', '┐', '└', '┘', '─', '│', '├', '┤', '┬', '┴', '┼'}, true
	case BorderDouble:
		return BorderChars{'╔', '╗', '╚', '╝', '═', '║', '╠', '╣', '╦', '╩', '╬'}, true
	case BorderThick:
		return BorderChars{'┏', '┓', '┗', '┛', '━', '┃', '┣', '┫', '┳', '┻', '╋'}, true
	case BorderDashed:
		return BorderChars{'╭', '╮', '╰', '╯', '╌', '╎', '├', '┤', '┬', '┴', '┼'}, true
	case BorderASCII:
		return BorderChars{'+', '+', '+', '+', '-', '|', '+', '+', '+', '+', '+'}, true
	}
	return BorderChars{}, false
}

// Edge bits for a border glyph: 1 up, 2 right, 4 down, 8 left.
//
// Collapsing two panel borders is the union of their edges. A panel's
// top-right corner (down + left) landing on its neighbour's top-left
// (down + right) is down + left + right, which is the T that makes the two
// read as one frame.
const (
	EdgeUp    = 1
	EdgeRight = 2
	EdgeDown  = 4
	EdgeLeft  = 8
)

// partBits is the edges each part of a border carries, in the order Parts
// returns them.
var partBits = [11]int{
	EdgeRight | EdgeDown,                     // TL
	EdgeLeft | EdgeDown,                      // TR
	EdgeUp | EdgeRight,                       // BL
	EdgeUp | EdgeLeft,                        // BR
	EdgeLeft | EdgeRight,                     // H
	EdgeUp | EdgeDown,                        // V
	EdgeUp | EdgeDown | EdgeRight,            // ML
	EdgeUp | EdgeDown | EdgeLeft,             // MR
	EdgeLeft | EdgeRight | EdgeDown,          // MT
	EdgeLeft | EdgeRight | EdgeUp,            // MB
	EdgeUp | EdgeRight | EdgeDown | EdgeLeft, // Cross
}

// Parts lists a border's glyphs in the order partBits describes them.
func (b BorderChars) Parts() [11]rune {
	return [11]rune{b.TL, b.TR, b.BL, b.BR, b.H, b.V, b.ML, b.MR, b.MT, b.MB, b.Cross}
}

var allBorderStyles = []BorderStyle{
	BorderRounded, BorderSingle, BorderDouble, BorderThick, BorderDashed, BorderASCII,
}

// BorderBits returns the edges of a border glyph, and whether it is one.
//
// ASCII borders collide (every corner is '+') and the first match wins, which
// is right: the union of anything with a '+' is a '+'.
func BorderBits(ch rune) (int, bool) {
	for _, style := range allBorderStyles {
		chars, ok := style.Chars()
		if !ok {
			continue
		}
		for i, part := range chars.Parts() {
			if part == ch {
				return partBits[i], true
			}
		}
	}
	return 0, false
}

// BorderGlyph returns the glyph in style with exactly these edges.
func BorderGlyph(style BorderStyle, bits int) (rune, bool) {
	chars, ok := style.Chars()
	if !ok {
		return 0, false
	}
	parts := chars.Parts()
	for i, b := range partBits {
		if b == bits {
			return parts[i], true
		}
	}
	return 0, false
}

// TextOptions is how a run of text is drawn into a surface.
type TextOptions struct {
	Fg    *Color
	Bg    *Color
	Attrs *Attrs
	Align Align
	// NoEllipsis clips mid-word instead of truncating with an ellipsis.
	NoEllipsis bool
	// MaxWidth of 0 means "whatever room is left".
	MaxWidth int
}

func Text() TextOptions                          { return TextOptions{} }
func (o TextOptions) WithFg(c Color) TextOptions { o.Fg = &c; return o }
func (o TextOptions) WithBg(c Color) TextOptions { o.Bg = &c; return o }
func (o TextOptions) WithAttrs(a Attrs) TextOptions {
	o.Attrs = &a
	return o
}
func (o TextOptions) Aligned(a Align) TextOptions { o.Align = a; return o }

func (o TextOptions) style() Style { return Style{Fg: o.Fg, Bg: o.Bg, Attrs: o.Attrs} }

// TextFrom builds text options from a style, so a widget can pass one along.
func TextFrom(s Style) TextOptions {
	return TextOptions{Fg: s.Fg, Bg: s.Bg, Attrs: s.Attrs}
}

// BoxOptions describe a bordered box: the workhorse behind every panel.
type BoxOptions struct {
	Bg          *Color
	Border      BorderStyle
	BorderColor *Color
	Title       string
	TitleAlign  Align
	TitleColor  *Color
	// Subtitle is right-aligned text on the top border, e.g. a value or hint.
	Subtitle      string
	SubtitleColor *Color
	// Collapse merges this border with one already drawn in the same cell
	// rather than overwriting it. Set for you by the container when the app
	// asks for collapsed borders; there is no reason to pass it by hand.
	Collapse bool
	// Sides says which edges to draw. The zero value is all four, and the
	// interior follows the sides actually drawn, so a top-only box costs one
	// row rather than two.
	Sides Sides
	// NoFill skips painting the interior with Bg before drawing.
	NoFill      bool
	Footer      string
	FooterColor *Color
}

type Surface struct {
	buffer *FrameBuffer
	Rect   Rect
	Clip   Rect
	Theme  Theme
}

func NewSurface(buffer *FrameBuffer, rect Rect, theme Theme, clip *Rect) Surface {
	c := rect
	if clip != nil {
		c = rect.Intersect(*clip)
	}
	return Surface{buffer: buffer, Rect: rect, Clip: c, Theme: theme}
}

// RootSurface covers a whole framebuffer.
func RootSurface(buffer *FrameBuffer, theme Theme) Surface {
	return NewSurface(buffer, Rect{0, 0, buffer.Width, buffer.Height}, theme, nil)
}

func (s Surface) Buffer() *FrameBuffer { return s.buffer }
func (s Surface) Width() int           { return s.Rect.Width }
func (s Surface) Height() int          { return s.Rect.Height }
func (s Surface) IsEmpty() bool        { return s.Rect.IsEmpty() }

// Sub is a child surface in local coordinates, clipped to this one.
func (s Surface) Sub(x, y, width, height int) Surface {
	abs := Rect{X: s.Rect.X + x, Y: s.Rect.Y + y, Width: width, Height: height}
	return NewSurface(s.buffer, abs, s.Theme, &s.Clip)
}

// Region is a child surface from an absolute rect, as the layout solver
// produces.
func (s Surface) Region(rect Rect) Surface {
	return NewSurface(s.buffer, rect, s.Theme, &s.Clip)
}

func (s Surface) Inset(p Padding) Surface { return s.Region(s.Rect.Inset(p)) }

// HitRect is the absolute rect of this surface, for hit-testing mouse events.
func (s Surface) HitRect() Rect { return s.Rect }

func (s Surface) visible(absX, absY int) bool { return s.Clip.Contains(absX, absY) }

func (s Surface) Char(x, y int, value Cell, style Style) {
	ax, ay := s.Rect.X+x, s.Rect.Y+y
	if !s.visible(ax, ay) {
		return
	}
	s.buffer.SetCell(ax, ay, value, style)
}

// Glyph is the common case of a literal character.
func (s Surface) Glyph(x, y int, value rune, style Style) { s.Char(x, y, Cell(value), style) }

// Text draws text at local (x, y) and returns columns written.
func (s Surface) Text(x, y int, text string, o TextOptions) int {
	ay := s.Rect.Y + y
	if ay < s.Clip.Y || ay >= s.Clip.Y+s.Clip.Height {
		return 0
	}
	room := s.Width() - x
	if room < 0 {
		room = 0
	}
	limit := room
	if o.MaxWidth > 0 && o.MaxWidth < limit {
		limit = o.MaxWidth
	}
	if limit <= 0 {
		return 0
	}

	content := text
	if !o.NoEllipsis && StringWidth(content) > limit {
		content = Truncate(content, limit)
	}
	if o.Align != AlignLeft {
		content = Fit(content, limit, o.Align)
	}

	style := o.style()
	cx, written := s.Rect.X+x, 0
	for _, g := range Graphemes(content) {
		if written+g.Width > limit {
			break
		}
		if cx >= s.Clip.X && cx+g.Width <= s.Clip.X+s.Clip.Width {
			s.buffer.SetCell(cx, ay, g.Value, style)
		}
		cx += g.Width
		written += g.Width
	}
	return written
}

// TextAligned positions text within the full surface width.
func (s Surface) TextAligned(y int, text string, align Align, o TextOptions) {
	padded := Fit(Truncate(text, s.Width()), s.Width(), align)
	o.Align = AlignLeft
	s.Text(0, y, padded, o)
}

func (s Surface) Fill(style Style) { s.FillRect(0, 0, s.Width(), s.Height(), style, 32) }

func (s Surface) FillRect(x, y, w, h int, style Style, ch Cell) {
	abs := Rect{X: s.Rect.X + x, Y: s.Rect.Y + y, Width: w, Height: h}.Intersect(s.Clip)
	if abs.IsEmpty() {
		return
	}
	s.buffer.FillRect(abs.X, abs.Y, abs.Width, abs.Height, ch, style)
}

func (s Surface) StyleRect(x, y, w, h int, style Style) {
	abs := Rect{X: s.Rect.X + x, Y: s.Rect.Y + y, Width: w, Height: h}.Intersect(s.Clip)
	if abs.IsEmpty() {
		return
	}
	s.buffer.StyleRect(abs.X, abs.Y, abs.Width, abs.Height, style)
}

func (s Surface) HLine(x, y, length int, ch rune, style Style) {
	for i := 0; i < length; i++ {
		s.Glyph(x+i, y, ch, style)
	}
}

func (s Surface) VLine(x, y, length int, ch rune, style Style) {
	for i := 0; i < length; i++ {
		s.Glyph(x, y+i, ch, style)
	}
}

// Box draws a bordered box with an optional title and returns the interior
// surface. Every panel in the library goes through here.
// mergeBorder writes a border glyph, merging it with whatever border is
// already there.
//
// Only border glyphs merge. Anything else in the cell is overwritten, which
// keeps a panel drawn over a chart looking like a panel rather than growing
// junctions out of the data.
func (s Surface) mergeBorder(x, y int, ch rune, style BorderStyle, cellStyle Style) {
	ax, ay := s.Rect.X+x, s.Rect.Y+y
	if !s.visible(ax, ay) {
		return
	}
	existing := rune(s.buffer.Chars[s.buffer.Index(ax, ay)])
	before, wasBorder := BorderBits(existing)
	after, isBorder := BorderBits(ch)
	if wasBorder && isBorder && before != after {
		if merged, ok := BorderGlyph(style, before|after); ok {
			ch = merged
		}
	}
	s.Glyph(x, y, ch, cellStyle)
}

// Sides says which edges of a box to draw. The zero value is all four, so a
// caller that has never heard of this gets the box it always got.
type Sides struct {
	Top, Right, Bottom, Left bool
	// None draws no rule and insets nothing, the same as a border of BorderNone.
	// A struct of four falses would otherwise be indistinguishable from the
	// zero value, which has to mean "all".
	None bool
}

// AllSides is what a box was before partial borders existed.
func AllSides() Sides { return Sides{Top: true, Right: true, Bottom: true, Left: true} }

// NoSides draws no rule at all.
func NoSides() Sides { return Sides{None: true} }

// resolve turns the zero value into all four.
func (s Sides) resolve() Sides {
	if s.None {
		return Sides{}
	}
	if !s.Top && !s.Right && !s.Bottom && !s.Left {
		return AllSides()
	}
	return s
}

func (s Sides) any() bool { return s.Top || s.Right || s.Bottom || s.Left }

// ParseSides reads the spelling the reference API uses: "all", "none", or a
// comma-separated list of sides.
func ParseSides(spec string) Sides {
	switch strings.TrimSpace(spec) {
	case "", "all":
		return AllSides()
	case "none":
		return NoSides()
	}
	has := func(name string) bool {
		for _, part := range strings.Split(spec, ",") {
			if strings.TrimSpace(part) == name {
				return true
			}
		}
		return false
	}
	out := Sides{Top: has("top"), Right: has("right"), Bottom: has("bottom"), Left: has("left")}
	if !out.any() {
		return NoSides()
	}
	return out
}

// sideGlyph is the glyph for a cell where two edges meet, given which of them
// are drawn. A single edge has no glyph of its own, so the plain rule stands
// in: that cell is part of a run, not a corner.
func sideGlyph(style BorderStyle, bits int) (rune, bool) {
	if bits == 0 {
		return 0, false
	}
	if glyph, ok := BorderGlyph(style, bits); ok {
		return glyph, true
	}
	chars, ok := style.Chars()
	if !ok {
		return 0, false
	}
	if bits&(EdgeLeft|EdgeRight) != 0 {
		return chars.H, true
	}
	return chars.V, true
}

func (s Surface) Box(o BoxOptions) Surface {
	fg := s.Theme.Border
	if o.BorderColor != nil {
		fg = *o.BorderColor
	}
	bg := o.Bg

	if !o.NoFill && bg != nil {
		s.Fill(Style{Bg: bg})
	}

	sides := o.Sides.resolve()
	chars, hasBorder := o.Border.Chars()
	if !hasBorder || !sides.any() {
		return s.Inset(Padding{})
	}
	if s.Width() < 2 || s.Height() < 1 {
		return s.Inset(PadAll(1))
	}

	w, h := s.Width(), s.Height()
	borderStyle := Style{Fg: &fg, Bg: bg}

	// With collapsing on, a border glyph landing on another one becomes the
	// union of the two. Without it this is a plain write, so a screen that
	// never asks for collapsing renders byte for byte as it did.
	put := func(x, y int, ch rune) {
		if o.Collapse {
			s.mergeBorder(x, y, ch, o.Border, borderStyle)
		} else {
			s.Glyph(x, y, ch, borderStyle)
		}
	}
	putH := func(x, y, length int, ch rune) {
		for i := 0; i < length; i++ {
			put(x+i, y, ch)
		}
	}
	putV := func(x, y, length int, ch rune) {
		for i := 0; i < length; i++ {
			put(x, y+i, ch)
		}
	}

	// A corner belongs to the two sides that meet there, so it exists only when
	// both are drawn; where one is, the rule runs straight through the cell the
	// corner would have occupied.
	corner := func(a bool, aBit int, b bool, bBit int) (rune, bool) {
		bits := 0
		if a {
			bits |= aBit
		}
		if b {
			bits |= bBit
		}
		return sideGlyph(o.Border, bits)
	}

	if sides.Top {
		putH(1, 0, w-2, chars.H)
	}
	if ch, ok := corner(sides.Top, EdgeRight, sides.Left, EdgeDown); ok {
		put(0, 0, ch)
	}
	if ch, ok := corner(sides.Top, EdgeLeft, sides.Right, EdgeDown); ok {
		put(w-1, 0, ch)
	}
	if h > 1 {
		if sides.Bottom {
			putH(1, h-1, w-2, chars.H)
		}
		if ch, ok := corner(sides.Bottom, EdgeRight, sides.Left, EdgeUp); ok {
			put(0, h-1, ch)
		}
		if ch, ok := corner(sides.Bottom, EdgeLeft, sides.Right, EdgeUp); ok {
			put(w-1, h-1, ch)
		}
		if sides.Left {
			putV(0, 1, h-2, chars.V)
		}
		if sides.Right {
			putV(w-1, 1, h-2, chars.V)
		}
	}

	// Measured before the title is drawn: both share the top border row, and
	// the title used to be truncated against the full width and then painted
	// over by the subtitle.
	subtitle := ""
	if o.Subtitle != "" {
		subtitle = " " + o.Subtitle + " "
	}
	subtitleWidth := 0
	if subtitle != "" && StringWidth(subtitle)+4 < w {
		subtitleWidth = StringWidth(subtitle)
	}

	if o.Title != "" {
		titleColor := s.Theme.Title
		if o.TitleColor != nil {
			titleColor = *o.TitleColor
		}
		label := " " + o.Title + " "
		// The title lives in [2, limit). Reserving the width is not enough on
		// its own: right- and centre-aligned titles are positioned from the
		// panel edge, so they would still be drawn over the subtitle — and a
		// wide glyph straddling the boundary bisects it, leaving an orphaned
		// half-character. Both labels carry a space of padding, and those two
		// spaces may share a column, so the region ends one past the subtitle
		// when there is one.
		limit := w - 2
		if subtitleWidth > 0 {
			limit = w - 1 - subtitleWidth
		}
		room := max(0, limit-2)
		shown := Truncate(label, room)
		tw := StringWidth(shown)
		tx := 2
		switch o.TitleAlign {
		case AlignRight:
			tx = max(2, limit-tw)
		case AlignCenter:
			tx = max(2, min(limit-tw, (w-tw)/2))
		}
		bold := AttrBold
		s.Text(tx, 0, shown, TextOptions{Fg: &titleColor, Bg: bg, Attrs: &bold})
	}

	if subtitleWidth > 0 {
		color := s.Theme.Muted
		if o.SubtitleColor != nil {
			color = *o.SubtitleColor
		}
		s.Text(w-2-subtitleWidth, 0, subtitle, TextOptions{Fg: &color, Bg: bg})
	}

	if o.Footer != "" && h > 2 {
		foot := " " + o.Footer + " "
		if StringWidth(foot)+4 < w {
			color := s.Theme.Muted
			if o.FooterColor != nil {
				color = *o.FooterColor
			}
			s.Text(2, h-1, foot, TextOptions{Fg: &color, Bg: bg})
		}
	}

	// The interior follows the sides actually drawn.
	left, top := 0, 0
	if sides.Left {
		left = 1
	}
	if sides.Top {
		top = 1
	}
	shrinkX, shrinkY := left, top
	if sides.Right {
		shrinkX++
	}
	if sides.Bottom {
		shrinkY++
	}
	return s.Sub(left, top, max(0, w-shrinkX), max(0, h-shrinkY))
}

// firstRune is the reference's `codePointAt(0)` on a one-glyph string.
func firstRune(s string) rune {
	r, _ := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError {
		return ' '
	}
	return r
}
