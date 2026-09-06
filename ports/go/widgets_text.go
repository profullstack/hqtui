package hqtui

import "strings"

// Text, badges, label/value pairs, dividers and the function-key bar.

type TextStyle struct {
	Fg    *Color
	Bg    *Color
	Attrs *Attrs
	Align Align
	Wrap  bool

	Bold      bool
	Dim       bool
	Italic    bool
	Underline bool
}

func (o TextStyle) resolvedAttrs() Attrs {
	a := AttrNone
	if o.Attrs != nil {
		a = *o.Attrs
	}
	if o.Bold {
		a |= AttrBold
	}
	if o.Dim {
		a |= AttrDim
	}
	if o.Italic {
		a |= AttrItalic
	}
	if o.Underline {
		a |= AttrUnderline
	}
	return a
}

func DrawText(s Surface, content string, o TextStyle) {
	if s.IsEmpty() {
		return
	}
	fg := s.Theme.Foreground
	if o.Fg != nil {
		fg = *o.Fg
	}
	attrs := o.resolvedAttrs()
	style := TextOptions{Fg: &fg, Bg: o.Bg, Attrs: &attrs}

	var lines []string
	if o.Wrap {
		lines = Wrap(content, s.Width())
	} else {
		lines = strings.Split(content, "\n")
	}
	for i, line := range lines {
		if i >= s.Height() {
			break
		}
		s.Text(0, i, Fit(Truncate(line, s.Width()), s.Width(), o.Align), style)
	}
}

// BadgeVariant: filled reads as a chip; outline keeps the panel quiet.
type BadgeVariant int

const (
	BadgeFilled BadgeVariant = iota
	BadgeOutline
	BadgeSubtle
)

type BadgeOptions struct {
	Text    string
	Color   *Color
	Variant BadgeVariant
	Align   Align
}

// DrawBadge returns the width drawn, so callers can advance a cursor past it.
func DrawBadge(s Surface, o BadgeOptions) int {
	if s.IsEmpty() {
		return 0
	}
	theme := s.Theme
	color := theme.Primary
	if o.Color != nil {
		color = *o.Color
	}
	label := " " + o.Text + " "

	var style Style
	switch o.Variant {
	case BadgeFilled:
		fg := theme.Surface
		if theme.Dark {
			fg = theme.Background
		}
		style = Style{Fg: &fg, Bg: &color, Attrs: ptrAttrs(AttrBold)}
	case BadgeSubtle:
		bg := theme.Surface.Mix(color, 0.18)
		style = Style{Fg: &color, Bg: &bg}
	default:
		style = Style{Fg: &color, Attrs: ptrAttrs(AttrBold)}
	}

	width := min(StringWidth(label), s.Width())
	x := 0
	switch o.Align {
	case AlignRight:
		x = s.Width() - width
	case AlignCenter:
		x = floorDiv(s.Width()-width, 2)
	}
	s.Text(max(0, x), 0, Truncate(label, s.Width()), TextFrom(style))
	return width
}

type KeyValueRow struct {
	Label      string
	Value      string
	Color      *Color
	LabelColor *Color
}

func KV(label, value string) KeyValueRow { return KeyValueRow{Label: label, Value: value} }

type KeyValueOptions struct {
	Rows []KeyValueRow
	// LabelWidth reserves columns for labels. Zero means the widest label.
	LabelWidth int
	// Gap is the space between label and value. Nil means the default, 1 —
	// zero is a legitimate value, so this cannot use the zero value for it.
	Gap *int
	// NoSpread keeps values next to the label instead of at the right edge.
	NoSpread   bool
	LabelColor *Color
	ValueColor *Color
	Background *Color
}

// DrawKeyValues draws aligned label/value pairs — the backbone of every
// "System" panel.
func DrawKeyValues(s Surface, o KeyValueOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	gap := 1
	if o.Gap != nil {
		gap = *o.Gap
	}
	labelWidth := o.LabelWidth
	if labelWidth == 0 {
		widest := 0
		for _, r := range o.Rows {
			widest = max(widest, StringWidth(r.Label))
		}
		labelWidth = min(widest+1, max(4, int(float64(s.Width())*0.6)))
	}

	for i, row := range o.Rows {
		if i >= s.Height() {
			break
		}
		labelColor := theme.Muted
		if o.LabelColor != nil {
			labelColor = *o.LabelColor
		}
		if row.LabelColor != nil {
			labelColor = *row.LabelColor
		}
		s.Text(0, i, Fit(Truncate(row.Label, labelWidth), labelWidth, AlignLeft),
			TextOptions{Fg: &labelColor, Bg: o.Background})

		vx := labelWidth + gap
		vw := max(0, s.Width()-vx)
		if vw == 0 {
			continue
		}
		value := Truncate(row.Value, vw)
		if !o.NoSpread {
			value = Fit(value, vw, AlignRight)
		}
		valueColor := theme.Foreground
		if o.ValueColor != nil {
			valueColor = *o.ValueColor
		}
		if row.Color != nil {
			valueColor = *row.Color
		}
		s.Text(vx, i, value, TextOptions{Fg: &valueColor, Bg: o.Background})
	}
}

