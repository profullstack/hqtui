package hqtui

// A theme is flat and small on purpose: every token here is one a widget
// actually reaches for. Anything deeper is computed, not configured.

type Theme struct {
	Name string
	// Dark is true for palettes designed against a dark terminal background.
	Dark bool

	Background Color
	// Surface is the panel interior, lifted slightly off the page.
	Surface    Color
	Foreground Color
	Muted      Color

	Primary   Color
	Secondary Color
	Accent    Color

	Success Color
	Warning Color
	Danger  Color
	Info    Color

	Border        Color
	BorderFocused Color
	Title         Color

	Selection     Color
	SelectionText Color
	Cursor        Color

	// Graph holds series colors for multi-line graphs, in draw order.
	Graph []Color
	// Heat is the low-to-high ramp for gauges, meters and heat bars.
	Heat []Color
}

func themeDark() Theme {
	return Theme{
		Name: "dark", Dark: true,
		Background: HexN(0x05070a), Surface: HexN(0x0a0e14),
		Foreground: HexN(0xc6d0db), Muted: HexN(0x5a6b7d),
		Primary: HexN(0x58a6ff), Secondary: HexN(0xbd93f9), Accent: HexN(0x56d4dd),
		Success: HexN(0x5fff87), Warning: HexN(0xffd75f), Danger: HexN(0xff6b6b), Info: HexN(0x56d4dd),
		Border: HexN(0x243040), BorderFocused: HexN(0x56d4dd), Title: HexN(0x7ee2ff),
		Selection: HexN(0x1d3a52), SelectionText: HexN(0xe6f2ff), Cursor: HexN(0x56d4dd),
		Graph: []Color{HexN(0x58a6ff), HexN(0x5fff87), HexN(0xff79c6), HexN(0xffd75f), HexN(0x56d4dd), HexN(0xffa657)},
		Heat:  []Color{HexN(0x5fff87), HexN(0xa8ff60), HexN(0xffd75f), HexN(0xffa657), HexN(0xff6b6b)},
	}
}

// variant is the reference's `variant(DARK, {...})`: start from dark and
// override, so anything a palette does not mention is inherited.
func variant(name string, apply func(*Theme)) Theme {
	t := themeDark()
	t.Name = name
	apply(&t)
	return t
}

func themeDracula() Theme {
	return variant("dracula", func(t *Theme) {
		t.Background, t.Surface = HexN(0x191a21), HexN(0x21222c)
		t.Foreground, t.Muted = HexN(0xf8f8f2), HexN(0x6272a4)
		t.Primary, t.Secondary, t.Accent = HexN(0xbd93f9), HexN(0xff79c6), HexN(0x8be9fd)
		t.Success, t.Warning, t.Danger, t.Info = HexN(0x50fa7b), HexN(0xf1fa8c), HexN(0xff5555), HexN(0x8be9fd)
		t.Border, t.BorderFocused, t.Title = HexN(0x44475a), HexN(0xbd93f9), HexN(0xff79c6)
		t.Selection, t.SelectionText = HexN(0x44475a), HexN(0xf8f8f2)
		t.Graph = []Color{HexN(0xbd93f9), HexN(0x50fa7b), HexN(0xff79c6), HexN(0xf1fa8c), HexN(0x8be9fd), HexN(0xffb86c)}
		t.Heat = []Color{HexN(0x50fa7b), HexN(0xf1fa8c), HexN(0xffb86c), HexN(0xff5555)}
	})
}

func themeNord() Theme {
	return variant("nord", func(t *Theme) {
		t.Background, t.Surface = HexN(0x2e3440), HexN(0x333b4a)
		t.Foreground, t.Muted = HexN(0xe5e9f0), HexN(0x7b88a1)
		t.Primary, t.Secondary, t.Accent = HexN(0x88c0d0), HexN(0xb48ead), HexN(0x8fbcbb)
		t.Success, t.Warning, t.Danger, t.Info = HexN(0xa3be8c), HexN(0xebcb8b), HexN(0xbf616a), HexN(0x81a1c1)
		t.Border, t.BorderFocused, t.Title = HexN(0x434c5e), HexN(0x88c0d0), HexN(0x8fbcbb)
		t.Selection, t.SelectionText = HexN(0x434c5e), HexN(0xeceff4)
		t.Graph = []Color{HexN(0x88c0d0), HexN(0xa3be8c), HexN(0xb48ead), HexN(0xebcb8b), HexN(0x81a1c1), HexN(0xd08770)}
		t.Heat = []Color{HexN(0xa3be8c), HexN(0xebcb8b), HexN(0xd08770), HexN(0xbf616a)}
	})
}

