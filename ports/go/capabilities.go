package hqtui

import (
	"os"
	"strings"
)

// What the terminal can actually do. Detection is deliberately conservative: we
// degrade colors and glyphs rather than print mojibake on someone's console.

type ColorDepth int

const (
	ColorTrueColor ColorDepth = iota
	ColorAnsi256
	ColorAnsi16
	ColorNone
)

func (c ColorDepth) String() string {
	switch c {
	case ColorTrueColor:
		return "truecolor"
	case ColorAnsi256:
		return "ansi256"
	case ColorAnsi16:
		return "ansi16"
	}
	return "none"
}

func ParseColorDepth(s string) (ColorDepth, bool) {
	switch s {
	case "truecolor":
		return ColorTrueColor, true
	case "ansi256":
		return ColorAnsi256, true
	case "ansi16":
		return ColorAnsi16, true
	case "none":
		return ColorNone, true
	}
	return ColorTrueColor, false
}

type Capabilities struct {
	// TTY reports whether stdout is a real terminal, not a pipe or a file.
	TTY       bool
	Colors    ColorDepth
	TrueColor bool
	Unicode   bool
	Braille   bool
	Mouse     bool
	// SynchronizedOutput is DEC 2026 atomic frame updates.
	SynchronizedOutput bool
	BracketedPaste     bool
	FocusEvents        bool
	Tmux               bool
	Screen             bool
	SSH                bool
	Windows            bool
	// Program is a best guess at the emulator: kitty, wezterm, ghostty, iterm,
	// alacritty, vscode, windows-terminal, xterm, unknown.
	Program string
}

// CapabilityOverrides forces a capability rather than detecting it. Used by
// tests and by apps that know better than the environment does.
type CapabilityOverrides struct {
	Colors             *ColorDepth
	Unicode            *bool
	Braille            *bool
	Mouse              *bool
	SynchronizedOutput *bool
	TTY                *bool
}

// Env is the environment as a map, so detection is testable without touching
// the real process environment.
type Env map[string]string

func ProcessEnv() Env {
	env := Env{}
	for _, kv := range os.Environ() {
		if k, v, ok := strings.Cut(kv, "="); ok {
			env[k] = v
		}
	}
	return env
}

func (e Env) get(key string) string  { return e[key] }
func (e Env) has(key string) bool    { return e[key] != "" }

func DetectProgram(env Env) string {
	term := env.get("TERM")
	program := env.get("TERM_PROGRAM")
	switch {
	case env.has("KITTY_WINDOW_ID") || term == "xterm-kitty":
		return "kitty"
	case env.has("WEZTERM_EXECUTABLE") || program == "WezTerm":
		return "wezterm"
	case env.has("GHOSTTY_RESOURCES_DIR") || term == "xterm-ghostty":
		return "ghostty"
	case program == "iTerm.app":
		return "iterm"
	case env.has("ALACRITTY_WINDOW_ID") || term == "alacritty":
		return "alacritty"
	case program == "vscode":
		return "vscode"
	case env.has("WT_SESSION"):
		return "windows-terminal"
	case program == "Apple_Terminal":
		return "apple-terminal"
	case env.has("KONSOLE_VERSION"):
		return "konsole"
	case strings.HasPrefix(term, "xterm"):
		return "xterm"
	}
	return "unknown"
}

var truecolorPrograms = map[string]bool{
	"kitty": true, "wezterm": true, "ghostty": true, "iterm": true,
	"vscode": true, "windows-terminal": true, "konsole": true,
}