type DividerOptions struct {
	Label string
	Color *Color
	// Char is the rule glyph. Zero means the default, '─'.
	Char  rune
	Align Align
}

func DrawDivider(s Surface, o DividerOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	color := theme.Border
	if o.Color != nil {
		color = *o.Color
	}
	ch := o.Char
	if ch == 0 {
		ch = '─'
	}
	s.HLine(0, 0, s.Width(), ch, Style{Fg: &color})
	if o.Label != "" {
		text := " " + o.Label + " "
		w := StringWidth(text)
		x := 1
		switch o.Align {
		case AlignRight:
			x = s.Width() - w - 1
		case AlignCenter:
			x = floorDiv(s.Width()-w, 2)
		}
		s.Text(max(0, x), 0, Truncate(text, s.Width()),
			TextOptions{Fg: &theme.Muted})
	}
}

type StatusItem struct {
	Key   string
	Label string
	Color *Color
	// Active highlights this entry, e.g. the active tab or a live indicator.
	Active bool
}

func Status(label string) StatusItem            { return StatusItem{Label: label} }
func StatusKey(key, label string) StatusItem    { return StatusItem{Key: key, Label: label} }

// KeyStyle: caps reverse-videos the key caps, like a function-key bar.
type KeyStyle int

const (
	KeyCaps KeyStyle = iota
	KeyPlain
)

type StatusBarOptions struct {
	Items      []StatusItem
	Right      []StatusItem
	Background *Color
	KeyColor   *Color
	KeyStyle   KeyStyle
}

// DrawStatusBar draws the F1/F2/F10 bar along the bottom of every serious TUI.
func DrawStatusBar(s Surface, o StatusBarOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	bg := Elevate(theme, 0.04)
	if o.Background != nil {
		bg = *o.Background
	}
	s.Fill(Style{Bg: &bg})

	keyColor := theme.Accent
	if o.KeyColor != nil {
		keyColor = *o.KeyColor
	}

	drawItems := func(items []StatusItem, startX int) int {
		cx := startX
		for _, item := range items {
			if cx >= s.Width() {
				break
			}
			if item.Key != "" {
				var capStyle Style
				if o.KeyStyle == KeyPlain {
					capStyle = Style{Fg: &keyColor, Bg: &bg, Attrs: ptrAttrs(AttrBold)}
				} else {
					fg := theme.Surface
					if theme.Dark {
						fg = theme.Background
					}
					capStyle = Style{Fg: &fg, Bg: &keyColor, Attrs: ptrAttrs(AttrBold)}
				}
				cx += s.Text(cx, 0, item.Key, TextFrom(capStyle))
				cx += s.Text(cx, 0, " ", TextOptions{Bg: &bg})
			}
			fg := theme.Muted
			if item.Color != nil {
				fg = *item.Color
			}
			attrs := AttrNone
			if item.Active {
				fg = theme.Foreground
				attrs = AttrBold
			}
			cx += s.Text(cx, 0, item.Label, TextOptions{Fg: &fg, Bg: &bg, Attrs: &attrs})
			cx += s.Text(cx, 0, "  ", TextOptions{Bg: &bg})
		}
		return cx
	}

	x := drawItems(o.Items, 1)

	if len(o.Right) > 0 {
		width := 0
		for _, i := range o.Right {
			width += StringWidth(i.Label) + 2
			if i.Key != "" {
				width += StringWidth(i.Key) + 1
			}
		}
		drawItems(o.Right, max(x, s.Width()-width-1))
	}
}

func ptrAttrs(a Attrs) *Attrs { return &a }
func ptrColor(c Color) *Color { return &c }
func ptrBool(b bool) *bool    { return &b }
func ptrF64(f float64) *float64 { return &f }

// floorDiv is JavaScript's `Math.floor(a / b)`, which rounds towards negative
// infinity where Go's integer division truncates towards zero.
func floorDiv(a, b int) int {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}
