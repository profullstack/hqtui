package hqtui

import (
	"time"
)

// The application: owns the terminal, both framebuffers, the scheduler and the
// event loop. Everything else in the package is reachable from here.
//
//	app := hqtui.NewApp(hqtui.AppOptions{})
//	app.Render(func(f hqtui.RenderArgs) {
//		f.UI.Panel(hqtui.PanelOptions{Title: "Hello"}, func(p *hqtui.Container) {
//			p.Text("Hello, terminal.")
//		})
//	})
//	app.Start()
//
// Go keeps the reference implementation's shape here — a render callback and
// event handlers that close over your own state — because closures capture by
// reference and the runtime has a garbage collector. The Rust port has to
// invert this; Go does not.

type AppOptions struct {
	Terminal TerminalOptions
	// Theme is a built-in name. Empty means dark.
	Theme string
	// FPS caps frames per second. Zero means 30.
	FPS int
	// RemoteFPS is the cap when an SSH session is detected. Zero means 15.
	RemoteFPS int
	// AlwaysRender redraws every tick instead of only when invalidated.
	AlwaysRender bool
	// QuitKeys default to ctrl+c and q. Pass an empty non-nil slice to handle
	// quitting yourself.
	QuitKeys []string
	// NoFocusNavigation stops Tab/Shift+Tab from moving focus.
	NoFocusNavigation bool
	// NoBackground stops painting the theme background across the screen.
	NoBackground bool
	// CollapseBorders merges the borders of adjacent panels into shared lines,
	// the way CSS collapses table borders. Off by default, because it changes
	// every layout with two panels side by side; turn it on once, for the whole
	// screen.
	CollapseBorders bool
	// Monochrome drains color, for accessibility or NO_COLOR.
	Monochrome *bool
}

type FrameStats struct {
	Frame int
	// Render is the time spent building, diffing and writing.
	Render       time.Duration
	ChangedCells int
	DirtyRows    int
	Bytes        int
}

// RenderArgs is what a render callback is handed.
type RenderArgs struct {
	UI           *Container
	Theme        Theme
	Capabilities Capabilities
	Width        int
	Height       int
	Frame        int
	Elapsed      time.Duration
	// Focus is the index of the focused control, in registration order.
	Focus int
	App   *App
}

type App struct {
	Terminal     *Terminal
	Capabilities Capabilities
	Theme        Theme

	options  AppOptions
	current  *FrameBuffer
	previous *FrameBuffer
	encoder  *Encoder

	renderFn     func(RenderArgs)
	running      bool
	dirty        bool
	forceRepaint bool
	startedAt    time.Time
	lastPoll     time.Time
	frameCount   int
	lastStats    FrameStats

	focusIndex   int
	focusCount   int
	focusActions []func()
	hits         []HitRegion

	keyHandlers    []func(InputEvent)
	mouseHandlers  []func(InputEvent)
	pasteHandlers  []func(InputEvent)
	focusHandlers  []func(InputEvent)
	resizeHandlers []func(TerminalSize)
	frameHandlers  []func(FrameStats)
	exitHandlers   []func()
}

// NewApp creates an app. Every option has a sensible default: dark theme, mouse
// on, 30fps, alternate screen, terminal restored no matter how the process dies.
func NewApp(o AppOptions) *App {
	terminal := NewTerminal(o.Terminal)
	theme := ResolveTheme(o.Theme)
	if o.Theme == "" {
		theme = ResolveTheme("dark")
	}

	size := terminal.Size()
	monochrome := terminal.Capabilities.Colors == ColorNone
	if o.Monochrome != nil {
		monochrome = *o.Monochrome
	}

	return &App{
		Terminal:     terminal,
		Capabilities: terminal.Capabilities,
		Theme:        theme,
		options:      o,
		current:      NewFrameBuffer(size.Columns, size.Rows),
		previous:     NewFrameBuffer(size.Columns, size.Rows),
		encoder: NewEncoder(EncoderOptions{
			Colors: terminal.Capabilities.Colors, Monochrome: monochrome,
		}),
		renderFn:     func(RenderArgs) {},
		dirty:        true,
		forceRepaint: true,
	}
}

func (a *App) Width() int        { return a.current.Width }
func (a *App) Height() int       { return a.current.Height }
func (a *App) Stats() FrameStats { return a.lastStats }
func (a *App) Running() bool     { return a.running }

