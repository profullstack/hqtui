package hqtui

import "strings"

// Dense data widgets: tables, lists, trees, tailing logs and the scrollbar they
// share.
//
// The reference is generic over a row type and reads cells with a key or a
// render callback. Go takes the cells already stringified —
// `Row("1", "systemd", "0.1")` — which keeps the widget free of reflection and
// puts the formatting where the data lives.

type TableColumn struct {
	Title string
	Width *Size
	Min   *int
	Max   *int
	Align Align
	Color *Color
}

func Col(title string) TableColumn { return TableColumn{Title: title} }

func (c TableColumn) Right() TableColumn         { c.Align = AlignRight; return c }
func (c TableColumn) Centered() TableColumn      { c.Align = AlignCenter; return c }
func (c TableColumn) Sized(s Size) TableColumn   { c.Width = &s; return c }
func (c TableColumn) Colored(v Color) TableColumn { c.Color = &v; return c }

type TableRow struct {
	Cells []string
	// Color paints the whole row, unless the column or the cell says otherwise.
	Color *Color
	// CellColors stand in for the reference's per-column color function. Where
	// an entry exists for a column it wins outright, including when it is nil —
	// which is what that callback returning undefined does there.
	CellColors []*Color
}

func Row(cells ...string) TableRow { return TableRow{Cells: cells} }

func (r TableRow) Colored(c Color) TableRow { r.Color = &c; return r }

type TableOptions struct {
	Rows    []TableRow
	Columns []TableColumn
	// NoHeader hides the header row, which is drawn by default.
	NoHeader    bool
	HeaderColor *Color
	// Selected is the index of the highlighted row. Nil means none.
	Selected *int
	// Offset is the first visible row; combine with Selected for scrolling.
	Offset *int
	// FollowSelection scrolls so Selected stays visible. Only the table knows
	// how many rows fit, so working the offset out here saves every caller from
	// tracking heights.
	FollowSelection bool
	Zebra           bool
	// Gap between columns. Nil means the default, 1.
	Gap        *int
	Background *Color
	// Scrollbar shows one in the last column when rows overflow.
	Scrollbar bool
}

// ResolveOffset is where the visible window should start: the caller's offset,
// nudged just far enough to keep the selected row on screen, and clamped.
func ResolveOffset(offset, selected *int, capacity, total int, follow bool) int {
	maxOffset := max(0, total-capacity)
	start := 0
	if offset != nil {
		start = *offset
	}
	start = max(0, min(start, maxOffset))
	if follow && selected != nil && capacity > 0 {
		if *selected < start {
			start = *selected
		} else if *selected >= start+capacity {
			start = *selected - capacity + 1
		}
	}
	return max(0, min(start, maxOffset))
}

