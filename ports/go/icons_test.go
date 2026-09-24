package hqtui

// The same cases as packages/hqtui/test/icons.test.ts.

import (
	"sort"
	"testing"
)

func TestIconModesAndAliases(t *testing.T) {
	cases := []struct {
		name string
		mode IconMode
		want string
	}{
		{"mail", IconNerd, "\U000f01f0"},
		{"mail", IconUnicode, "✉"},
		{"mail", IconASCII, "@"},
		{"email", IconASCII, "@"},
		{"twitter", IconASCII, "x"},
		{"no-such-icon", IconUnicode, ""},
	}
	for _, c := range cases {
		if got := IconIn(c.name, c.mode); got != c.want {
			t.Errorf("IconIn(%q, %s) = %q, want %q", c.name, c.mode, got, c.want)
		}
	}
}

func TestIconNerdFallsBackToUnicode(t *testing.T) {
	for _, row := range openIconGlyphs {
		if row[1] == "" {
			if got := IconIn(row[0], IconNerd); got != row[2] {
				t.Fatalf("%s: nerd fallback = %q, want %q", row[0], got, row[2])
			}
			return
		}
	}
	t.Fatal("expected at least one icon without a Nerd glyph")
}

func TestIconModeOrder(t *testing.T) {
	checks := []struct {
		env  Env
		want IconMode
	}{
		{Env{"OPENICON_GLYPHS": "ascii", "NERD_FONT": "1", "LANG": "en_US.UTF-8"}, IconASCII},
		{Env{"HQTUI_ICONS": "nerd"}, IconNerd},
		{Env{"NERD_FONT": "1"}, IconNerd},
		{Env{"LANG": "en_US.UTF-8", "TERM": "xterm-256color"}, IconUnicode},
		{Env{"TERM": "dumb"}, IconASCII},
	}
	for _, c := range checks {
		if got := IconModeIn(c.env, false); got != c.want {
			t.Errorf("IconModeIn(%v) = %s, want %s", c.env, got, c.want)
		}
	}
	SetIconMode(IconASCII)
	defer SetIconMode("")
	if got := IconModeIn(Env{"NERD_FONT": "1"}, false); got != IconASCII {
		t.Errorf("SetIconMode should win, got %s", got)
	}
}

func TestIconTableSortedAndComplete(t *testing.T) {
	names := IconNames()
	if len(names) < 300 {
		t.Fatalf("only %d icons", len(names))
	}
	if !sort.StringsAreSorted(names) {
		t.Fatal("icons_data.go is not sorted by key")
	}
	for _, row := range openIconGlyphs {
		if row[2] == "" || row[3] == "" {
			t.Errorf("%s has an empty fallback", row[0])
		}
	}
}
