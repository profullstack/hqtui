package demo

import (
	"errors"
	"flag"
	"fmt"
	ui "github.com/profullstack/hqtui/ports/go"
	"io"
	"math"
	"os"
	"time"
)

const version = "0.1.12"

type options struct {
	sim, real, snapshot, version bool
	seed                         uint64
	fps, width, height, ticks    int
	interval                     float64
	theme, screen, format        string
}

func parse(args []string, output io.Writer) (options, error) {
	a := options{}
	f := flag.NewFlagSet("hqtui-demo-go", flag.ContinueOnError)
	f.SetOutput(output)
	f.BoolVar(&a.sim, "sim", false, "seeded simulation")
	f.BoolVar(&a.real, "real", false, "read-only real metrics")
	f.BoolVar(&a.snapshot, "snapshot", false, "one headless frame (defaults to simulation)")
	f.BoolVar(&a.version, "version", false, "print version")
	f.Uint64Var(&a.seed, "seed", 1337, "unsigned 32-bit simulation seed")
	f.IntVar(&a.fps, "fps", 30, "frame cap, 1–120")
	f.Float64Var(&a.interval, "interval", 1, "real metrics interval in seconds")
	f.IntVar(&a.width, "width", 160, "snapshot columns")
	f.IntVar(&a.height, "height", 50, "snapshot rows")
	f.IntVar(&a.ticks, "ticks", 0, "simulation steps before snapshot")
	f.StringVar(&a.theme, "theme", "dark", "built-in theme")
	f.StringVar(&a.screen, "screen", "dashboard", "initial screen")
	f.StringVar(&a.format, "format", "text", "text, ansi or html")
	if err := f.Parse(args); err != nil {
		return a, err
	}
	if f.NArg() > 0 {
		return a, fmt.Errorf("unexpected argument: %s", f.Arg(0))
	}
	if a.version {
		return a, nil
	}
	if a.sim && a.real || a.seed > math.MaxUint32 || a.fps < 1 || a.fps > 120 || math.IsNaN(a.interval) || math.IsInf(a.interval, 0) || a.interval < .05 || a.interval > 60 || a.width < 1 || a.width > 500 || a.height < 1 || a.height > 200 || a.ticks < 0 || a.ticks > 10000 || index(themes, a.theme) < 0 || index(screens, a.screen) < 0 || index([]string{"text", "ansi", "html"}, a.format) < 0 {
		return a, errors.New("invalid options; use --help for supported values")
	}
	return a, nil
}
func run(args []string) int {
	a, err := parse(args, os.Stderr)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	if a.version {
		fmt.Println(version)
		return 0
	}
	if !a.snapshot {
		in, _ := os.Stdin.Stat()
		out, _ := os.Stdout.Stat()
		if in == nil || out == nil || in.Mode()&os.ModeCharDevice == 0 || out.Mode()&os.ModeCharDevice == 0 {
			fmt.Fprintln(os.Stderr, "An interactive terminal is required. Use --snapshot for headless output.")
			return 2
		}
	}
	real := a.real || (!a.sim && !a.snapshot)
	s := newState(real, uint32(a.seed))
	s.theme = index(themes, a.theme)
	s.screen = index(screens, a.screen)
	var source *collector
	if real {
		source = newCollector()
		source.refresh()
		s.sample = clone(source.sample)
		s.missing = append([]string{}, source.missing...)
	} else {
		for i := 0; i < a.ticks; i++ {
			s.simulate()
		}
	}
	if a.snapshot {
		frame := ui.RenderToScreen(a.width, a.height, a.theme, s.render)
		switch a.format {
		case "ansi":
			fmt.Println(frame.ANSI())
		case "html":
			fmt.Println(ui.RenderToHTML(frame, ui.HTMLOptions{}))
		default:
			fmt.Println(frame.Text())
		}
		return 0
	}
	app := ui.NewApp(ui.AppOptions{Theme: a.theme, FPS: a.fps, AlwaysRender: true, QuitKeys: []string{}, NoFocusNavigation: true})
	app.OnKey(func(e ui.InputEvent) {
		if s.key(e.Key, e.Char) {
			app.Quit()
		}
		if app.Theme.Name != themes[s.theme] {
			app.SetTheme(themes[s.theme])
		}
	})
	app.OnMouse(func(e ui.InputEvent) {
		s.lastMouse = fmt.Sprintf("%s %d,%d wheel=%d", e.Action.String(), e.X, e.Y, e.Scroll)
	})
	app.OnPaste(func(e ui.InputEvent) {
		if s.editing {
			s.input = appendText(s.input, e.Text)
		} else if s.filtering {
			s.filter = appendText(s.filter, e.Text)
		} else if s.palette {
			s.query = appendText(s.query, e.Text)
		}
	})
	type result struct {
		sample  object
		missing []string
	}
	results := make(chan result, 1)
	busy := false
	next := time.Time{}
	lastFrame := time.Now()
	app.Render(func(frame ui.RenderArgs) {
		select {
		case r := <-results:
			busy = false
			if !s.paused {
				s.sample = r.sample
				s.missing = r.missing
			}
		default:
		}
		now := time.Now()
		s.fps = 1 / math.Max(.001, now.Sub(lastFrame).Seconds())
		lastFrame = now
		s.clock = now.UTC().Format("15:04:05")
		stats := app.Stats()
		s.renderMs = float64(stats.Render) / float64(time.Millisecond)
		s.changedCells = stats.ChangedCells
		s.outputBytes = stats.Bytes
		if !s.paused && !busy && now.After(next) {
			if real {
				busy = true
				go func() {
					source.refresh()
					results <- result{clone(source.sample), append([]string{}, source.missing...)}
				}()
				next = now.Add(time.Duration(a.interval * float64(time.Second)))
			} else {
				s.simulate()
				next = now.Add(100 * time.Millisecond)
			}
		}
		if app.Theme.Name != themes[s.theme] {
			app.SetTheme(themes[s.theme])
		}
		s.render(frame.UI)
	})
	app.Start()
	// Let the one bounded read-only collection finish before the CLI exits.
	// Otherwise os.Exit in either launcher can orphan its utility subprocesses.
	if busy {
		<-results
	}
	return 0
}

// Main is shared by the documented example and the standalone CLI.
func Main(args []string) int { return run(args) }
