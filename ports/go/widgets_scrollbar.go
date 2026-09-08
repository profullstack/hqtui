package hqtui

// A scrollbar, on its own.
//
// The renderer used to live inside the table and was reachable only by being a
// table, list, tree or log. Anything else that scrolls — a wrapped paragraph, a
// canvas, a Draw somebody wrote themselves — could not show one.
//
// This is the same drawing, lifted out and given the four edges plus state the
// caller owns. The dense widgets route through it, so there is one
// implementation and one appearance.

// ScrollbarOrientation is which edge the bar sits on, and therefore which way
// it runs.
type ScrollbarOrientation int

const (
	ScrollbarRight ScrollbarOrientation = iota
	ScrollbarLeft
	ScrollbarBottom
	ScrollbarTop
)

// IsVertical reports whether the bar runs down a column rather than across a
// row.
func (o ScrollbarOrientation) IsVertical() bool {
	return o == ScrollbarRight || o == ScrollbarLeft
}

// ScrollbarOptions is the state the caller owns: how much there is, how much of
// it is visible, and how far through it we are.
type ScrollbarOptions struct {
	Total       int
	Viewport    int
	Offset      int
	Orientation ScrollbarOrientation
}

// Thumb returns where the thumb sits and how long it is, in cells along the
// track.
//
// Split out because it is the whole of the behaviour: everything else is
// putting characters in a line. A thumb is never shorter than one cell, or it
// would vanish on a long document, and never starts past the end of the track.
//
// The thumb is as long as the visible fraction, so it needs the viewport as
// well as the track. For a table those are the same number — the bar is
// exactly as tall as the rows it describes. A bar you place yourself has no
// such guarantee, so pass the window it describes; ThumbOf keeps the
// track-is-the-viewport form the dense widgets use.
func Thumb(track, total, offset, viewport int) (start, size int) {
	if track <= 0 || total <= 0 {
		return 0, 0
	}
	visible := viewport
	if visible <= 0 {
		visible = track
	}
	if total <= visible {
		return 0, track
	}
	size = min(track, max(1, int(roundHalfUp(float64(visible)/float64(total)*float64(track)))))
	maxOffset := max(1, total-visible)
	clamped := max(0, min(offset, maxOffset))
	start = int(roundHalfUp(float64(clamped) / float64(maxOffset) * float64(track-size)))
	return max(0, min(start, track-size)), size
}

// ThumbOf is Thumb for a bar whose track is exactly the window it describes.
func ThumbOf(track, total, offset int) (start, size int) {
	return Thumb(track, total, offset, track)
}

// DrawScrollbar keeps the original signature, because the table, list, tree and
// log all call it this way and their fixtures pin the result.
func DrawScrollbar(s Surface, x, y, height, total, offset int) {
	theme := s.Theme
	track := theme.Background.Mix(theme.Border, 0.7)
	start, size := ThumbOf(height, total, offset)
	for i := 0; i < height; i++ {
		inThumb := i >= start && i < start+size
		ch := '│'
		color := track
		if inThumb {
			ch, color = '█', theme.Accent
		}
		s.Glyph(x, y+i, ch, Style{Fg: &color})
	}
}

// DrawScrollbarWidget fills the surface it is given, on whichever edge.
//
// A horizontal bar uses the half-height glyphs rather than the full block: a
// run of full blocks across a row reads as a solid rule, which is not what a
// thumb is meant to look like.
func DrawScrollbarWidget(s Surface, o ScrollbarOptions) {
	if s.Width() == 0 || s.Height() == 0 {
		return
	}
	vertical := o.Orientation.IsVertical()
	theme := s.Theme
	trackColor := theme.Background.Mix(theme.Border, 0.7)

	length := s.Width()
	if vertical {
		length = s.Height()
	}
	viewport := o.Viewport
	if viewport <= 0 {
		viewport = length
	}
	start, size := Thumb(length, o.Total, o.Offset, viewport)

	line := 0
	if vertical && o.Orientation == ScrollbarRight {
		line = s.Width() - 1
	} else if !vertical && o.Orientation == ScrollbarBottom {
		line = s.Height() - 1
	}

	for i := 0; i < length; i++ {
		inThumb := i >= start && i < start+size
		ch := '─'
		if vertical {
			ch = '│'
		}
		color := trackColor
		if inThumb {
			ch, color = '━', theme.Accent
			if vertical {
				ch = '█'
			}
		}
		if vertical {
			s.Glyph(line, i, ch, Style{Fg: &color})
		} else {
			s.Glyph(i, line, ch, Style{Fg: &color})
		}
	}
}

// OffsetForPosition reports which offset a click at position along the track
// means.
//
// The thumb centres on the click, which is what every scrollbar does and what
// makes dragging feel like dragging rather than nudging.
func OffsetForPosition(position, track, total, viewport int) int {
	visible := viewport
	if visible <= 0 {
		visible = track
	}
	if track <= 0 || total <= visible {
		return 0
	}
	_, size := Thumb(track, total, 0, visible)
	usable := max(1, track-size)
	at := max(0, min(position-size/2, usable))
	return int(roundHalfUp(float64(at) / float64(usable) * float64(total-visible)))
}
