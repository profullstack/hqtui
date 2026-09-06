package hqtui

import "math"

// Sub-cell glyph ramps. Every one degrades to ASCII when Unicode is off.

var (
	// HorizontalEighths are left-to-right: ▏▎▍▌▋▊▉█ — bars and meters.
	HorizontalEighths = [9]string{"", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"}
	// VerticalEighths are bottom-up: ▁▂▃▄▅▆▇█ — sparklines and column charts.
	VerticalEighths = [9]string{"", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"}
	// Quadrants are indexed by a 4-bit mask: 1=TL, 2=TR, 4=BL, 8=BR.
	Quadrants = [16]string{
		" ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█",
	}
	Shades    = [4]string{"░", "▒", "▓", "█"}
	ASCIIRamp = [10]string{" ", ".", ":", "-", "=", "+", "*", "#", "%", "@"}
)

// FillMode is how sub-cell detail is drawn. Braille is sharpest; the rest are
// the graceful degradations for terminals or fonts that cannot manage it.
type FillMode int

const (
	FillBraille FillMode = iota
	FillBlock
	FillHalf
	FillQuadrant
	FillASCII
)

func ParseFillMode(name string) FillMode {
	switch name {
	case "block":
		return FillBlock
	case "half":
		return FillHalf
	case "quadrant":
		return FillQuadrant
	case "ascii":
		return FillASCII
	}
	return FillBraille
}

func clamp01(ratio float64) float64 {
	if ratio <= 0 {
		return 0
	}
	if ratio >= 1 {
		return 1
	}
	return ratio
}

// VerticalGlyph picks the glyph for a 0-1 fill of one cell, bottom-up.
func VerticalGlyph(ratio float64, mode FillMode) string {
	r := clamp01(ratio)
	switch mode {
	case FillASCII:
		switch {
		case r == 0:
			return " "
		case r < 0.4:
			return "."
		case r < 0.7:
			return "="
		}
		return "#"
	case FillHalf:
		switch {
		case r == 0:
			return " "
		case r < 0.5:
			return "▄"
		}
		return "█"
	}
	i := int(roundHalfUp(r * 8))
	if i == 0 {
		return " "
	}
	return VerticalEighths[i]
}

// HorizontalGlyph picks the glyph for a 0-1 fill of one cell, left to right.
func HorizontalGlyph(ratio float64, mode FillMode) string {
	r := clamp01(ratio)
	if mode == FillASCII {
		switch {
		case r == 0:
			return " "
		case r < 0.5:
			return "-"
		}
		return "#"
	}
	i := int(roundHalfUp(r * 8))
	if i == 0 {
		return " "
	}
	return HorizontalEighths[i]
}

// ShadeGlyph maps a 0-1 value onto a shade block, for heatmaps and dim fills.
func ShadeGlyph(ratio float64, unicode bool) string {
	r := clamp01(ratio)
	if !unicode {
		return ASCIIRamp[int(roundHalfUp(r*float64(len(ASCIIRamp)-1)))]
	}
	if r == 0 {
		return " "
	}
	i := int(math.Floor(r * float64(len(Shades))))
	if i > len(Shades)-1 {
		i = len(Shades) - 1
	}
	return Shades[i]
}

// BestMode picks Braille when the terminal supports it, blocks when it does not.
func BestMode(unicode, braille bool) FillMode {
	if braille {
		return FillBraille
	}
	if unicode {
		return FillBlock
	}
	return FillASCII
}
