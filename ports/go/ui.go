package hqtui

import (
	"time"
)

// The builder. Every container collects its children first, then solves the
// layout once and draws — which is why Fr sizes work without a retained tree.
//
// Unlike the Rust port, this one keeps the reference implementation's callback
// shape: Go closures capture by reference and the runtime has a garbage
// collector, so `OnPress: func() { count++ }` is exactly as natural here as it
// is in TypeScript.

// HitRegion is a rectangle the mouse can reach.
type HitRegion struct {
	Rect Rect
	// OnScroll receives -1 for up and 1 for down.
	OnScroll func(delta int)
	// OnClick receives coordinates local to the region, and the button name.
	OnClick func(x, y int, button string)
	OnHover func(x, y int)
}

// ScrollHandlers are the mouse behaviour shared by every scrollable widget.
// Supplying any of them turns a widget into its own scroll region, so the wheel
// acts on whatever is under the pointer rather than on one list per screen.
type ScrollHandlers struct {
	OnScroll func(delta int)
	// OnSelectRow receives a click on a visible row, counted from the first
	// body row — so a table's header does not shift every index by one.
	OnSelectRow func(visibleRow int)
	// OnFocus fires for a click anywhere on the widget, header included.
	OnFocus func()
}

type focusRegistration struct {
	Index   int
	Focused bool
}

// frameCtx is the per-frame state every container in the tree shares, which is
// what lets a nested panel register a hit region or claim a focus slot.
type frameCtx struct {
	theme        Theme
	capabilities Capabilities
	width        int
	height       int
	frame        int
	elapsed      time.Duration
	focusIndex   int
	// collapseBorders merges the borders of adjacent panels into shared
	// lines, the way CSS collapses table borders. Off unless the app asks for
	// it, because it changes every layout that has two panels side by side.
	collapseBorders bool

	focusCursor  int
	focusActions []func()
	hits         []HitRegion
	overlays     []func(Surface)
	invalidate   func()
}

func (c *frameCtx) registerFocus(action func()) focusRegistration {
	index := c.focusCursor
	c.focusCursor++
	for len(c.focusActions) <= index {
		c.focusActions = append(c.focusActions, nil)
	}
	if action != nil {
		c.focusActions[index] = action
	}
	return focusRegistration{Index: index, Focused: index == c.focusIndex}
}

func (c *frameCtx) hit(r HitRegion) { c.hits = append(c.hits, r) }

func (c *frameCtx) overlay(draw func(Surface)) { c.overlays = append(c.overlays, draw) }

// Layout is the sizing and padding every container and widget shares.
type Layout struct {
	// Size along the parent's main axis.
	Size       *Size
	Min        *int
	Max        *int
	Gap        int
	Padding    Padding
	Background *Color
	// Bordered treats this container's own edges as panel borders when
	// collapsing.
	//
	// Collapsing merges a seam only where two bordered siblings meet, and a row
	// or column is not itself bordered -- so wrapping a stack of panels in a
	// column, which is the only way to put a stack beside one tall panel, used
	// to make the seam down the middle of the screen the one seam that could
	// never merge. Set this on such a wrapper and its edges join in.
	//
	// It is a declaration rather than something inferred, because the children
	// are built only once the layout has been solved and the seam has to be
	// known before that. True only if every child is a panel filling the
	// container across the seam; otherwise a neighbour's border lands on
	// content.
	Bordered bool
}

func firstLayout(layout []Layout) Layout {
	if len(layout) > 0 {
		return layout[0]
	}
	return Layout{}
}

// RowOptions and ColumnOptions exist so a container reads the same as a widget
// at the call site.
type RowOptions struct{ Layout }
type ColumnOptions struct{ Layout }

// PanelOptions describe a bordered panel.
type PanelOptions struct {
	Layout
	Title         string
	TitleAlign    Align
	TitleColor    *Color
	Subtitle      string
	SubtitleColor *Color
	Footer        string
	Border        BorderStyle
	BorderColor   *Color
	// Focusable draws the focused border color and joins the Tab order.
	Focusable bool
	Focused   *bool
	// InnerPadding defaults to one column either side, as panels do.
	InnerPadding *Padding
}

