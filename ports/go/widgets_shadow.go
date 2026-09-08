package hqtui

// A drop shadow cast by a region onto whatever is behind it.
//
// The point is that it dims what it covers rather than painting over it: a
// shadow that filled its band with a flat colour would erase the dashboard
// underneath, which is the opposite of what a shadow is for. Every covered cell
// keeps its own character and its own hue, and only loses some of its light.

type ShadowOptions struct {
	// OffsetX and OffsetY are how far the shadow falls. The zero value casts
	// nothing, so a caller who wants the usual one-cell shadow says so.
	OffsetX int
	OffsetY int
	// Amount is 0-1: how much light the covered cells lose.
	Amount float64
	// Color paints instead of dimming what is underneath.
	//
	// For a shadow falling on empty background, where there is nothing to dim
	// and a flat colour is cheaper and reads the same.
	Color *Color
}

// DimRect darkens every cell in a region, keeping its character and its hue.
//
// Towards black rather than towards the theme's background: on a light theme
// the background *is* the light, so dimming towards it would make the shadow
// brighter than the page it falls on.
func DimRect(s Surface, x, y, width, height int, amount float64) {
	t := amount
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	black := RGB(0, 0, 0)
	b := s.Buffer()
	for row := 0; row < height; row++ {
		for col := 0; col < width; col++ {
			ax := s.Rect.X + x + col
			ay := s.Rect.Y + y + row
			if ax < s.Clip.X || ay < s.Clip.Y ||
				ax >= s.Clip.X+s.Clip.Width || ay >= s.Clip.Y+s.Clip.Height {
				continue
			}
			i := b.Index(ax, ay)
			b.Fg[i] = b.Fg[i].Mix(black, t)
			b.Bg[i] = b.Bg[i].Mix(black, t)
		}
	}
}

// DrawShadow casts a shadow from rect onto s.
//
// The shadow is the band the region would cover if it were moved by the offset,
// minus the region itself. Drawn before the region is, so it never falls on top
// of it.
func DrawShadow(s Surface, rect Rect, o ShadowOptions) {
	if s.IsEmpty() {
		return
	}
	dx, dy := o.OffsetX, o.OffsetY
	if dx == 0 && dy == 0 {
		return
	}
	amount := o.Amount

	paint := func(x, y, w, h int) {
		if w <= 0 || h <= 0 {
			return
		}
		if o.Color != nil {
			s.FillRect(x, y, w, h, Style{Bg: o.Color}, 32)
		} else {
			DimRect(s, x, y, w, h, amount)
		}
	}

	// The shadow is the moved region minus the original, which splits into two
	// rectangles that do not touch: the rows the move added, at the moved
	// region's full width, and then the columns it added over the rows the two
	// still share. Cutting it any other way overlaps at the corner, and a corner
	// dimmed twice reads as a smudge rather than an edge.
	tx, ty := rect.X+dx, rect.Y+dy
	if dy > 0 {
		paint(tx, rect.Y+rect.Height, rect.Width, dy)
	} else if dy < 0 {
		paint(tx, ty, rect.Width, -dy)
	}

	y0 := max(rect.Y, ty)
	shared := min(rect.Y+rect.Height, ty+rect.Height) - y0
	if shared > 0 {
		if dx > 0 {
			paint(rect.X+rect.Width, y0, dx, shared)
		} else if dx < 0 {
			paint(tx, y0, -dx, shared)
		}
	}
}
