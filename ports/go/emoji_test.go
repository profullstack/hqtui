package hqtui

import "testing"

func TestEmojiBuiltInAndOnByDefault(t *testing.T) {
	if n := len(EmojiNames()); n < 3900 {
		t.Fatalf("EmojiNames() = %d, want every fully-qualified emoji", n)
	}
	for _, name := range []string{"fire", "oe_fire", ":oe_fire:", ":fire:", "FIRE", "🔥"} {
		if got := EmojiIn(name, EmojiModeEmoji); got != "🔥" {
			t.Errorf("EmojiIn(%q) = %q", name, got)
		}
	}
	cases := map[string]string{"thumbsup": "👍", "+1": "👍", "heart": "❤️", "❤": "❤️", "face with tears of joy": "😂", "thumbs_up_t3": "👍🏽"}
	for name, want := range cases {
		if got := EmojiIn(name, EmojiModeEmoji); got != want {
			t.Errorf("EmojiIn(%q) = %q, want %q", name, got, want)
		}
	}
	if got := EmojiIn("no such emoji", EmojiModeEmoji); got != "" {
		t.Errorf("unknown name = %q", got)
	}
}

func TestEmojiTonesAndText(t *testing.T) {
	e, _ := EmojiInfoOf("👩🏾‍💻")
	if e.Shortcode != "oe_woman_technologist_t4" || e.Name != "woman technologist: medium-dark skin tone" {
		t.Errorf("tone info = %+v", e)
	}
	texts := map[string]string{"slightly smiling face": ":)", "heart": "<3", "thumbs_up_t3": "+1", "fire": "[fire]"}
	for name, want := range texts {
		if got := EmojiIn(name, EmojiModeText); got != want {
			t.Errorf("text %q = %q, want %q", name, got, want)
		}
	}
}

func TestEmojiModeOrder(t *testing.T) {
	if m := EmojiModeIn(Env{"HQTUI_EMOJI": "text", "LANG": "en_US.UTF-8"}, false); m != EmojiModeText {
		t.Errorf("env override = %s", m)
	}
	if m := EmojiModeIn(Env{"LANG": "en_US.UTF-8", "TERM": "linux"}, false); m != EmojiModeText {
		t.Errorf("linux console = %s", m)
	}
	if m := EmojiModeIn(Env{"LANG": "en_US.UTF-8", "TERM": "xterm-256color"}, false); m != EmojiModeEmoji {
		t.Errorf("unicode terminal = %s", m)
	}
	SetEmojiMode(EmojiModeText)
	defer SetEmojiMode("")
	if m := EmojiModeIn(Env{"HQTUI_EMOJI": "emoji"}, false); m != EmojiModeText {
		t.Errorf("app choice = %s", m)
	}
}

func TestEmojifyAndSearch(t *testing.T) {
	if got := EmojifyIn("ship :rocket: :+1: at 12:30:00 :nope:", EmojiModeEmoji); got != "ship 🚀 👍 at 12:30:00 :nope:" {
		t.Errorf("EmojifyIn = %q", got)
	}
	if got := EmojiSearch("fire", 5); len(got) == 0 || got[0].Char != "🔥" {
		t.Errorf("search fire = %+v", got)
	}
	found := false
	for _, e := range EmojiSearch("japan", 20) {
		found = found || e.Char == "🇯🇵"
	}
	if !found {
		t.Error("search japan misses the flag")
	}
}

func TestEmojiAreTwoColumns(t *testing.T) {
	for _, name := range []string{"fire", "thumbs_up_t3", "flag_japan", "keycap_hash", "heart", "woman_technologist_t4"} {
		if w := StringWidth(EmojiIn(name, EmojiModeEmoji)); w != 2 {
			t.Errorf("width of %s = %d", name, w)
		}
	}
}