// GridOptions describe a CSS-ish grid.
type GridOptions struct {
	Layout
	Columns []Size
	Rows    []Size
	// ColumnCount and RowCount are the shorthand for N equal tracks.
	ColumnCount int
	RowCount    int
}

// CellOptions place one grid cell, optionally spanning several.
type CellOptions struct {
	ColSpan int
	RowSpan int
}

type child struct {
	constraint Constraint
	draw       func(Surface)
	// bordered is true when this child draws a border of its own. Only
	// bordered siblings collapse into each other: a table pressed against a
	// panel edge should not grow junctions out of its rows.
	bordered bool
}

type Container struct {
	surface   Surface
	ctx       *frameCtx
	direction Direction
	gap       int
	inner     Surface
	children  []child
}

func newContainer(surface Surface, ctx *frameCtx, direction Direction, l Layout) *Container {
	inner := surface.Inset(l.Padding)
	if l.Background != nil {
		surface.Fill(Style{Bg: l.Background})
	}
	return &Container{surface: surface, ctx: ctx, direction: direction, gap: l.Gap, inner: inner}
}

func (c *Container) Theme() Theme               { return c.surface.Theme }
func (c *Container) Capabilities() Capabilities { return c.ctx.capabilities }
func (c *Container) Width() int                 { return c.inner.Width() }
func (c *Container) Height() int                { return c.inner.Height() }
func (c *Container) Frame() int                 { return c.ctx.frame }
func (c *Container) Elapsed() time.Duration     { return c.ctx.elapsed }

// crossWidth is the width available to a child laid out along the main axis.
func (c *Container) crossWidth() int {
	if c.direction == DirColumn {
		return c.inner.Width()
	}
	return c.inner.Height()
}

func (c *Container) add(constraint Constraint, draw func(Surface)) *Container {
	c.children = append(c.children, child{constraint: constraint, draw: draw})
	return c
}

// addBordered is add, for a child that draws its own border.
func (c *Container) addBordered(constraint Constraint, bordered bool, draw func(Surface)) *Container {
	c.children = append(c.children, child{constraint: constraint, draw: draw, bordered: bordered})
	return c
}

// seams is the gap at each seam. Ordinarily one number repeated, but where
// collapsing is on and two bordered siblings meet with no gap between them,
// the seam is minus one so their borders land in the same column and merge.
func (c *Container) seams() []int {
	out := make([]int, max(0, len(c.children)-1))
	for i := range out {
		out[i] = c.gap
	}
	if !c.ctx.collapseBorders || c.gap != 0 {
		return out
	}
	for i := range out {
		if c.children[i].bordered && c.children[i+1].bordered {
			out[i] = -1
		}
	}
	return out
}

// constraintOfLayout is the constraint for a child that declared a Layout.
func (c *Container) constraintOfLayout(l Layout, fallback Size, intrinsic *int) Constraint {
	size := fallback
	if l.Size != nil {
		size = *l.Size
	} else if c.direction == DirRow {
		// Intrinsic sizes describe height. Along a row, a widget takes the
		// space it is given.
		size = Fill()
	}
	return Constraint{Size: &size, Min: l.Min, Max: l.Max, Intrinsic: intrinsic}
}

// leaf is a widget's constraint: its natural height down a column, the whole
// track across a row.
func (c *Container) leaf(l Layout, intrinsic int) Constraint {
	return c.constraintOfLayout(l, Auto(), &intrinsic)
}

func (c *Container) filling(l Layout) Constraint {
	return c.constraintOfLayout(l, Fill(), nil)
}

