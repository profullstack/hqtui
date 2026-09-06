package hqtui

import "unicode/utf8"

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

func Text() TextOptions                        { return TextOptions{} }
func (o TextOptions) WithFg(c Color) TextOptions   { o.Fg = &c; return o }
func (o TextOptions) WithBg(c Color) TextOptions   { o.Bg = &c; return o }
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
func (s Surface) Box(o BoxOptions) Surface {
	fg := s.Theme.Border
	if o.BorderColor != nil {
		fg = *o.BorderColor
	}
	bg := o.Bg

	if !o.NoFill && bg != nil {
		s.Fill(Style{Bg: bg})
	}

	chars, hasBorder := o.Border.Chars()
	if !hasBorder {
		return s.Inset(Padding{})
	}
	if s.Width() < 2 || s.Height() < 1 {
		return s.Inset(PadAll(1))
	}

	w, h := s.Width(), s.Height()
	borderStyle := Style{Fg: &fg, Bg: bg}

	s.Glyph(0, 0, chars.TL, borderStyle)
	s.Glyph(w-1, 0, chars.TR, borderStyle)
	s.HLine(1, 0, w-2, chars.H, borderStyle)
	if h > 1 {
		s.Glyph(0, h-1, chars.BL, borderStyle)
		s.Glyph(w-1, h-1, chars.BR, borderStyle)
		s.HLine(1, h-1, w-2, chars.H, borderStyle)
		s.VLine(0, 1, h-2, chars.V, borderStyle)
		s.VLine(w-1, 1, h-2, chars.V, borderStyle)
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

	return s.Sub(1, 1, max(0, w-2), max(0, h-2))
}

// firstRune is the reference's `codePointAt(0)` on a one-glyph string.
func firstRune(s string) rune {
	r, _ := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError {
		return ' '
	}
	return r
}