// Render registers the view. It is called on every frame; keep it cheap.
func (a *App) Render(fn func(RenderArgs)) *App {
	a.renderFn = fn
	a.dirty = true
	return a
}

// Invalidate asks for a redraw. The scheduler coalesces repeated calls into one
// frame.
func (a *App) Invalidate() { a.dirty = true }

// Redraw forces a full repaint, e.g. after another process wrote to the
// terminal.
func (a *App) Redraw() {
	a.forceRepaint = true
	a.dirty = true
}

func (a *App) SetTheme(name string) *App {
	a.Theme = ResolveTheme(name)
	a.Redraw()
	return a
}

// CollapseBorders reports whether adjacent panel borders are being merged.
func (a *App) CollapseBorders() bool { return a.options.CollapseBorders }

// SetCollapseBorders turns collapsed borders on or off while running, so a
// keybinding can show what the flag does. It changes the layout rather than
// only the glyphs, so it forces a full repaint.
func (a *App) SetCollapseBorders(value bool) *App {
	a.options.CollapseBorders = value
	a.Redraw()
	return a
}

func (a *App) OnKey(fn func(InputEvent)) *App { a.keyHandlers = append(a.keyHandlers, fn); return a }
func (a *App) OnMouse(fn func(InputEvent)) *App {
	a.mouseHandlers = append(a.mouseHandlers, fn)
	return a
}
func (a *App) OnPaste(fn func(InputEvent)) *App {
	a.pasteHandlers = append(a.pasteHandlers, fn)
	return a
}
func (a *App) OnFocus(fn func(InputEvent)) *App {
	a.focusHandlers = append(a.focusHandlers, fn)
	return a
}
func (a *App) OnFrame(fn func(FrameStats)) *App {
	a.frameHandlers = append(a.frameHandlers, fn)
	return a
}
func (a *App) OnExit(fn func()) *App { a.exitHandlers = append(a.exitHandlers, fn); return a }

func (a *App) OnResize(fn func(TerminalSize)) *App {
	a.resizeHandlers = append(a.resizeHandlers, fn)
	return a
}

// FocusNext moves keyboard focus. It wraps around.
func (a *App) FocusNext(delta int) {
	if a.focusCount == 0 {
		return
	}
	a.focusIndex = ((a.focusIndex+delta)%a.focusCount + a.focusCount) % a.focusCount
	a.dirty = true
}

// ActivateFocused triggers the focused control, as Enter does.
func (a *App) ActivateFocused() {
	if a.focusIndex < len(a.focusActions) && a.focusActions[a.focusIndex] != nil {
		a.focusActions[a.focusIndex]()
	}
	a.dirty = true
}

func (a *App) targetFPS() int {
	base := a.options.FPS
	if base <= 0 {
		base = 30
	}
	if a.Capabilities.SSH {
		remote := a.options.RemoteFPS
		if remote <= 0 {
			remote = 15
		}
		return min(base, remote)
	}
	return base
}

func (a *App) quitKeys() []string {
	if a.options.QuitKeys != nil {
		return a.options.QuitKeys
	}
	return []string{"ctrl+c", "q"}
}

// Start runs the loop and returns when the app exits.
func (a *App) Start() {
	if a.running {
		return
	}
	a.running = true
	a.startedAt = time.Now()
	a.lastPoll = time.Now()
	a.Terminal.Enter()
	defer a.Stop()

	interval := time.Duration(max(8, 1000/a.targetFPS())) * time.Millisecond
	a.Frame()

	for a.running {
		waited := time.Since(a.lastPoll)
		if waited < interval {
			time.Sleep(interval - waited)
			waited = time.Since(a.lastPoll)
		}
		a.lastPoll = time.Now()

		if a.Terminal.TerminationSignal() != 0 {
			a.running = false
			break
		}
		if a.Terminal.TakeResize() {
			size := a.Terminal.Size()
			a.current.Resize(size.Columns, size.Rows)
			a.previous.Resize(size.Columns, size.Rows)
			a.forceRepaint = true
			a.dirty = true
			for _, fn := range a.resizeHandlers {
				fn(size)
			}
		}

		for _, event := range a.Terminal.PollInput(waited) {
			a.handleInput(event)
		}
		if a.options.AlwaysRender || a.dirty {
			a.Frame()
		}
	}
}

// Stop ends the loop and restores the terminal.
func (a *App) Stop() {
	if !a.running && !a.Terminal.entered {
		return
	}
	a.running = false
	a.Terminal.Restore()
	for _, fn := range a.exitHandlers {
		fn()
	}
	a.exitHandlers = nil
}

