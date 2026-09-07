package hqtui

import (
	"math"
	"strconv"
	"strings"
)

// Sizes are resolved once per frame with a single pass. No manual coordinate
// arithmetic should ever appear in application code.
//
//	Cells(12)     12 columns/rows
//	Percent(40)   40% of the container
//	Fr(2)         two shares of whatever is left over
//	Auto          whatever the widget says it needs
//	Fill          same as Fr(1)
//
// The reference spells these as numbers and strings ("2fr", "40%"). Both work
// here: Cells(12), or ParseSize("2fr").

type sizeKind int

const (
	sizeCells sizeKind = iota
	sizePercent
	sizeFr
	sizeAuto
	sizeFill
)

// Size is how much space an item wants along the main axis.
type Size struct {
	kind  sizeKind
	value float64
}

func Cells(n int) Size       { return Size{kind: sizeCells, value: float64(n)} }
func Percent(n float64) Size { return Size{kind: sizePercent, value: n} }
func Fr(n float64) Size      { return Size{kind: sizeFr, value: n} }
func Auto() Size             { return Size{kind: sizeAuto} }
func Fill() Size             { return Size{kind: sizeFill} }

// ParseSize reads the string spelling the reference API uses. Anything
// unrecognisable becomes zero cells, matching Number.parseFloat's NaN fallback.
func ParseSize(spec string) Size {
	s := strings.TrimSpace(spec)
	switch s {
	case "auto":
		return Auto()
	case "fill":
		return Fill()
	}
	if rest, ok := strings.CutSuffix(s, "%"); ok {
		return Percent(leadingFloat(rest))
	}
	if rest, ok := strings.CutSuffix(s, "fr"); ok {
		n := leadingFloat(rest)
		if !(n > 0) {
			n = 1
		}
		return Fr(n)
	}
	return Cells(int(leadingFloat(s)))
}

// leadingFloat is Number.parseFloat: read as much of a leading number as parses.
func leadingFloat(s string) float64 {
	s = strings.TrimSpace(s)
	end, seenDigit, seenDot := 0, false, false
	for end < len(s) {
		c := s[end]
		switch {
		case (c == '+' || c == '-') && end == 0:
		case c >= '0' && c <= '9':
			seenDigit = true
		case c == '.' && !seenDot:
			seenDot = true
		default:
			goto done
		}
		end++
	}
done:
	if !seenDigit {
		return 0
	}
	v, err := strconv.ParseFloat(s[:end], 64)
	if err != nil {
		return 0
	}
	return v
}

// Constraint is what one item contributes to a layout solve. A nil Size means
// Auto; nil Min/Max/Intrinsic mean unset.
type Constraint struct {
	Size      *Size
	Min       *int
	Max       *int
	Intrinsic *int
}

func Sized(s Size) Constraint { return Constraint{Size: &s} }

func (c Constraint) WithMin(n int) Constraint       { c.Min = &n; return c }
func (c Constraint) WithMax(n int) Constraint       { c.Max = &n; return c }
func (c Constraint) WithIntrinsic(n int) Constraint { c.Intrinsic = &n; return c }

// MinMax is the reference's `minmax(min, max)` helper.
func MinMax(lo, hi int) Constraint { return Sized(Fill()).WithMin(lo).WithMax(hi) }

// Rect is a rectangle in absolute buffer coordinates.
type Rect struct {
	X, Y, Width, Height int
}

func (r Rect) IsEmpty() bool { return r.Width <= 0 || r.Height <= 0 }

func (r Rect) Contains(x, y int) bool {
	return x >= r.X && y >= r.Y && x < r.X+r.Width && y < r.Y+r.Height
}

func (r Rect) Intersect(o Rect) Rect {
	x, y := max(r.X, o.X), max(r.Y, o.Y)
	x2, y2 := min(r.X+r.Width, o.X+o.Width), min(r.Y+r.Height, o.Y+o.Height)
	return Rect{X: x, Y: y, Width: max(0, x2-x), Height: max(0, y2-y)}
}

// Padding in the CSS shorthand orders, clockwise from the top.
type Padding struct{ Top, Right, Bottom, Left int }

func PadAll(v int) Padding     { return Padding{v, v, v, v} }
func PadAxes(v, h int) Padding { return Padding{v, h, v, h} }

// Inset shrinks a rect by padding, never past zero.
func (r Rect) Inset(p Padding) Rect {
	return Rect{
		X:      r.X + p.Left,
		Y:      r.Y + p.Top,
		Width:  max(0, r.Width-p.Left-p.Right),
		Height: max(0, r.Height-p.Top-p.Bottom),
	}
}

// Direction is which way a container lays its children out. The names carry a
// Dir prefix because `Row` and `Column` are wanted for the table row helper and
// the layout container.
type Direction int

const (
	DirColumn Direction = iota
	DirRow
)

type resolved struct {
	value, fr, min, max float64
}