func themeTokyoNight() Theme {
	return variant("tokyo-night", func(t *Theme) {
		t.Background, t.Surface = HexN(0x1a1b26), HexN(0x1f2335)
		t.Foreground, t.Muted = HexN(0xc0caf5), HexN(0x565f89)
		t.Primary, t.Secondary, t.Accent = HexN(0x7aa2f7), HexN(0xbb9af7), HexN(0x7dcfff)
		t.Success, t.Warning, t.Danger, t.Info = HexN(0x9ece6a), HexN(0xe0af68), HexN(0xf7768e), HexN(0x7dcfff)
		t.Border, t.BorderFocused, t.Title = HexN(0x2f3549), HexN(0x7aa2f7), HexN(0x7dcfff)
		t.Selection, t.SelectionText = HexN(0x283457), HexN(0xc0caf5)
		t.Graph = []Color{HexN(0x7aa2f7), HexN(0x9ece6a), HexN(0xbb9af7), HexN(0xe0af68), HexN(0x7dcfff), HexN(0xff9e64)}
		t.Heat = []Color{HexN(0x9ece6a), HexN(0xe0af68), HexN(0xff9e64), HexN(0xf7768e)}
	})
}

func themeGruvbox() Theme {
	return variant("gruvbox", func(t *Theme) {
		t.Background, t.Surface = HexN(0x1d2021), HexN(0x282828)
		t.Foreground, t.Muted = HexN(0xebdbb2), HexN(0x928374)
		t.Primary, t.Secondary, t.Accent = HexN(0x83a598), HexN(0xd3869b), HexN(0x8ec07c)
		t.Success, t.Warning, t.Danger, t.Info = HexN(0xb8bb26), HexN(0xfabd2f), HexN(0xfb4934), HexN(0x83a598)
		t.Border, t.BorderFocused, t.Title = HexN(0x3c3836), HexN(0xfabd2f), HexN(0xfabd2f)
		t.Selection, t.SelectionText = HexN(0x3c3836), HexN(0xfbf1c7)
		t.Graph = []Color{HexN(0x83a598), HexN(0xb8bb26), HexN(0xd3869b), HexN(0xfabd2f), HexN(0x8ec07c), HexN(0xfe8019)}
		t.Heat = []Color{HexN(0xb8bb26), HexN(0xfabd2f), HexN(0xfe8019), HexN(0xfb4934)}
	})
}

func themeMatrix() Theme {
	return variant("matrix", func(t *Theme) {
		t.Background, t.Surface = HexN(0x000000), HexN(0x020a02)
		t.Foreground, t.Muted = HexN(0x9dff9d), HexN(0x2f6b2f)
		t.Primary, t.Secondary, t.Accent = HexN(0x00ff41), HexN(0x00c853), HexN(0x7cff7c)
		t.Success, t.Warning, t.Danger, t.Info = HexN(0x00ff41), HexN(0xd4ff00), HexN(0xff3b30), HexN(0x00e5b0)
		t.Border, t.BorderFocused, t.Title = HexN(0x12401f), HexN(0x00ff41), HexN(0x00ff41)
		t.Selection, t.SelectionText = HexN(0x0d2f14), HexN(0xc9ffc9)
		t.Graph = []Color{HexN(0x00ff41), HexN(0x00c853), HexN(0x7cff7c), HexN(0x00e5b0), HexN(0xd4ff00), HexN(0x2f9e44)}
		t.Heat = []Color{HexN(0x0f7a2e), HexN(0x00c853), HexN(0x00ff41), HexN(0xd4ff00)}
	})
}

func themeMonochrome() Theme {
	return variant("monochrome", func(t *Theme) {
		t.Background, t.Surface = HexN(0x000000), HexN(0x0b0b0b)
		t.Foreground, t.Muted = HexN(0xd0d0d0), HexN(0x6e6e6e)
		t.Primary, t.Secondary, t.Accent = HexN(0xffffff), HexN(0xc0c0c0), HexN(0xe0e0e0)
		t.Success, t.Warning, t.Danger, t.Info = HexN(0xe8e8e8), HexN(0xb8b8b8), HexN(0xffffff), HexN(0xa0a0a0)
		t.Border, t.BorderFocused, t.Title = HexN(0x3a3a3a), HexN(0xd0d0d0), HexN(0xffffff)
		t.Selection, t.SelectionText = HexN(0x303030), HexN(0xffffff)
		t.Graph = []Color{HexN(0xffffff), HexN(0xc8c8c8), HexN(0x909090), HexN(0x686868), HexN(0xb0b0b0), HexN(0x808080)}
		t.Heat = []Color{HexN(0x585858), HexN(0x909090), HexN(0xc8c8c8), HexN(0xffffff)}
	})
}