// Flush solves and draws. The app calls this for you; parents call it for
// children.
func (c *Container) Flush() {
	if len(c.children) == 0 || c.inner.Rect.IsEmpty() {
		return
	}
	constraints := make([]Constraint, len(c.children))
	for i, ch := range c.children {
		constraints[i] = ch.constraint
	}
	rects := StackWithGaps(c.inner.Rect, constraints, c.direction, c.seams())
	children := c.children
	c.children = nil
	for i, ch := range children {
		if i >= len(rects) || rects[i].IsEmpty() {
			continue
		}
		ch.draw(c.inner.Region(rects[i]))
	}
}

// ------------------------------------------------------------------- layout

// Row is a horizontal container. Children default to equal shares.
func (c *Container) Row(o RowOptions, build func(*Container)) *Container {
	return c.addBordered(c.constraintOfLayout(o.Layout, Fill(), nil), o.Layout.Bordered, func(s Surface) {
		container := newContainer(s, c.ctx, DirRow, o.Layout)
		if build != nil {
			build(container)
		}
		container.Flush()
	})
}

// Column is a vertical container.
func (c *Container) Column(o ColumnOptions, build func(*Container)) *Container {
	return c.addBordered(c.constraintOfLayout(o.Layout, Fill(), nil), o.Layout.Bordered, func(s Surface) {
		container := newContainer(s, c.ctx, DirColumn, o.Layout)
		if build != nil {
			build(container)
		}
		container.Flush()
	})
}

// Panel is a bordered panel. The callback receives its interior as a column.
func (c *Container) Panel(o PanelOptions, build func(*Container)) *Container {
	focused := false
	if o.Focusable {
		focused = c.ctx.registerFocus(nil).Focused
	}
	if o.Focused != nil {
		focused = *o.Focused
	}
	collapse := c.ctx.collapseBorders
	bordered := o.Border != BorderNone
	return c.addBordered(c.constraintOfLayout(o.Layout, Fill(), nil), bordered, func(s Surface) {
		borderColor := s.Theme.Border
		if focused {
			borderColor = s.Theme.BorderFocused
		}
		if o.BorderColor != nil {
			borderColor = *o.BorderColor
		}
		interior := s.Box(BoxOptions{
			Title: o.Title, TitleAlign: o.TitleAlign, TitleColor: o.TitleColor,
			Subtitle: o.Subtitle, SubtitleColor: o.SubtitleColor, Footer: o.Footer,
			Border: o.Border, BorderColor: &borderColor, Bg: o.Layout.Background,
			Collapse: collapse,
		})
		padding := PadAxes(0, 1)
		if o.InnerPadding != nil {
			padding = *o.InnerPadding
		}
		container := newContainer(interior, c.ctx, DirColumn,
			Layout{Gap: o.Layout.Gap, Padding: padding})
		if build != nil {
			build(container)
		}
		container.Flush()
	})
}

// Box is a panel without a border — a grouping box that costs no rows.
func (c *Container) Box(o PanelOptions, build func(*Container)) *Container {
	o.Border = BorderNone
	return c.Panel(o, build)
}

// Grid is a CSS-ish grid, filled row-major with optional spans.
func (c *Container) Grid(o GridOptions, build func(*GridContainer)) *Container {
	return c.addBordered(c.constraintOfLayout(o.Layout, Fill(), nil), o.Layout.Bordered, func(s Surface) {
		grid := newGridContainer(s, c.ctx, o)
		if build != nil {
			build(grid)
		}
		grid.Flush()
	})
}

// Spacer is blank space.
func (c *Container) Spacer(size Size) *Container {
	return c.add(Constraint{Size: &size}, func(Surface) {})
}

// Divider is a horizontal rule, optionally labelled.
func (c *Container) Divider(o DividerOptions, layout ...Layout) *Container {
	return c.add(c.leaf(firstLayout(layout), 1), func(s Surface) { DrawDivider(s, o) })
}

// --------------------------------------------------------------------- text

func (c *Container) Text(content string, layout ...Layout) *Container {
	return c.StyledText(content, TextStyle{}, layout...)
}

