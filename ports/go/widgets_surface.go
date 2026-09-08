package hqtui

// Two primitives for the space behind a widget rather than the widget itself.
//
// Modal already blanks the region it is about to draw into, but it does it
// privately, so anything else that floats — a custom overlay, a popover, a
// tooltip somebody wrote themselves — has no way to say "this region is mine
// now". These make that sayable.

type ClearOptions struct {
	// Background is what to leave behind. Nil means the theme's background.
	Background *Color
}

// DrawClear resets a region to empty, so an overlay can draw over what was
// there.
//
// Without this an overlay is drawn *into* whatever it lands on: the cells it
// does not touch keep the widget underneath, and a dialog ends up with someone
// else's table showing through the gaps between its words.
func DrawClear(s Surface, o ClearOptions) {
	if s.IsEmpty() {
		return
	}
	bg := s.Theme.Background
	if o.Background != nil {
		bg = *o.Background
	}
	fg := s.Theme.Foreground
	attrs := AttrNone
	s.Fill(Style{Fg: &fg, Bg: &bg, Attrs: &attrs})
}

type FillOptions struct {
	// Symbol is repeated across the region. A wide one is stepped over rather
	// than written per column, since each glyph owns a continuation cell.
	Symbol string
	Fg     *Color
	Bg     *Color
	Attrs  *Attrs
}

// DrawFill floods a region with one repeated symbol and style.
func DrawFill(s Surface, o FillOptions) {
	if s.IsEmpty() {
		return
	}
	symbol := o.Symbol
	if symbol == "" {
		symbol = " "
	}
	style := Style{Fg: o.Fg, Bg: o.Bg, Attrs: o.Attrs}
	glyph := []rune(symbol)[0]
	glyphWidth := StringWidth(symbol)
	if glyphWidth < 1 {
		glyphWidth = 1
	}
	// A one-cell symbol is what Fill is for. Anything wider has to be stepped
	// over rather than written per column: each glyph owns a continuation cell,
	// and writing the next one on top of it leaves a row of half-characters.
	if glyphWidth == 1 {
		s.FillRect(0, 0, s.Width(), s.Height(), style, Cell(glyph))
		return
	}
	for y := 0; y < s.Height(); y++ {
		// The last glyph is dropped rather than clipped when the region does
		// not divide evenly: half a wide character is not a fill, it is damage.
		for x := 0; x+glyphWidth <= s.Width(); x += glyphWidth {
			s.Glyph(x, y, glyph, style)
		}
	}
}