func themeHighContrast() Theme {
	return variant("high-contrast", func(t *Theme) {
		t.Background, t.Surface = HexN(0x000000), HexN(0x000000)
		t.Foreground, t.Muted = HexN(0xffffff), HexN(0xc0c0c0)
		t.Primary, t.Secondary, t.Accent = HexN(0x00ffff), HexN(0xff00ff), HexN(0xffff00)
		t.Success, t.Warning, t.Danger, t.Info = HexN(0x00ff00), HexN(0xffff00), HexN(0xff0000), HexN(0x00ffff)
		t.Border, t.BorderFocused, t.Title = HexN(0xffffff), HexN(0xffff00), HexN(0xffffff)
		t.Selection, t.SelectionText = HexN(0xffffff), HexN(0x000000)
		t.Graph = []Color{HexN(0x00ffff), HexN(0x00ff00), HexN(0xff00ff), HexN(0xffff00), HexN(0xffffff), HexN(0xff8000)}
		t.Heat = []Color{HexN(0x00ff00), HexN(0xffff00), HexN(0xff8000), HexN(0xff0000)}
	})
}

func themeLight() Theme {
	return Theme{
		Name: "light", Dark: false,
		Background: HexN(0xfbfcfd), Surface: HexN(0xffffff),
		Foreground: HexN(0x1c2530), Muted: HexN(0x6b7a8c),
		Primary: HexN(0x0b62d0), Secondary: HexN(0x7c3aed), Accent: HexN(0x0e7490),
		Success: HexN(0x128a3f), Warning: HexN(0xa86a00), Danger: HexN(0xc62828), Info: HexN(0x0e7490),
		Border: HexN(0xd3dbe4), BorderFocused: HexN(0x0b62d0), Title: HexN(0x0b3d78),
		Selection: HexN(0xd6e6fb), SelectionText: HexN(0x0b2545), Cursor: HexN(0x0b62d0),
		Graph: []Color{HexN(0x0b62d0), HexN(0x128a3f), HexN(0xa3348a), HexN(0xa86a00), HexN(0x0e7490), HexN(0xc2410c)},
		Heat:  []Color{HexN(0x128a3f), HexN(0x7aa300), HexN(0xa86a00), HexN(0xc2410c), HexN(0xc62828)},
	}
}

type namedTheme struct {
	Key   string
	Build func() Theme
}

// Themes lists every built-in, in the reference implementation's order. The key
// is what callers pass to ResolveTheme; both "tokyoNight" and "tokyo-night"
// reach the same palette.
var Themes = []namedTheme{
	{"dark", themeDark},
	{"dracula", themeDracula},
	{"nord", themeNord},
	{"tokyoNight", themeTokyoNight},
	{"gruvbox", themeGruvbox},
	{"matrix", themeMatrix},
	{"monochrome", themeMonochrome},
	{"highContrast", themeHighContrast},
	{"light", themeLight},
}

// ResolveTheme looks a theme up by key or by its own Name. Unknown names fall
// back to dark, because a mistyped theme should not stop an app from starting.
func ResolveTheme(name string) Theme {
	for _, t := range Themes {
		if t.Key == name {
			return t.Build()
		}
	}
	for _, t := range Themes {
		if built := t.Build(); built.Name == name {
			return built
		}
	}
	return themeDark()
}

// Elevate is a slightly lifted or dropped shade of the surface, for zebra rows
// and tracks.
func Elevate(t Theme, amount float64) Color {
	towards := HexN(0x000000)
	if t.Dark {
		towards = HexN(0xffffff)
	}
	return t.Surface.Mix(towards, amount)
}

// HeatColor maps a 0-1 ratio along the theme's heat ramp: green when idle, red
// when hot.
func HeatColor(t Theme, ratio float64) Color { return GradientOf(t.Heat).Sample(ratio) }

// SeriesColor is the nth series color, wrapping around. Negative indices wrap
// from the end.
func SeriesColor(t Theme, index int) Color {
	n := len(t.Graph)
	if n == 0 {
		return DefaultColor
	}
	return t.Graph[((index%n)+n)%n]
}