func (c *Container) StyledText(content string, style TextStyle, layout ...Layout) *Container {
	lines := 1
	if style.Wrap {
		lines = len(Wrap(content, c.crossWidth()))
	} else {
		lines = 1
		for _, r := range content {
			if r == '\n' {
				lines++
			}
		}
	}
	return c.add(c.leaf(firstLayout(layout), lines), func(s Surface) {
		DrawText(s, content, style)
	})
}

// Label is muted secondary text.
func (c *Container) Label(content string, layout ...Layout) *Container {
	fg := c.Theme().Muted
	return c.StyledText(content, TextStyle{Fg: &fg}, layout...)
}

// Heading is a bold heading in the theme's title color.
func (c *Container) Heading(content string, layout ...Layout) *Container {
	fg := c.Theme().Title
	return c.StyledText(content, TextStyle{Fg: &fg, Bold: true}, layout...)
}

func (c *Container) Badge(o BadgeOptions, layout ...Layout) *Container {
	return c.add(c.leaf(firstLayout(layout), 1), func(s Surface) { DrawBadge(s, o) })
}

// KeyValues draws aligned label/value pairs.
func (c *Container) KeyValues(o KeyValueOptions, layout ...Layout) *Container {
	return c.add(c.leaf(firstLayout(layout), len(o.Rows)), func(s Surface) {
		DrawKeyValues(s, o)
	})
}

// --------------------------------------------------------------------- data

// attachScroll registers the widget's rect so the wheel and clicks reach it.
func (c *Container) attachScroll(s Surface, h ScrollHandlers, headerRows int) {
	if h.OnScroll == nil && h.OnSelectRow == nil && h.OnFocus == nil {
		return
	}
	c.ctx.hit(HitRegion{
		Rect:     s.HitRect(),
		OnScroll: h.OnScroll,
		OnClick: func(_, y int, _ string) {
			if h.OnFocus != nil {
				h.OnFocus()
			}
			// Row 0 is the header when there is one; clicks there only focus.
			if h.OnSelectRow != nil && y >= headerRows {
				h.OnSelectRow(y - headerRows)
			}
		},
	})
}

func (c *Container) Table(o TableOptions, h ScrollHandlers, layout ...Layout) *Container {
	headerRows := 1
	if o.NoHeader {
		headerRows = 0
	}
	intrinsic := len(o.Rows) + headerRows
	return c.add(c.constraintOfLayout(firstLayout(layout), Fill(), &intrinsic), func(s Surface) {
		DrawTable(s, o)
		c.attachScroll(s, h, headerRows)
	})
}

func (c *Container) List(o ListOptions, h ScrollHandlers, layout ...Layout) *Container {
	intrinsic := len(o.Items)
	return c.add(c.constraintOfLayout(firstLayout(layout), Fill(), &intrinsic), func(s Surface) {
		DrawList(s, o)
		c.attachScroll(s, h, 0)
	})
}

// Scrollbar draws a bar over state you own, for anything that scrolls and is
// not a table: wrapped prose, a canvas, a Draw of your own. A vertical bar
// fills the space it is given; a horizontal one is a single row.
func (c *Container) Scrollbar(o ScrollbarOptions, h ScrollHandlers, layout ...Layout) *Container {
	fallback := Fill()
	if !o.Orientation.IsVertical() {
		fallback = Cells(1)
	}
	return c.add(c.constraintOfLayout(firstLayout(layout), fallback, nil), func(s Surface) {
		DrawScrollbarWidget(s, o)
		c.attachScroll(s, h, 0)
	})
}

func (c *Container) Tree(o TreeOptions, h ScrollHandlers, layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), func(s Surface) {
		DrawTree(s, o)
		c.attachScroll(s, h, 0)
	})
}

func (c *Container) Log(o LogOptions, h ScrollHandlers, layout ...Layout) *Container {
	intrinsic := len(o.Entries)
	return c.add(c.constraintOfLayout(firstLayout(layout), Fill(), &intrinsic), func(s Surface) {
		DrawLog(s, o)
		c.attachScroll(s, h, 0)
	})
}

