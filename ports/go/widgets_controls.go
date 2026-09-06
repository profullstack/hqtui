package hqtui

import "strings"

// Buttons, inputs, tabs and the overlays that sit above a whole screen.

type ButtonVariant int

const (
	ButtonPrimary ButtonVariant = iota
	ButtonSuccess
	ButtonWarning
	ButtonDanger
	ButtonGhost
)

type ButtonOptions struct {
	Label    string
	Focused  bool
	Color    *Color
	Variant  ButtonVariant
	Disabled bool
	// Width in cells. Zero means the label's own width.
	Width int
	// Align defaults to centre, which is what a button wants.
	Align *Align
}

func Button(label string) ButtonOptions { return ButtonOptions{Label: label} }

func (o ButtonOptions) WithVariant(v ButtonVariant) ButtonOptions { o.Variant = v; return o }

func variantColor(s Surface, o ButtonOptions) Color {
	if o.Color != nil {
		return *o.Color
	}
	t := s.Theme
	switch o.Variant {
	case ButtonSuccess:
		return t.Success
	case ButtonWarning:
		return t.Warning
	case ButtonDanger:
		return t.Danger
	case ButtonGhost:
		return t.Muted
	}
	return t.Primary
}

// DrawButton returns the width drawn.
func DrawButton(s Surface, o ButtonOptions) int {
	if s.IsEmpty() {
		return 0
	}
	theme := s.Theme
	color := variantColor(s, o)
	label := " " + o.Label + " "
	width := StringWidth(label)
	if o.Width > 0 {
		width = o.Width
	}
	width = min(width, s.Width())

	var style Style
	switch {
	case o.Disabled:
		style = Style{Fg: &theme.Muted, Bg: ptrColor(Elevate(theme, 0.05))}
	case o.Focused:
		fg := theme.Surface
		if theme.Dark {
			fg = theme.Background
		}
		style = Style{Fg: &fg, Bg: &color, Attrs: ptrAttrs(AttrBold)}
	case o.Variant == ButtonGhost:
		style = Style{Fg: &color}
	default:
		style = Style{Fg: &color, Bg: ptrColor(theme.Surface.Mix(color, 0.16)), Attrs: ptrAttrs(AttrBold)}
	}

	align := AlignCenter
	if o.Align != nil {
		align = *o.Align
	}
	s.Text(0, 0, Fit(Truncate(label, width), width, align), TextFrom(style))
	return width
}

type CheckboxVariant int

const (
	CheckboxBox CheckboxVariant = iota
	CheckboxToggle
	CheckboxRadio
)

type CheckboxOptions struct {
	Label   string
	Checked bool
	Focused bool
	Color   *Color
	Variant CheckboxVariant
}

func Check(label string, checked bool) CheckboxOptions {
	return CheckboxOptions{Label: label, Checked: checked}
}

// DrawCheckbox returns the width drawn.
func DrawCheckbox(s Surface, o CheckboxOptions) int {
	if s.IsEmpty() {
		return 0
	}
	theme := s.Theme
	color := theme.Muted
	if o.Checked {
		color = theme.Success
	}
	if o.Color != nil {
		color = *o.Color
	}

	var glyph string
	switch o.Variant {
	case CheckboxToggle:
		glyph = "[ ▮]"
		if o.Checked {
			glyph = "[▮ ]"
		}
	case CheckboxRadio:
		glyph = "( )"
		if o.Checked {
			glyph = "(●)"
		}
	default:
		glyph = "[ ]"
		if o.Checked {
			glyph = "[✓]"
		}
	}

	attrs := AttrNone
	if o.Focused {
		attrs = AttrBold
	}
	x := s.Text(0, 0, glyph, TextOptions{Fg: &color, Attrs: &attrs})
	if o.Label != "" {
		fg := theme.Muted
		if o.Focused {
			fg = theme.Foreground
		}
		x += s.Text(x, 0, " "+o.Label, TextOptions{Fg: &fg, Attrs: &attrs})
	}
	return x
}

