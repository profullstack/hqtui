package hqtui

// Icons for terminals: Icon("mail") is the best glyph this terminal can draw.
//
// The built-in pack is OpenIcon (https://logicsrc.com/openicon), on by
// default, generated into icons_data.go from the same set as the TypeScript
// reference, so an icon is the same glyph in every port. Which of its three
// glyphs you get: SetIconMode if the app chose; OPENICON_GLYPHS or
// HQTUI_ICONS; NERD_FONT=1 for Nerd Font glyphs; otherwise Unicode where the
// terminal draws it and ASCII where it does not. A Nerd Font is never assumed:
// it cannot be detected from inside the terminal.

import "sync"

// IconMode picks one of an icon's three glyphs.
type IconMode string

const (
	IconNerd    IconMode = "nerd"
	IconUnicode IconMode = "unicode"
	IconASCII   IconMode = "ascii"
)

// IconGlyphs are the three spellings of one icon. Nerd is empty when Nerd
// Fonts has no glyph for it.
type IconGlyphs struct {
	Nerd, Unicode, ASCII string
}

var (
	iconMu      sync.RWMutex
	iconChosen  IconMode
	iconByKey   map[string]IconGlyphs
	iconsLoaded sync.Once
)

func loadIcons() {
	iconsLoaded.Do(func() {
		iconByKey = make(map[string]IconGlyphs, len(openIconGlyphs))
		for _, row := range openIconGlyphs {
			iconByKey[row[0]] = IconGlyphs{Nerd: row[1], Unicode: row[2], ASCII: row[3]}
		}
	})
}

// SetIconMode pins the glyph family for the whole app; "" detects again.
func SetIconMode(mode IconMode) {
	iconMu.Lock()
	iconChosen = mode
	iconMu.Unlock()
}

// IconModeIn is the glyph family an environment gets, in the order above.
func IconModeIn(env Env, windows bool) IconMode {
	iconMu.RLock()
	chosen := iconChosen
	iconMu.RUnlock()
	if chosen != "" {
		return chosen
	}
	named := env.get("OPENICON_GLYPHS")
	if named == "" {
		named = env.get("HQTUI_ICONS")
	}
	switch IconMode(named) {
	case IconNerd, IconUnicode, IconASCII:
		return IconMode(named)
	}
	if env.get("NERD_FONT") == "1" || env.get("NERD_FONTS") == "1" {
		return IconNerd
	}
	if detectUnicode(env, windows) {
		return IconUnicode
	}
	return IconASCII
}

// IconGlyphsOf returns an icon's glyphs by key or alias.
func IconGlyphsOf(name string) (IconGlyphs, bool) {
	loadIcons()
	if g, ok := iconByKey[name]; ok {
		return g, true
	}
	g, ok := iconByKey[openIconAliases[name]]
	return g, ok
}

// IconIn is an icon's glyph in a given mode. Unknown names return "".
func IconIn(name string, mode IconMode) string {
	g, ok := IconGlyphsOf(name)
	if !ok {
		return ""
	}
	switch mode {
	case IconNerd:
		if g.Nerd != "" {
			return g.Nerd
		}
		return g.Unicode
	case IconUnicode:
		return g.Unicode
	default:
		return g.ASCII
	}
}

// Icon is the best glyph for an icon in this process's terminal.
func Icon(name string) string {
	return IconIn(name, IconModeIn(ProcessEnv(), runningOnWindows()))
}

// IconNames lists every key in the built-in pack, sorted.
func IconNames() []string {
	names := make([]string, len(openIconGlyphs))
	for i, row := range openIconGlyphs {
		names[i] = row[0]
	}
	return names
}