// ------------------------------------------------------------------ metrics

// Meter draws `label ████████░░░ 42%`.
func (c *Container) Meter(o MeterOptions, layout ...Layout) *Container {
	return c.add(c.leaf(firstLayout(layout), 1), func(s Surface) { DrawMeter(s, o) })
}

// Meters is a stack or grid of meters.
func (c *Container) Meters(o MetersOptions, layout ...Layout) *Container {
	columns := max(1, o.Columns)
	rows := (len(o.Items) + columns - 1) / columns
	return c.add(c.leaf(firstLayout(layout), rows), func(s Surface) { DrawMeters(s, o) })
}

func (c *Container) Progress(o ProgressOptions, layout ...Layout) *Container {
	return c.add(c.leaf(firstLayout(layout), 1), func(s Surface) { DrawProgress(s, o) })
}

// Graph is a Braille line/area graph. It fills the space it is given.
func (c *Container) Graph(o GraphOptions, layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), func(s Surface) { DrawGraph(s, o) })
}

// Chart draws arbitrary (x, y) data, with a domain on both axes.
//
// Graph plots a history buffer, one sample per column. Use this when the data
// has its own x values: two series of different lengths then line up, and a
// point lands where its x says it does.
func (c *Container) Chart(o ChartOptions, layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), func(s Surface) {
		DrawChart(s, o)
	})
}

// Clear resets a region so an overlay can own it.
//
// Anything drawn into a region without clearing it first shows whatever was
// underneath through the cells it does not touch.
func (c *Container) Clear(o ClearOptions, layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), func(s Surface) { DrawClear(s, o) })
}

// Fill floods a region with one repeated symbol and style.
func (c *Container) Fill(o FillOptions, layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), func(s Surface) { DrawFill(s, o) })
}

// Calendar draws a month as a grid, with per-day styling.
//
// Sized to the month it shows: a month spans four, five or six week rows
// depending on where its first day falls, and reserving five leaves some months
// a row short and others a blank row long.
func (c *Container) Calendar(o CalendarOptions, layout ...Layout) *Container {
	height := CalendarHeight(o)
	return c.add(c.constraintOfLayout(firstLayout(layout), Cells(height), &height), func(s Surface) {
		DrawCalendar(s, o)
	})
}

// Shapes draws a canvas in your own coordinates rather than in pixels.
//
// Canvas hands you the pixel grid and leaves the unit conversion to you, which
// means a drawing written for one panel size is wrong in the next. This takes
// bounds and shapes placed inside them, and y goes up.
func (c *Container) Shapes(o CanvasOptions, layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), func(s Surface) { DrawCanvas(s, o) })
}

// WorldMap draws a world map and reports the country under whatever is clicked.
//
// The click is answered by turning the cell back into degrees and testing it
// against the outlines, so the answer is the country actually under the cursor.
// Bounding boxes would be cheaper and wrong: Russia's covers most of the
// northern hemisphere and Chile's covers Argentina.
func (c *Container) WorldMap(o WorldMapOptions, h ScrollHandlers, layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), func(s Surface) {
		DrawWorldMap(s, o)
		c.attachScroll(s, h, 0)
	})
}

func (c *Container) Sparkline(o SparklineWidgetOptions, layout ...Layout) *Container {
	return c.add(c.leaf(firstLayout(layout), 1), func(s Surface) { DrawSparkline(s, o) })
}

func (c *Container) Histogram(o ColumnsOptions, layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), func(s Surface) { DrawColumns(s, o) })
}

// Gauge is a semicircular dial. It wants at least 9x5.
func (c *Container) Gauge(o GaugeOptions, layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), func(s Surface) { Gauge(s, o) })
}

func (c *Container) Donut(o DonutOptions, layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), func(s Surface) { Donut(s, o) })
}