type SelectOptions struct {
	Value         string
	Focused       bool
	Open          bool
	Options       []string
	SelectedIndex int
	// Width in cells. Zero means the whole surface.
	Width int
	Color *Color
}

// DrawSelect draws a closed dropdown, or an open one with its option list
// underneath.
func DrawSelect(s Surface, o SelectOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	width := s.Width()
	if o.Width > 0 {
		width = min(o.Width, s.Width())
	}
	color := theme.Border
	if o.Focused {
		color = theme.BorderFocused
	}
	if o.Color != nil {
		color = *o.Color
	}
	fieldBg := Elevate(theme, 0.05)
	label := " " + Truncate(o.Value, max(0, width-4))
	attrs := AttrNone
	if o.Focused {
		attrs = AttrBold
	}
	s.Text(0, 0, Fit(label, max(0, width-2), AlignLeft),
		TextOptions{Fg: &theme.Foreground, Bg: &fieldBg, Attrs: &attrs})
	arrow := " ▾"
	if o.Open {
		arrow = " ▴"
	}
	s.Text(width-2, 0, arrow, TextOptions{Fg: &color, Bg: &fieldBg})

	if o.Open && len(o.Options) > 0 {
		height := min(len(o.Options), max(0, s.Height()-1))
		listBg := Elevate(theme, 0.08)
		for i := 0; i < height; i++ {
			selected := i == o.SelectedIndex
			fg, bg := theme.Foreground, listBg
			if selected {
				fg, bg = theme.SelectionText, theme.Selection
			}
			s.Text(0, i+1, Fit(" "+Truncate(o.Options[i], max(0, width-2)), width, AlignLeft),
				TextOptions{Fg: &fg, Bg: &bg})
		}
	}
}

type TextInputOptions struct {
	Value       string
	Placeholder string
	Focused     bool
	// Cursor is the caret index. Nil means the end of the value.
	Cursor *int
	// Width in cells. Zero means the whole surface.
	Width    int
	Label    string
	Password bool
	Color    *Color
}

func DrawTextInput(s Surface, o TextInputOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	width := s.Width()
	if o.Width > 0 {
		width = min(o.Width, s.Width())
	}
	labelWidth := 0
	if o.Label != "" {
		labelWidth = StringWidth(o.Label) + 1
		s.Text(0, 0, o.Label, TextOptions{Fg: &theme.Muted})
	}
	fieldWidth := max(0, width-labelWidth)
	elevation := 0.05
	if o.Focused {
		elevation = 0.1
	}
	bg := Elevate(theme, elevation)
	s.FillRect(labelWidth, 0, fieldWidth, 1, Style{Bg: &bg}, 32)

	// The reference counts UTF-16 units for the password mask and the default
	// caret; counting runes is the same for every value a person types and is
	// what a Go caller would expect.
	shown := o.Value
	if o.Password {
		shown = strings.Repeat("•", len([]rune(o.Value)))
	}
	empty := shown == ""
	text := shown
	if empty {
		text = o.Placeholder
	}
	fg := theme.Foreground
	if empty {
		fg = theme.Muted
	}
	s.Text(labelWidth+1, 0, Truncate(text, max(0, fieldWidth-2)),
		TextOptions{Fg: &fg, Bg: &bg})

	if o.Focused {
		caret := StringWidth(shown)
		if o.Cursor != nil {
			caret = *o.Cursor
		}
		cursorX := min(labelWidth+1+caret, labelWidth+max(0, fieldWidth-1))
		cursorColor := theme.Cursor
		if o.Color != nil {
			cursorColor = *o.Color
		}
		s.StyleRect(cursorX, 0, 1, 1, Style{Fg: &theme.Background, Bg: &cursorColor})
	}
}

type TabVariant int

const (
	TabFilled TabVariant = iota
	// TabUnderline underlines the active tab instead of filling it.
	TabUnderline
)

