// Package hqtui is a High Quality Terminal UI library: btop-grade dashboards
// with a one-import API, dark by default, and no dependencies outside the
// standard library.
//
// It is a native port of the TypeScript reference implementation at
// https://hqtui.com, pinned to it by a shared conformance corpus — the same
// widget arguments produce the same cells, the same colors and the same escape
// bytes in both.
package hqtui

import (
	"math"
	"strconv"
	"strings"
)

// Color packs a terminal color into a single 32-bit integer so a cell never
// needs an allocation.
//
//	0                       -> "terminal default"
//	0x1000000 | 0xRRGGBB    -> truecolor
//	0x2000000 | index       -> explicit 256-colour palette index
type Color uint32

const (
	// DefaultColor is the terminal's own foreground/background. It is never
	// emitted as an SGR color.
	DefaultColor Color = 0

	rgbFlag uint32 = 0x1000000
	idxFlag uint32 = 0x2000000
)

// RGB builds a truecolor from 0-255 components. Values outside the range wrap,
// matching the reference implementation's `& 255`.
func RGB(r, g, b int) Color {
	return Color(rgbFlag | uint32(r&255)<<16 | uint32(g&255)<<8 | uint32(b&255))
}

// Hex parses "#00d7ff" or "#0df". Anything unparseable becomes black rather
// than an error: a color is cosmetic, and a theme that fails to load is worse
// than one that is wrong.
func Hex(value string) Color {
	s := strings.TrimPrefix(strings.TrimSpace(value), "#")
	if len(s) == 3 {
		s = string([]byte{s[0], s[0], s[1], s[1], s[2], s[2]})
	}
	n, err := strconv.ParseUint(s, 16, 64)
	if err != nil {
		n = 0
	}
	return Color(rgbFlag | uint32(n)&0xffffff)
}

// HexN builds a truecolor from a packed 0xRRGGBB value.
func HexN(value uint32) Color {
	return Color(rgbFlag | value&0xffffff)
}

// Ansi256 is an explicit xterm-256 palette entry. Rarely needed; truecolor is
// quantized for you when the terminal cannot do better.
func Ansi256(index int) Color {
	return Color(idxFlag | uint32(index&255))
}

func (c Color) IsDefault() bool { return c == DefaultColor }

func (c Color) isIndexed() bool { return uint32(c)&idxFlag != 0 }

func (c Color) R() int { return int(uint32(c)>>16) & 255 }
func (c Color) G() int { return int(uint32(c)>>8) & 255 }
func (c Color) B() int { return int(uint32(c)) & 255 }

// roundHalfUp matches JavaScript's Math.round, which rounds half *up* including
// for negatives, where Go's math.Round rounds half away from zero. Every
// quantization here has to agree with the reference cell for cell, so the
// tie-break is spelled out rather than inherited.
func roundHalfUp(v float64) float64 { return math.Floor(v + 0.5) }

// Mix blends towards other. t of 0 returns c, 1 returns other. Software alpha —
// terminals have none.
func (c Color) Mix(other Color, t float64) Color {
	if c.IsDefault() || other.IsDefault() {
		if t < 0.5 {
			return c
		}
		return other
	}
	k := t
	if k < 0 {
		k = 0
	} else if k > 1 {
		k = 1
	}
	lerp := func(a, b int) int {
		return int(roundHalfUp(float64(a) + (float64(b)-float64(a))*k))
	}
	return RGB(lerp(c.R(), other.R()), lerp(c.G(), other.G()), lerp(c.B(), other.B()))
}

// Alpha blends c over a background at a (0-1). Used for subtle fills and shadows.
func (c Color) Alpha(background Color, a float64) Color { return background.Mix(c, a) }

func (c Color) Lighten(amount float64) Color { return c.Mix(RGB(255, 255, 255), amount) }
func (c Color) Darken(amount float64) Color  { return c.Mix(RGB(0, 0, 0), amount) }

// Luminance is the relative luminance, 0-1.
func (c Color) Luminance() float64 {
	channel := func(v int) float64 {
		x := float64(v) / 255
		if x <= 0.03928 {
			return x / 12.92
		}
		return math.Pow((x+0.055)/1.055, 2.4)
	}
	return 0.2126*channel(c.R()) + 0.7152*channel(c.G()) + 0.0722*channel(c.B())
}