// HeatBar is a segmented temperature-style bar.
func (c *Container) HeatBar(o HeatBarOptions, layout ...Layout) *Container {
	return c.add(c.leaf(firstLayout(layout), 1), func(s Surface) { DrawHeatBar(s, o) })
}

// ------------------------------------------------------------------- inputs

// Button joins the Tab order automatically when OnPress is supplied.
func (c *Container) Button(o ButtonOptions, onPress func(), layout ...Layout) *Container {
	focus := c.ctx.registerFocus(onPress)
	return c.add(c.leaf(firstLayout(layout), 1), func(s Surface) {
		opts := o
		if !opts.Focused {
			opts.Focused = focus.Focused
		}
		DrawButton(s, opts)
		if onPress != nil {
			c.ctx.hit(HitRegion{Rect: s.HitRect(), OnClick: func(int, int, string) { onPress() }})
		}
	})
}

func (c *Container) Checkbox(o CheckboxOptions, onToggle func(), layout ...Layout) *Container {
	focus := c.ctx.registerFocus(onToggle)
	return c.add(c.leaf(firstLayout(layout), 1), func(s Surface) {
		opts := o
		if !opts.Focused {
			opts.Focused = focus.Focused
		}
		DrawCheckbox(s, opts)
		if onToggle != nil {
			c.ctx.hit(HitRegion{Rect: s.HitRect(), OnClick: func(int, int, string) { onToggle() }})
		}
	})
}

func (c *Container) Select(o SelectOptions, onOpen func(), layout ...Layout) *Container {
	focus := c.ctx.registerFocus(onOpen)
	intrinsic := 1
	if o.Open {
		intrinsic = len(o.Options) + 1
	}
	return c.add(c.leaf(firstLayout(layout), intrinsic), func(s Surface) {
		opts := o
		if !opts.Focused {
			opts.Focused = focus.Focused
		}
		DrawSelect(s, opts)
		if onOpen != nil {
			c.ctx.hit(HitRegion{Rect: s.HitRect(), OnClick: func(int, int, string) { onOpen() }})
		}
	})
}

func (c *Container) TextInput(o TextInputOptions, layout ...Layout) *Container {
	focus := c.ctx.registerFocus(nil)
	return c.add(c.leaf(firstLayout(layout), 1), func(s Surface) {
		opts := o
		if !opts.Focused {
			opts.Focused = focus.Focused
		}
		DrawTextInput(s, opts)
	})
}

func (c *Container) Tabs(o TabsOptions, onSelect func(index int), layout ...Layout) *Container {
	return c.add(c.leaf(firstLayout(layout), 1), func(s Surface) {
		DrawTabs(s, o)
		if onSelect != nil {
			r := s.HitRect()
			x := 0
			for i, tab := range o.Tabs {
				w := StringWidth(tab) + 4
				index := i
				c.ctx.hit(HitRegion{
					Rect:    Rect{X: r.X + x, Y: r.Y, Width: w, Height: 1},
					OnClick: func(int, int, string) { onSelect(index) },
				})
				x += w
			}
		}
	})
}

func (c *Container) StatusBar(o StatusBarOptions, layout ...Layout) *Container {
	return c.add(c.leaf(firstLayout(layout), 1), func(s Surface) { DrawStatusBar(s, o) })
}

// ----------------------------------------------------------------- overlays

// Modal draws a centred dialog above everything else this frame.
func (c *Container) Modal(o ModalOptions, build func(*Container)) *Container {
	c.ctx.overlay(func(root Surface) {
		inner := DrawModal(root, o)
		if build != nil {
			container := newContainer(inner, c.ctx, DirColumn, Layout{Padding: PadAll(1)})
			build(container)
			container.Flush()
		}
	})
	return c
}

func (c *Container) CommandPalette(o CommandPaletteOptions) *Container {
	c.ctx.overlay(func(root Surface) { DrawCommandPalette(root, o) })
	return c
}