type TabsOptions struct {
	Tabs    []string
	Active  int
	Color   *Color
	Align   Align
	Variant TabVariant
}

func DrawTabs(s Surface, o TabsOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	color := theme.Accent
	if o.Color != nil {
		color = *o.Color
	}
	total := 0
	for _, t := range o.Tabs {
		total += StringWidth(t) + 4
	}
	x := 0
	switch o.Align {
	case AlignCenter:
		x = max(0, floorDiv(s.Width()-total, 2))
	case AlignRight:
		x = max(0, s.Width()-total)
	}

	for i, tab := range o.Tabs {
		label := "  " + tab + "  "
		var style Style
		if i == o.Active {
			if o.Variant == TabUnderline {
				style = Style{Fg: &color, Attrs: ptrAttrs(AttrBold | AttrUnderline)}
			} else {
				fg := theme.Surface
				if theme.Dark {
					fg = theme.Background
				}
				style = Style{Fg: &fg, Bg: &color, Attrs: ptrAttrs(AttrBold)}
			}
		} else {
			style = Style{Fg: &theme.Muted}
		}
		x += s.Text(x, 0, label, TextFrom(style))
	}
}

type ModalButton struct {
	Label   string
	Variant ButtonVariant
	Focused bool
}

type ModalOptions struct {
	Title   string
	Message string
	// Width and Height in cells. Zero means the defaults, 48 and "as tall as
	// the message needs".
	Width  int
	Height int
	// NoBackdrop stops dimming the screen behind the dialog.
	NoBackdrop bool
	Buttons    []ModalButton
	Color      *Color
	Align      *Align
}

// DrawModal centres a dialog over the whole surface and returns its interior,
// so callers can draw custom content instead of Message if they want to.
func DrawModal(root Surface, o ModalOptions) Surface {
	theme := root.Theme
	if !o.NoBackdrop {
		// Dim rather than blank: the dashboard stays legible behind the dialog.
		dim := theme.Foreground.Mix(theme.Background, 0.72)
		root.StyleRect(0, 0, root.Width(), root.Height(), Style{Fg: &dim})
	}

	width := 48
	if o.Width > 0 {
		width = o.Width
	}
	width = min(width, max(0, root.Width()-2))

	messageLines := 0
	if o.Message != "" {
		messageLines = len(Wrap(o.Message, max(0, width-4)))
	}
	height := messageLines + 4
	if len(o.Buttons) > 0 {
		height = messageLines + 5
	}
	if o.Height > 0 {
		height = o.Height
	}
	height = min(height, max(0, root.Height()-2))

	x := max(0, floorDiv(root.Width()-width, 2))
	y := max(0, floorDiv(root.Height()-height, 2))

	align := AlignCenter
	if o.Align != nil {
		align = *o.Align
	}
	borderColor := theme.BorderFocused
	if o.Color != nil {
		borderColor = *o.Color
	}

	surface := root.Sub(x, y, width, height)
	inner := surface.Box(BoxOptions{
		Title: o.Title, TitleAlign: align, Border: BorderRounded,
		BorderColor: &borderColor, Bg: ptrColor(Elevate(theme, 0.08)),
	})

	if o.Message != "" {
		for i, line := range Wrap(o.Message, max(0, inner.Width()-2)) {
			if i+1 >= inner.Height() {
				break
			}
			inner.Text(1, i+1, Fit(line, max(0, inner.Width()-2), align),
				TextOptions{Fg: &theme.Foreground})
		}
	}

	if len(o.Buttons) > 0 {
		widths := make([]int, len(o.Buttons))
		total := -2
		for i, b := range o.Buttons {
			widths[i] = StringWidth(b.Label) + 4
			total += widths[i] + 2
		}
		bx := max(0, floorDiv(inner.Width()-total, 2))
		by := inner.Height() - 2
		for i, button := range o.Buttons {
			DrawButton(inner.Sub(bx, by, widths[i], 1), ButtonOptions{
				Label: button.Label, Variant: button.Variant,
				Focused: button.Focused, Width: widths[i],
			})
			bx += widths[i] + 2
		}
	}

	return inner
}