// Quit is an alias for Stop, matching what users type in their key handlers.
func (a *App) Quit() { a.running = false }

func (a *App) handleInput(event InputEvent) {
	switch event.Kind {
	case EventKey:
		for _, k := range a.quitKeys() {
			if MatchKey(event, k) {
				for _, fn := range a.keyHandlers {
					fn(event)
				}
				a.running = false
				return
			}
		}
		if !a.options.NoFocusNavigation {
			switch event.Name {
			case "tab":
				delta := 1
				if event.Shift {
					delta = -1
				}
				a.FocusNext(delta)
			case "enter", "space":
				a.ActivateFocused()
			}
		}
		for _, fn := range a.keyHandlers {
			fn(event)
		}
		a.dirty = true
	case EventMouse:
		a.dispatchMouse(event)
		for _, fn := range a.mouseHandlers {
			fn(event)
		}
	case EventPaste:
		for _, fn := range a.pasteHandlers {
			fn(event)
		}
		a.dirty = true
	case EventFocus:
		for _, fn := range a.focusHandlers {
			fn(event)
		}
	}
}

func (a *App) dispatchMouse(event InputEvent) {
	// Later regions are drawn on top, so hit-test in reverse.
	for i := len(a.hits) - 1; i >= 0; i-- {
		hit := a.hits[i]
		if !hit.Rect.Contains(event.X, event.Y) {
			continue
		}
		switch event.Action {
		case MouseScroll:
			if hit.OnScroll != nil {
				hit.OnScroll(event.Scroll)
			}
		case MousePress:
			if hit.OnClick != nil {
				hit.OnClick(event.X-hit.Rect.X, event.Y-hit.Rect.Y, event.Button.String())
			}
		case MouseMove:
			if hit.OnHover != nil {
				hit.OnHover(event.X-hit.Rect.X, event.Y-hit.Rect.Y)
			}
		}
		a.dirty = true
		return
	}
}

// Frame builds one frame and pushes the difference to the terminal.
func (a *App) Frame() FrameStats {
	started := time.Now()
	a.dirty = false

	size := a.Terminal.Size()
	if size.Columns != a.current.Width || size.Rows != a.current.Height {
		a.current.Resize(size.Columns, size.Rows)
		a.previous.Resize(size.Columns, size.Rows)
		a.forceRepaint = true
	}

	background := a.Theme.Background
	if a.options.NoBackground {
		background = DefaultColor
	}
	a.current.Clear(background, a.Theme.Foreground)

	ctx := &frameCtx{
		theme:           a.Theme,
		capabilities:    a.Capabilities,
		width:           a.current.Width,
		height:          a.current.Height,
		frame:           a.frameCount,
		elapsed:         time.Since(a.startedAt),
		focusIndex:      a.focusIndex,
		collapseBorders: a.options.CollapseBorders,
		invalidate:      a.Invalidate,
	}

	root := RootSurface(a.current, a.Theme)
	container := newContainer(root, ctx, DirColumn, Layout{})
	a.renderFn(RenderArgs{
		UI: container, Theme: a.Theme, Capabilities: a.Capabilities,
		Width: a.current.Width, Height: a.current.Height,
		Frame: a.frameCount, Elapsed: ctx.elapsed, Focus: a.focusIndex, App: a,
	})
	container.Flush()
	for _, overlay := range ctx.overlays {
		overlay(root)
	}

	a.hits = ctx.hits
	a.focusActions = ctx.focusActions
	a.focusCount = ctx.focusCursor
	if a.focusCount > 0 && a.focusIndex >= a.focusCount {
		a.focusIndex = 0
	}

	result := a.encoder.Encode(a.previous, a.current, a.forceRepaint)
	a.forceRepaint = false

	output := result.Output
	if output != "" {
		if a.Capabilities.SynchronizedOutput {
			output = AnsiBeginSync + output + AnsiEndSync
		}
		a.Terminal.Write(output)
	}
	a.previous.CopyFrom(a.current)

	stats := FrameStats{
		Frame: a.frameCount, Render: time.Since(started),
		ChangedCells: result.ChangedCells, DirtyRows: result.DirtyRows,
		Bytes: len(output),
	}
	a.frameCount++
	a.lastStats = stats
	for _, fn := range a.frameHandlers {
		fn(stats)
	}
	return stats
}