// Contrast is the WCAG contrast ratio against another color (1-21).
func (c Color) Contrast(other Color) float64 {
	a, b := c.Luminance(), other.Luminance()
	return (math.Max(a, b) + 0.05) / (math.Min(a, b) + 0.05)
}

// Grayscale desaturates towards grey — this powers monochrome mode.
func (c Color) Grayscale() Color {
	if c.IsDefault() {
		return c
	}
	v := int(roundHalfUp(0.299*float64(c.R()) + 0.587*float64(c.G()) + 0.114*float64(c.B())))
	return RGB(v, v, v)
}

var cube = [6]int{0, 95, 135, 175, 215, 255}

func nearestCubeIndex(v int) int {
	best, bestD := 0, math.MaxInt
	for i, c := range cube {
		d := c - v
		if d < 0 {
			d = -d
		}
		if d < bestD {
			bestD, best = d, i
		}
	}
	return best
}

var base16 = [16][3]int{
	{0, 0, 0}, {205, 49, 49}, {13, 188, 121}, {229, 229, 16},
	{36, 114, 200}, {188, 63, 188}, {17, 168, 205}, {229, 229, 229},
	{102, 102, 102}, {241, 76, 76}, {35, 209, 139}, {245, 245, 67},
	{59, 142, 234}, {214, 112, 214}, {41, 184, 219}, {255, 255, 255},
}

// To256 quantizes to the xterm-256 palette, for terminals without truecolor.
func (c Color) To256() int {
	if c.isIndexed() {
		return int(uint32(c) & 255)
	}
	r, g, b := c.R(), c.G(), c.B()
	// The grey ramp often beats the cube for desaturated colors.
	if abs(r-g) < 8 && abs(g-b) < 8 {
		switch {
		case r < 8:
			return 16
		case r > 248:
			return 231
		}
		return 232 + int(roundHalfUp((float64(r)-8)/247*24))
	}
	return 16 + 36*nearestCubeIndex(r) + 6*nearestCubeIndex(g) + nearestCubeIndex(b)
}

// To16 quantizes to the 16-color palette, for last-resort terminals.
func (c Color) To16() int {
	if c.isIndexed() {
		i := int(uint32(c) & 255)
		if i < 16 {
			return i
		}
		return From256(i).To16()
	}
	r, g, b := c.R(), c.G(), c.B()
	best, bestD := 7, math.MaxInt
	for i, p := range base16 {
		d := (r-p[0])*(r-p[0]) + (g-p[1])*(g-p[1]) + (b-p[2])*(b-p[2])
		if d < bestD {
			bestD, best = d, i
		}
	}
	return best
}

// From256 converts a 256-palette index back to truecolor.
func From256(index int) Color {
	i := index & 255
	if i < 16 {
		p := base16[i]
		return RGB(p[0], p[1], p[2])
	}
	if i >= 232 {
		v := 8 + (i-232)*10
		return RGB(v, v, v)
	}
	n := i - 16
	return RGB(cube[(n/36)%6], cube[(n/6)%6], cube[n%6])
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// Gradient is a multi-stop color ramp.
//
//	heat := NewGradient(Hex("#00d7ff"), Hex("#ff5f5f"))
//	warm := heat.Sample(0.75)
type Gradient struct {
	stops []Color
}

func NewGradient(stops ...Color) Gradient { return Gradient{stops: stops} }

// GradientOf is the slice form, for a theme's ramp.
func GradientOf(stops []Color) Gradient { return Gradient{stops: stops} }

func (g Gradient) Sample(t float64) Color {
	switch len(g.stops) {
	case 0:
		return DefaultColor
	case 1:
		return g.stops[0]
	}
	// Ordered so NaN falls through to 0 rather than indexing wild.
	k := t
	if t > 1 {
		k = 1
	} else if !(t > 0) {
		k = 0
	}
	pos := k * float64(len(g.stops)-1)
	i := int(math.Floor(pos))
	if i > len(g.stops)-2 {
		i = len(g.stops) - 2
	}
	return g.stops[i].Mix(g.stops[i+1], pos-float64(i))
}

// Steps samples n evenly spaced colors.
func (g Gradient) Steps(n int) []Color {
	out := make([]Color, 0, n)
	for i := 0; i < n; i++ {
		t := 0.0
		if n > 1 {
			t = float64(i) / float64(n-1)
		}
		out = append(out, g.Sample(t))
	}
	return out
}
