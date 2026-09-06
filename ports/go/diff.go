package hqtui

import (
	"strconv"
	"strings"
)

// Turns two framebuffers into the smallest practical stream of escape
// sequences. The encoder keeps a model of the terminal's current pen so no
// redundant SGR is emitted.

// Rewriting up to this many unchanged cells is cheaper than the escape sequence
// needed to jump over them, so neighbouring dirty spans get merged.
const gapMerge = 5

type terminalState struct {
	x, y int
	// known is false after anything that makes the cursor position unknowable.
	known bool
	fg    Color
	bg    Color
	attrs Attrs
}

func freshState() terminalState {
	return terminalState{x: -1, y: -1, known: false, fg: DefaultColor, bg: DefaultColor}
}

type EncodeResult struct {
	// Output is the bytes to hand to stdout.
	Output       string
	ChangedCells int
	// DirtyRows is the number of rows that contained at least one change.
	DirtyRows int
}

type EncoderOptions struct {
	Colors ColorDepth
	// Monochrome drains all color, keeping attributes.
	Monochrome bool
}

type Encoder struct {
	state      terminalState
	parts      strings.Builder
	Colors     ColorDepth
	Monochrome bool
}

func NewEncoder(o EncoderOptions) *Encoder {
	return &Encoder{state: freshState(), Colors: o.Colors, Monochrome: o.Monochrome}
}

// InvalidateState forgets what we believe about the terminal; the next write
// re-states everything.
func (e *Encoder) InvalidateState() {
	e.state = freshState()
	e.parts.WriteString("\x1b[0m")
}

func (e *Encoder) fgSeq(c Color) string {
	if e.Colors == ColorNone {
		return ""
	}
	if c.IsDefault() {
		return AnsiFgDefault
	}
	col := c
	if e.Monochrome {
		col = c.Grayscale()
	}
	switch e.Colors {
	case ColorTrueColor:
		return FgTrue(col.R(), col.G(), col.B())
	case ColorAnsi256:
		return Fg256(col.To256())
	}
	return Fg16(col.To16())
}

func (e *Encoder) bgSeq(c Color) string {
	if e.Colors == ColorNone {
		return ""
	}
	if c.IsDefault() {
		return AnsiBgDefault
	}
	col := c
	if e.Monochrome {
		col = c.Grayscale()
	}
	switch e.Colors {
	case ColorTrueColor:
		return BgTrue(col.R(), col.G(), col.B())
	case ColorAnsi256:
		return Bg256(col.To256())
	}
	return Bg16(col.To16())
}

func (e *Encoder) applyStyle(fg, bg Color, attrs Attrs) {
	s := &e.state
	if s.fg == fg && s.bg == bg && s.attrs == attrs {
		return
	}

	// Attributes can only be added cheaply; removing one means a full reset.
	if removed := s.attrs &^ attrs; removed != 0 {
		e.parts.WriteString("\x1b[0m")
		s.attrs = AttrNone
		s.fg = DefaultColor
		s.bg = DefaultColor
	}

	if added := attrs &^ s.attrs; added != 0 {
		codes := make([]int, 0, 7)
		for _, pair := range []struct {
			bit  Attrs
			code int
		}{
			{AttrBold, 1}, {AttrDim, 2}, {AttrItalic, 3}, {AttrUnderline, 4},
			{AttrBlink, 5}, {AttrReverse, 7}, {AttrStrike, 9},
		} {
			if added&pair.bit != 0 {
				codes = append(codes, pair.code)
			}
		}
		if len(codes) > 0 {
			e.parts.WriteString("\x1b[")
			for i, code := range codes {
				if i > 0 {
					e.parts.WriteByte(';')
				}
				e.parts.WriteString(strconv.Itoa(code))
			}
			e.parts.WriteByte('m')
		}
		s.attrs = attrs
	}

	if s.fg != fg {
		e.parts.WriteString(e.fgSeq(fg))
		s.fg = fg
	}
	if s.bg != bg {
		e.parts.WriteString(e.bgSeq(bg))
		s.bg = bg
	}
}

func (e *Encoder) moveCursor(x, y int) {
	s := &e.state
	if s.known && s.y == y {
		switch {
		case s.x == x:
			return
		case x > s.x && x-s.x <= 3:
			// Short hop: cheaper than a full CUP, and never repaints cells.
			e.parts.WriteString(MoveRight(x - s.x))
		case x == 0:
			e.parts.WriteByte('\r')
		default:
			e.parts.WriteString(MoveToColumn(x))
		}
	} else {
		e.parts.WriteString(MoveTo(x, y))
	}
	s.x, s.y, s.known = x, y, true
}

// Encode writes the difference between prev and next. Pass full to repaint
// every cell (first frame, resize, or after a redraw request).
func (e *Encoder) Encode(prev, next *FrameBuffer, full bool) EncodeResult {
	e.parts.Reset()
	changed, dirtyRows := 0, 0

	w, h := next.Width, next.Height
	sameSize := prev.Width == w && prev.Height == h
	repaint := full || !sameSize
	if repaint {
		e.InvalidateState()
	}

	// differs reports whether a cell actually changed. When the sizes disagree
	// the previous frame cannot be indexed with this frame's stride, so every
	// cell counts as different.
	differs := func(i int) bool {
		if !sameSize {
			return true
		}
		return next.Chars[i] != prev.Chars[i] || next.Fg[i] != prev.Fg[i] ||
			next.Bg[i] != prev.Bg[i] || next.Attrs[i] != prev.Attrs[i]
	}
	// dirtyAt reports whether a cell needs emitting, which a full repaint forces
	// even for cells that are unchanged. The two are deliberately separate:
	// ChangedCells reports real churn, not repaint volume.
	dirtyAt := func(i int) bool { return repaint || differs(i) }

	for y := 0; y < h; y++ {
		rowStart := y * w
		x := 0
		rowDirty := false

		for x < w {
			if !dirtyAt(rowStart + x) {
				x++
				continue
			}

			// Walk left onto the lead cell if we landed on a wide char's tail.
			start := x
			for start > 0 && next.Chars[rowStart+start] == Continuation {
				start--
			}

			// Extend the run while cells are dirty, tolerating short gaps.
			end, clean, probe := start, 0, start
			for probe < w {
				if dirtyAt(rowStart + probe) {
					end, clean = probe, 0
				} else {
					clean++
					if clean > gapMerge {
						break
					}
				}
				probe++
			}

			e.moveCursor(start, y)
			for cx := start; cx <= end; cx++ {
				j := rowStart + cx
				value := next.Chars[j]
				if value == Continuation {
					continue // emitted with its lead cell
				}
				e.applyStyle(next.Fg[j], next.Bg[j], next.Attrs[j])
				if value == 0 {
					e.parts.WriteByte(' ')
				} else {
					e.parts.WriteString(CellText(value))
				}
				e.state.x += max(1, CellWidth(value))
				if differs(j) {
					changed++
				}
			}
			// Writing the final column may have triggered autowrap; stop
			// trusting x.
			if e.state.x >= w {
				e.state.known = false
			}
			rowDirty = true
			x = end + 1
		}
		if rowDirty {
			dirtyRows++
		}
	}

	return EncodeResult{Output: e.parts.String(), ChangedCells: changed, DirtyRows: dirtyRows}
}

// EncodeFull is a one-shot encode of a whole buffer, e.g. for a screenshot.
func EncodeFull(buffer *FrameBuffer, o EncoderOptions) string {
	empty := NewFrameBuffer(buffer.Width, buffer.Height)
	return NewEncoder(o).Encode(empty, buffer, true).Output
}