type PaletteItem struct {
	Label string
	Hint  string
}

type CommandPaletteOptions struct {
	Query    string
	Items    []PaletteItem
	Selected int
	// Width and Height in cells. Zero means the defaults, 60 and up to 14.
	Width       int
	Height      int
	Placeholder string
}

// DrawCommandPalette draws a Ctrl+K style palette: a query line above a
// filtered list.
func DrawCommandPalette(root Surface, o CommandPaletteOptions) {
	theme := root.Theme
	width := 60
	if o.Width > 0 {
		width = o.Width
	}
	width = min(width, max(0, root.Width()-2))

	height := min(len(o.Items)+4, 14)
	if o.Height > 0 {
		height = o.Height
	}
	height = min(height, max(0, root.Height()-2))

	x := max(0, floorDiv(root.Width()-width, 2))
	y := max(1, root.Height()/5)

	dim := theme.Foreground.Mix(theme.Background, 0.7)
	root.StyleRect(0, 0, root.Width(), root.Height(), Style{Fg: &dim})

	surface := root.Sub(x, y, width, height)
	inner := surface.Box(BoxOptions{
		Border: BorderRounded, BorderColor: &theme.BorderFocused,
		Bg: ptrColor(Elevate(theme, 0.1)), Title: "Command Palette",
	})

	inner.Text(0, 0, "› ", TextOptions{Fg: &theme.Accent, Attrs: ptrAttrs(AttrBold)})
	queryText := o.Query
	queryColor := theme.Foreground
	if queryText == "" {
		queryText = o.Placeholder
		if queryText == "" {
			queryText = "Type a command…"
		}
		queryColor = theme.Muted
	}
	inner.Text(2, 0, queryText, TextOptions{Fg: &queryColor})
	inner.HLine(0, 1, inner.Width(), '─', Style{Fg: &theme.Border})

	listHeight := max(0, inner.Height()-2)
	for i := 0; i < listHeight; i++ {
		if i >= len(o.Items) {
			break
		}
		item := o.Items[i]
		selected := i == o.Selected
		yy := i + 2
		var bg *Color
		fg := theme.Foreground
		attrs := AttrNone
		if selected {
			inner.FillRect(0, yy, inner.Width(), 1, Style{Bg: ptrColor(theme.Selection)}, 32)
			bg = ptrColor(theme.Selection)
			fg = theme.SelectionText
			attrs = AttrBold
		}
		inner.Text(1, yy, Truncate(item.Label, max(0, inner.Width()-2)),
			TextOptions{Fg: &fg, Bg: bg, Attrs: &attrs})
		if item.Hint != "" {
			hw := StringWidth(item.Hint)
			if hw+3 < inner.Width() {
				inner.Text(inner.Width()-hw-1, yy, item.Hint,
					TextOptions{Fg: &theme.Muted, Bg: bg})
			}
		}
	}
}

type TooltipOptions struct {
	Text  string
	X, Y  int
	Color *Color
}

func DrawTooltip(root Surface, o TooltipOptions) {
	theme := root.Theme
	width := min(StringWidth(o.Text)+4, root.Width())
	x := max(0, min(o.X, root.Width()-width))
	y := max(0, min(o.Y, root.Height()-3))
	borderColor := theme.BorderFocused
	if o.Color != nil {
		borderColor = *o.Color
	}
	surface := root.Sub(x, y, width, 3)
	inner := surface.Box(BoxOptions{
		Border: BorderRounded, BorderColor: &borderColor,
		Bg: ptrColor(Elevate(theme, 0.12)),
	})
	inner.Text(0, 0, Truncate(o.Text, inner.Width()), TextOptions{Fg: &theme.Foreground})
}