func parseConstraint(c Constraint, total int) resolved {
	minV := 0.0
	if c.Min != nil {
		minV = float64(*c.Min)
	}
	maxV := math.Inf(1)
	if c.Max != nil {
		maxV = float64(*c.Max)
	}
	size := Auto()
	if c.Size != nil {
		size = *c.Size
	}
	switch size.kind {
	case sizeCells:
		return resolved{value: size.value, fr: 0, min: minV, max: maxV}
	case sizeAuto:
		v := 0.0
		if c.Intrinsic != nil {
			v = float64(*c.Intrinsic)
		}
		return resolved{value: v, fr: 0, min: minV, max: maxV}
	case sizeFill:
		return resolved{value: 0, fr: 1, min: minV, max: maxV}
	case sizePercent:
		pct := size.value / 100
		if math.IsInf(pct, 0) || math.IsNaN(pct) {
			pct = 0
		}
		return resolved{value: roundHalfUp(float64(total) * pct), fr: 0, min: minV, max: maxV}
	default: // sizeFr
		fr := size.value
		if math.IsInf(fr, 0) || math.IsNaN(fr) || fr <= 0 {
			fr = 1
		}
		return resolved{value: 0, fr: fr, min: minV, max: maxV}
	}
}

func clampF(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

// Solve distributes total across items, honouring gaps, fractions and min/max.
// It always returns non-negative sizes that sum to at most total.
func Solve(total int, items []Constraint, gap int) []int {
	seams := make([]int, max(0, len(items)-1))
	for i := range seams {
		seams[i] = gap
	}
	return SolveWithGaps(total, items, seams)
}

// SolveWithGaps is Solve with a gap per seam, which may be negative.
//
// A negative seam is how collapsed borders work: two panels overlap by the
// column their borders share, so the pair occupies one column less than the
// sum of their widths.
func SolveWithGaps(total int, items []Constraint, gaps []int) []int {
	n := len(items)
	if n == 0 {
		return nil
	}
	gapTotal := 0
	for i := 0; i < n-1 && i < len(gaps); i++ {
		gapTotal += gaps[i]
	}
	available := max(0, total-gapTotal)
	parsed := make([]resolved, n)
	for i, c := range items {
		parsed[i] = parseConstraint(c, available)
	}

	used := 0
	frTotal := 0.0
	// -1 marks an item resolved in the flexible pass below.
	out := make([]int, n)
	for i := range out {
		out[i] = -1
	}

	for i := 0; i < n; i++ {
		p := parsed[i]
		if p.fr > 0 {
			frTotal += p.fr
		} else {
			out[i] = int(clampF(roundHalfUp(p.value), p.min, math.Min(p.max, float64(available))))
			used += out[i]
		}
	}

	free := math.Max(0, float64(available-used))
	if frTotal > 0 {
		// Two passes: clamped items give their surplus back to the rest.
		remainingFr := frTotal
		pool := free
		pending := make([]int, 0, n)
		for i := 0; i < n; i++ {
			if out[i] == -1 {
				pending = append(pending, i)
			}
		}

		for changed := true; changed && len(pending) > 0; {
			changed = false
			for _, i := range append([]int(nil), pending...) {
				p := parsed[i]
				share := 0.0
				if remainingFr > 0 {
					share = pool * p.fr / remainingFr
				}
				clamped := clampF(share, p.min, p.max)
				if clamped != share {
					out[i] = int(roundHalfUp(clamped))
					pool -= float64(out[i])
					remainingFr -= p.fr
					pending = remove(pending, i)
					changed = true
				}
			}
		}

		// Distribute what is left, giving the rounding remainder to the last.
		assigned := 0
		for k, i := range pending {
			p := parsed[i]
			exact := 0.0
			if remainingFr > 0 {
				exact = pool * p.fr / remainingFr
			}
			v := int(math.Floor(exact))
			if k == len(pending)-1 {
				v = max(0, int(pool)-assigned)
			}
			out[i] = v
			assigned += v
		}
	}

	// Overflow: shrink from the end until it fits rather than drawing outside.
	sum := 0
	for _, v := range out {
		sum += v
	}
	if sum > available {
		for i := n - 1; i >= 0 && sum > available; i-- {
			shrink := min(out[i]-int(parsed[i].min), sum-available)
			if shrink > 0 {
				out[i] -= shrink
				sum -= shrink
			}
		}
		for i := n - 1; i >= 0 && sum > available; i-- {
			shrink := min(out[i], sum-available)
			out[i] -= shrink
			sum -= shrink
		}
	}

	for i, v := range out {
		if v < 0 {
			out[i] = 0
		}
	}
	return out
}

func remove(s []int, v int) []int {
	for i, x := range s {
		if x == v {
			return append(s[:i:i], s[i+1:]...)
		}
	}
	return s
}

// Stack lays children out along one axis inside rect.
func Stack(rect Rect, items []Constraint, direction Direction, gap int) []Rect {
	seams := make([]int, max(0, len(items)-1))
	for i := range seams {
		seams[i] = gap
	}
	return StackWithGaps(rect, items, direction, seams)
}

// StackWithGaps is Stack with a gap per seam, which may be negative.
func StackWithGaps(rect Rect, items []Constraint, direction Direction, gaps []int) []Rect {
	horizontal := direction == DirRow
	total := rect.Height
	if horizontal {
		total = rect.Width
	}
	sizes := SolveWithGaps(total, items, gaps)
	out := make([]Rect, 0, len(sizes))
	offset := rect.Y
	if horizontal {
		offset = rect.X
	}
	for i, size := range sizes {
		if horizontal {
			out = append(out, Rect{X: offset, Y: rect.Y, Width: size, Height: rect.Height})
		} else {
			out = append(out, Rect{X: rect.X, Y: offset, Width: rect.Width, Height: size})
		}
		seam := 0
		if i < len(gaps) {
			seam = gaps[i]
		}
		offset += size + seam
	}
	return out
}