func (c *Container) Tooltip(o TooltipOptions) *Container {
	c.ctx.overlay(func(root Surface) { DrawTooltip(root, o) })
	return c
}

// ---------------------------------------------------------- escape hatches

// Draw paints straight onto the framebuffer region. Nothing is off limits.
func (c *Container) Draw(fn func(Surface), layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), fn)
}

// Canvas gives a Braille pixel canvas sized to the region, blitted when the
// callback returns.
func (c *Container) Canvas(color *Color, fn func(*BrailleCanvas, Surface), layout ...Layout) *Container {
	return c.add(c.filling(firstLayout(layout)), func(s Surface) {
		canvas := NewBrailleCanvas(s.Width(), s.Height())
		fn(canvas, s)
		fg := s.Theme.Accent
		if color != nil {
			fg = *color
		}
		for row := 0; row < canvas.Rows; row++ {
			for col := 0; col < canvas.Cols; col++ {
				if v := canvas.Cell(col, row); v != 0 {
					s.Char(col, row, v, Style{Fg: &fg})
				}
			}
		}
	})
}

// Responsive picks a layout by available width. Breakpoints are minimum widths;
// the largest one that fits wins.
func (c *Container) Responsive(breakpoints map[int]func(*Container)) *Container {
	chosen, found := 0, false
	for w := range breakpoints {
		if c.Width() >= w && (!found || w > chosen) {
			chosen, found = w, true
		}
	}
	if !found {
		// Nothing fits: fall back to the smallest breakpoint, as the reference
		// does when every width is above the container's.
		smallest := 0
		for w := range breakpoints {
			if !found || w < smallest {
				smallest, found = w, true
			}
		}
		chosen = smallest
	}
	if fn, ok := breakpoints[chosen]; ok && fn != nil {
		fn(c)
	}
	return c
}

// When runs build only if the condition holds.
func (c *Container) When(condition bool, build func(*Container)) *Container {
	if condition && build != nil {
		build(c)
	}
	return c
}

// ---------------------------------------------------------------------- grid

type gridCell struct {
	options  CellOptions
	draw     func(Surface)
	bordered bool
}

// GridContainer places cells row-major, with spans.
type GridContainer struct {
	surface Surface
	ctx     *frameCtx
	options GridOptions
	cells   []gridCell
}

func newGridContainer(surface Surface, ctx *frameCtx, o GridOptions) *GridContainer {
	return &GridContainer{surface: surface.Inset(o.Padding), ctx: ctx, options: o}
}

func (g *GridContainer) Theme() Theme { return g.surface.Theme }

func track(spec []Size, count, fallback int) []Size {
	if len(spec) > 0 {
		return spec
	}
	n := count
	if n <= 0 {
		n = fallback
	}
	if n < 1 {
		n = 1
	}
	out := make([]Size, n)
	for i := range out {
		out[i] = Fr(1)
	}
	return out
}

func (g *GridContainer) push(o CellOptions, bordered bool, draw func(Surface)) *GridContainer {
	g.cells = append(g.cells, gridCell{options: o, draw: draw, bordered: bordered})
	return g
}

// seam is the gap between tracks, minus one where the whole grid is panels and
// collapsing is on, so neighbouring borders land in the same column and merge.
// A grid is one pair of track sizes rather than a list of siblings, so this is
// all or nothing: a single cell that is not a panel would have a neighbour's
// border drawn across its content.
func (g *GridContainer) seam() int {
	gap := g.options.Gap
	if !g.ctx.collapseBorders || gap != 0 || len(g.cells) < 2 {
		return gap
	}
	for _, cell := range g.cells {
		if !cell.bordered {
			return gap
		}
	}
	return -1
}

// Panel occupies the next free cell, or several with a span.
func (g *GridContainer) Panel(o PanelOptions, cell CellOptions, build func(*Container)) *GridContainer {
	return g.push(cell, o.Border != BorderNone, func(s Surface) {
		container := newContainer(s, g.ctx, DirColumn, Layout{})
		container.Panel(o, build)
		container.Flush()
	})
}