// DrawTable draws a dense, column-aligned table with optional selection and
// scrollbar.
func DrawTable(s Surface, o TableOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	gap := 1
	if o.Gap != nil {
		gap = *o.Gap
	}
	headerRows := 1
	if o.NoHeader {
		headerRows = 0
	}
	bodyWidth := s.Width()
	if o.Scrollbar {
		bodyWidth--
	}

	constraints := make([]Constraint, len(o.Columns))
	for ci, c := range o.Columns {
		size := Auto()
		if c.Width != nil {
			size = *c.Width
		}
		minV := 1
		if c.Min != nil {
			minV = *c.Min
		}
		intrinsic := 0
		if c.Width == nil {
			// The reference samples the first 200 rows, which is what keeps an
			// auto column cheap on a long table.
			widest := 0
			for i, r := range o.Rows {
				if i >= 200 {
					break
				}
				if ci < len(r.Cells) {
					widest = max(widest, StringWidth(r.Cells[ci]))
				}
			}
			intrinsic = max(StringWidth(c.Title), widest)
		}
		constraints[ci] = Constraint{Size: &size, Min: &minV, Max: c.Max, Intrinsic: &intrinsic}
	}
	widths := Solve(bodyWidth, constraints, gap)

	if !o.NoHeader {
		headerColor := theme.Muted
		if o.HeaderColor != nil {
			headerColor = *o.HeaderColor
		}
		x := 0
		for i, column := range o.Columns {
			w := widths[i]
			if w <= 0 {
				continue
			}
			s.Text(x, 0, Fit(Truncate(column.Title, w), w, column.Align),
				TextOptions{Fg: &headerColor, Bg: o.Background, Attrs: ptrAttrs(AttrBold)})
			x += w + gap
		}
	}

	capacity := max(0, s.Height()-headerRows)
	offset := ResolveOffset(o.Offset, o.Selected, capacity, len(o.Rows), o.FollowSelection)
	var zebraBg *Color
	if o.Zebra {
		zebraBg = ptrColor(Elevate(theme, 0.04))
	}

	for i := 0; i < capacity; i++ {
		rowIndex := offset + i
		if rowIndex >= len(o.Rows) {
			break
		}
		row := o.Rows[rowIndex]
		y := i + headerRows
		selected := o.Selected != nil && *o.Selected == rowIndex

		rowBg := o.Background
		switch {
		case selected:
			rowBg = ptrColor(theme.Selection)
		case o.Zebra && rowIndex%2 == 1:
			rowBg = zebraBg
		}
		if rowBg != nil {
			s.FillRect(0, y, bodyWidth, 1, Style{Bg: rowBg}, 32)
		}

		x := 0
		for ci, column := range o.Columns {
			w := widths[ci]
			if w <= 0 {
				continue
			}
			text := ""
			if ci < len(row.Cells) {
				text = row.Cells[ci]
			}
			var fg *Color
			switch {
			case selected:
				fg = ptrColor(theme.SelectionText)
			case ci < len(row.CellColors):
				fg = row.CellColors[ci]
			case column.Color != nil:
				fg = column.Color
			default:
				fg = row.Color
			}
			if fg == nil {
				fg = ptrColor(theme.Foreground)
			}
			attrs := AttrNone
			if selected {
				attrs = AttrBold
			}
			s.Text(x, y, Fit(Truncate(text, w), w, column.Align),
				TextOptions{Fg: fg, Bg: rowBg, Attrs: &attrs})
			x += w + gap
		}
	}

	if o.Scrollbar && len(o.Rows) > capacity && capacity > 0 {
		DrawScrollbar(s, s.Width()-1, headerRows, capacity, len(o.Rows), offset)
	}
}

// DrawScrollbar draws a one-column scrollbar. Thumb size reflects the visible
// fraction.
func DrawScrollbar(s Surface, x, y, height, total, offset int) {
	theme := s.Theme
	track := theme.Background.Mix(theme.Border, 0.7)
	thumbSize := max(1, int(roundHalfUp(float64(height)/float64(total)*float64(height))))
	maxOffset := max(1, total-height)
	thumbPos := int(roundHalfUp(float64(offset) / float64(maxOffset) * float64(height-thumbSize)))
	for i := 0; i < height; i++ {
		inThumb := i >= thumbPos && i < thumbPos+thumbSize
		ch := '│'
		color := track
		if inThumb {
			ch, color = '█', theme.Accent
		}
		s.Glyph(x, y+i, ch, Style{Fg: &color})
	}
}

type ListItem struct {
	Label string
	Color *Color
	Badge string
}

func Item(label string) ListItem { return ListItem{Label: label} }

// Items is the common case of a plain list of strings.
func Items(labels ...string) []ListItem {
	out := make([]ListItem, len(labels))
	for i, l := range labels {
		out[i] = ListItem{Label: l}
	}
	return out
}

type ListOptions struct {
	Items    []ListItem
	Selected *int
	Offset   *int
	// FollowSelection scrolls so Selected stays visible.
	FollowSelection bool
	Background      *Color
	Bullet          string
	Scrollbar       bool
}