func detectColors(env Env, tty bool) ColorDepth {
	if env.has("NO_COLOR") {
		return ColorNone
	}
	switch env.get("FORCE_COLOR") {
	case "0", "false":
		return ColorNone
	case "1":
		return ColorAnsi16
	case "2":
		return ColorAnsi256
	case "3":
		return ColorTrueColor
	}
	// Any other non-empty value — FORCE_COLOR=true is the common one — asserts
	// that color works. It is a floor, not a ceiling: returning a level here
	// would cap a truecolor terminal at 16 colors. It only waives the tty check.
	forced := env.has("FORCE_COLOR")
	if !tty && !forced {
		return ColorNone
	}
	term := env.get("TERM")
	if term == "dumb" {
		return ColorNone
	}
	switch strings.ToLower(env.get("COLORTERM")) {
	case "truecolor", "24bit":
		return ColorTrueColor
	}
	if truecolorPrograms[DetectProgram(env)] {
		return ColorTrueColor
	}
	if strings.Contains(term, "256") {
		return ColorAnsi256
	}
	return ColorAnsi16
}

func detectUnicode(env Env, windows bool) bool {
	// A dumb terminal has no glyph repertoire to speak of. The Linux console is
	// not in that category — its default font draws box and block elements
	// perfectly well — so only Braille is withheld from it, below.
	if env.get("TERM") == "dumb" {
		return false
	}
	locale := env.get("LC_ALL")
	if locale == "" {
		locale = env.get("LC_CTYPE")
	}
	if locale == "" {
		locale = env.get("LANG")
	}
	upper := strings.ToUpper(locale)
	if strings.Contains(upper, "UTF8") || strings.Contains(upper, "UTF-8") {
		return true
	}
	// Windows Terminal and modern emulators are UTF-8 regardless of locale vars.
	if env.has("WT_SESSION") || env.has("TERM_PROGRAM") || env.has("KITTY_WINDOW_ID") {
		return true
	}
	if windows {
		return env.has("WT_SESSION")
	}
	return locale == ""
}

var syncPrograms = map[string]bool{
	"kitty": true, "wezterm": true, "ghostty": true, "iterm": true,
	"windows-terminal": true, "konsole": true, "alacritty": true,
}

func DetectCapabilities(o CapabilityOverrides) Capabilities {
	return DetectCapabilitiesIn(o, ProcessEnv(), isTerminal())
}

func DetectCapabilitiesIn(o CapabilityOverrides, env Env, isTTY bool) Capabilities {
	tty := isTTY
	if o.TTY != nil {
		tty = *o.TTY
	}
	term := env.get("TERM")
	program := DetectProgram(env)
	tmux := env.has("TMUX") || strings.HasPrefix(term, "tmux") || strings.HasPrefix(term, "screen")
	screen := strings.HasPrefix(term, "screen") && !env.has("TMUX")
	ssh := env.has("SSH_CLIENT") || env.has("SSH_TTY") || env.has("SSH_CONNECTION")

	colors := detectColors(env, tty)
	if o.Colors != nil {
		colors = *o.Colors
	}
	windows := runningOnWindows()
	unicode := detectUnicode(env, windows)
	if o.Unicode != nil {
		unicode = *o.Unicode
	}
	// The Linux console draws box and block elements but has no Braille in its
	// default font, which is the one glyph class it genuinely lacks.
	braille := unicode && program != "apple-terminal" && term != "linux"
	if o.Braille != nil {
		braille = *o.Braille
	}
	mouse := tty && term != "dumb" && term != "linux"
	if o.Mouse != nil {
		mouse = *o.Mouse
	}
	sync := tty && (syncPrograms[program] || tmux)
	if o.SynchronizedOutput != nil {
		sync = *o.SynchronizedOutput
	}

	return Capabilities{
		TTY:                tty,
		Colors:             colors,
		TrueColor:          colors == ColorTrueColor,
		Unicode:            unicode,
		Braille:            braille,
		Mouse:              mouse,
		SynchronizedOutput: sync,
		BracketedPaste:     tty && term != "dumb",
		FocusEvents:        tty && term != "dumb" && !screen,
		Tmux:               tmux,
		Screen:             screen,
		SSH:                ssh,
		Windows:            windows,
		Program:            program,
	}
}