func (g *GridContainer) Cell(cell CellOptions, l Layout, build func(*Container)) *GridContainer {
	return g.push(cell, l.Bordered, func(s Surface) {
		container := newContainer(s, g.ctx, DirColumn, l)
		if build != nil {
			build(container)
		}
		container.Flush()
	})
}

func (g *GridContainer) Row(cell CellOptions, l Layout, build func(*Container)) *GridContainer {
	return g.push(cell, l.Bordered, func(s Surface) {
		container := newContainer(s, g.ctx, DirRow, l)
		if build != nil {
			build(container)
		}
		container.Flush()
	})
}

func (g *GridContainer) Flush() {
	if len(g.cells) == 0 || g.surface.Rect.IsEmpty() {
		return
	}
	gap := g.seam()
	columnSpec := track(g.options.Columns, g.options.ColumnCount, min(len(g.cells), 3))
	rowCount := g.options.RowCount
	if len(g.options.Rows) > 0 {
		rowCount = len(g.options.Rows)
	} else if rowCount <= 0 {
		rowCount = (len(g.cells) + len(columnSpec) - 1) / len(columnSpec)
	}
	rowSpec := track(g.options.Rows, rowCount, rowCount)

	toConstraints := func(sizes []Size) []Constraint {
		out := make([]Constraint, len(sizes))
		for i, s := range sizes {
			size := s
			out[i] = Constraint{Size: &size}
		}
		return out
	}
	colWidths := Solve(g.surface.Width(), toConstraints(columnSpec), gap)
	rowHeights := Solve(g.surface.Height(), toConstraints(rowSpec), gap)

	occupied := map[[2]int]bool{}
	cursor := 0

	for _, cell := range g.cells {
		// Clamp to the grid. A span wider than the track count can never
		// satisfy `col + colSpan <= len(colWidths)`, so the placement loop below
		// used to burn the shared cursor to exhaustion — dropping this cell and
		// every one after it. A responsive layout collapsing to one column made
		// a full-width span blank the whole grid.
		colSpan := min(max(1, cell.options.ColSpan), len(colWidths))
		rowSpan := min(max(1, cell.options.RowSpan), len(rowHeights))

		// The cursor is shared across cells, so a cell that cannot be placed
		// must hand it back — otherwise it burns the cursor to exhaustion and
		// every later cell disappears too.
		searchFrom := cursor
		placed := false
		for cursor < len(colWidths)*len(rowHeights)+len(colWidths) {
			col := cursor % len(colWidths)
			row := cursor / len(colWidths)
			if row >= len(rowHeights) {
				break
			}
			free := col+colSpan <= len(colWidths)
			if free {
				for r := row; r < row+rowSpan && free; r++ {
					for c := col; c < col+colSpan && free; c++ {
						if occupied[[2]int{c, r}] {
							free = false
						}
					}
				}
			}
			if !free {
				cursor++
				continue
			}
			for r := row; r < row+rowSpan; r++ {
				for c := col; c < col+colSpan; c++ {
					occupied[[2]int{c, r}] = true
				}
			}

			x := g.surface.Rect.X
			for c := 0; c < col; c++ {
				x += colWidths[c] + gap
			}
			y := g.surface.Rect.Y
			for r := 0; r < row; r++ {
				y += rowHeights[r] + gap
			}
			width := 0
			for c := col; c < col+colSpan && c < len(colWidths); c++ {
				width += colWidths[c] + gap
			}
			height := 0
			for r := row; r < row+rowSpan && r < len(rowHeights); r++ {
				height += rowHeights[r] + gap
			}

			rect := Rect{X: x, Y: y, Width: max(0, width-gap), Height: max(0, height-gap)}
			if !rect.IsEmpty() {
				cell.draw(g.surface.Region(rect))
			}
			placed = true
			cursor++
			break
		}
		if !placed {
			cursor = searchFrom
		}
	}
	g.cells = nil
}