func DrawList(s Surface, o ListOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	width := s.Width()
	if o.Scrollbar {
		width--
	}
	offset := ResolveOffset(o.Offset, o.Selected, s.Height(), len(o.Items), o.FollowSelection)
	for i := 0; i < s.Height(); i++ {
		index := offset + i
		if index >= len(o.Items) {
			break
		}
		item := o.Items[index]
		selected := o.Selected != nil && *o.Selected == index
		bullet := ""
		if o.Bullet != "" {
			bullet = o.Bullet + " "
		}
		if selected {
			s.FillRect(0, i, width, 1, Style{Bg: ptrColor(theme.Selection)}, 32)
		}
		fg := theme.Foreground
		if item.Color != nil {
			fg = *item.Color
		}
		bg := o.Background
		attrs := AttrNone
		if selected {
			fg = theme.SelectionText
			bg = ptrColor(theme.Selection)
			attrs = AttrBold
		}
		s.Text(0, i, Fit(Truncate(bullet+item.Label, width), width, AlignLeft),
			TextOptions{Fg: &fg, Bg: bg, Attrs: &attrs})
	}
	if o.Scrollbar && len(o.Items) > s.Height() {
		DrawScrollbar(s, s.Width()-1, 0, s.Height(), len(o.Items), offset)
	}
}

type TreeValue struct {
	Text  string
	Width int
	Color *Color
	// Align defaults to right, which is what a numeric column wants.
	Align *Align
}

type TreeNode struct {
	Label string
	Color *Color
	// Values are right-aligned columns, e.g. CPU% and MEM% in a process tree.
	Values   []TreeValue
	Children []TreeNode
	// Collapsed hides the children. The reference spells this `expanded: false`.
	Collapsed bool
}

func Node(label string, children ...TreeNode) TreeNode {
	return TreeNode{Label: label, Children: children}
}

type TreeOptions struct {
	Nodes           []TreeNode
	Selected        *int
	Offset          *int
	FollowSelection bool
	Background      *Color
	// NoGuides hides the ├─ └─ connectors, which are drawn by default.
	NoGuides   bool
	GuideColor *Color
}

type flatNode struct {
	node  TreeNode
	depth int
	last  []bool
}

func flattenTree(nodes []TreeNode, depth int, trail []bool, out *[]flatNode) {
	for i, node := range nodes {
		last := i == len(nodes)-1
		here := append(append([]bool(nil), trail...), last)
		*out = append(*out, flatNode{node: node, depth: depth, last: here})
		if len(node.Children) > 0 && !node.Collapsed {
			flattenTree(node.Children, depth+1, here, out)
		}
	}
}

// DrawTree draws an indented tree with box-drawing connectors, like pstree.
func DrawTree(s Surface, o TreeOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	var flat []flatNode
	flattenTree(o.Nodes, 0, nil, &flat)

	offset := ResolveOffset(o.Offset, o.Selected, s.Height(), len(flat), o.FollowSelection)
	guideColor := theme.Border.Mix(theme.Foreground, 0.15)
	if o.GuideColor != nil {
		guideColor = *o.GuideColor
	}

	for i := 0; i < s.Height(); i++ {
		index := offset + i
		if index >= len(flat) {
			break
		}
		entry := flat[index]
		selected := o.Selected != nil && *o.Selected == index
		bg := o.Background
		if selected {
			bg = ptrColor(theme.Selection)
			s.FillRect(0, i, s.Width(), 1, Style{Bg: bg}, 32)
		}

		prefix := ""
		if !o.NoGuides {
			for d := 0; d < entry.depth; d++ {
				if entry.last[d] {
					prefix += "   "
				} else {
					prefix += "│  "
				}
			}
			if entry.last[entry.depth] {
				prefix += "└─ "
			} else {
				prefix += "├─ "
			}
		} else {
			prefix = strings.Repeat("  ", entry.depth)
		}

		valuesWidth := 0
		for _, v := range entry.node.Values {
			valuesWidth += v.Width + 1
		}
		labelWidth := max(0, s.Width()-valuesWidth)
		s.Text(0, i, Truncate(prefix, labelWidth), TextOptions{Fg: &guideColor, Bg: bg})
		px := min(StringWidth(prefix), labelWidth)

		fg := theme.Foreground
		if entry.node.Color != nil {
			fg = *entry.node.Color
		}
		attrs := AttrNone
		if selected {
			fg = theme.SelectionText
			attrs = AttrBold
		}
		s.Text(px, i, Truncate(entry.node.Label, max(0, labelWidth-px)),
			TextOptions{Fg: &fg, Bg: bg, Attrs: &attrs})

		vx := labelWidth
		for _, value := range entry.node.Values {
			vfg := theme.Foreground
			if value.Color != nil {
				vfg = *value.Color
			}
			if selected {
				vfg = theme.SelectionText
			}
			align := AlignRight
			if value.Align != nil {
				align = *value.Align
			}
			s.Text(vx, i, Fit(Truncate(value.Text, value.Width), value.Width, align),
				TextOptions{Fg: &vfg, Bg: bg})
			vx += value.Width + 1
		}
	}
}

type LogEntry struct {
	Time    string
	Level   string
	Message string
	Meta    string
	Color   *Color
}

func Log(message string) LogEntry { return LogEntry{Message: message} }

func (e LogEntry) At(time string) LogEntry     { e.Time = time; return e }
func (e LogEntry) Levelled(l string) LogEntry  { e.Level = l; return e }
func (e LogEntry) WithMeta(m string) LogEntry  { e.Meta = m; return e }

type LogOptions struct {
	Entries []LogEntry
	// NoFollow stops pinning to the newest entry, which is the default.
	NoFollow bool
	Offset   *int
	// FromEnd is lines to scroll back from the newest entry. The natural
	// control for a tailing log: only the widget knows how many rows fit, so an
	// absolute offset makes small scrolls near the bottom clamp to nothing.
	FromEnd     int
	Scrollbar   bool
	Background  *Color
	LevelColors map[string]Color
	TimeColor   *Color
	MetaColor   *Color
}

// DrawLog draws a tailing log view with colored levels. Newest at the bottom.
func DrawLog(s Surface, o LogOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	levelColor := func(name string) Color {
		upper := strings.ToUpper(name)
		if c, ok := o.LevelColors[upper]; ok {
			return c
		}
		switch upper {
		case "ERROR", "FATAL":
			return theme.Danger
		case "WARN":
			return theme.Warning
		case "INFO":
			return theme.Success
		case "DEBUG", "TRACE":
			return theme.Muted
		}
		return theme.Foreground
	}

	width := s.Width()
	if o.Scrollbar {
		width--
	}
	fromEnd := max(0, o.FromEnd)
	maxStart := max(0, len(o.Entries)-s.Height())
	var start int
	if !o.NoFollow || fromEnd > 0 {
		start = max(0, min(maxStart, len(o.Entries)-s.Height()-fromEnd))
	} else {
		start = ResolveOffset(o.Offset, nil, s.Height(), len(o.Entries), false)
	}

	for i := 0; i < s.Height(); i++ {
		if start+i >= len(o.Entries) {
			break
		}
		entry := o.Entries[start+i]
		x := 0
		if entry.Time != "" {
			fg := theme.Muted
			if o.TimeColor != nil {
				fg = *o.TimeColor
			}
			x += s.Text(x, i, entry.Time+" ", TextOptions{Fg: &fg, Bg: o.Background})
		}
		if entry.Level != "" {
			fg := levelColor(entry.Level)
			x += s.Text(x, i, Fit(strings.ToUpper(entry.Level), 5, AlignLeft),
				TextOptions{Fg: &fg, Bg: o.Background, Attrs: ptrAttrs(AttrBold)})
			x += s.Text(x, i, " ", TextOptions{Bg: o.Background})
		}
		metaWidth := 0
		if entry.Meta != "" {
			metaWidth = StringWidth(entry.Meta) + 1
		}
		msgWidth := max(0, width-x-metaWidth)
		fg := theme.Foreground
		if entry.Color != nil {
			fg = *entry.Color
		}
		s.Text(x, i, Truncate(entry.Message, msgWidth),
			TextOptions{Fg: &fg, Bg: o.Background})
		if entry.Meta != "" && metaWidth < width {
			mfg := theme.Muted
			if o.MetaColor != nil {
				mfg = *o.MetaColor
			}
			s.Text(width-metaWidth+1, i, entry.Meta,
				TextOptions{Fg: &mfg, Bg: o.Background})
		}
	}
}
