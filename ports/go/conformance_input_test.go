package hqtui

// Conformance for the input parser: the same byte chunks, in the same order,
// must decode to the same events — including the awkward cases where a sequence
// or a bracketed-paste end marker straddles two reads.

import (
	"fmt"
	"testing"
)

func describeEvent(e InputEvent) string {
	switch e.Kind {
	case EventKey:
		char := "none"
		if e.HasChar {
			char = fmt.Sprintf("%q", e.Char)
		}
		return fmt.Sprintf("key name=%s key=%s ctrl=%v alt=%v shift=%v char=%s raw=%q",
			e.Name, e.Key, e.Ctrl, e.Alt, e.Shift, char, e.Raw)
	case EventMouse:
		return fmt.Sprintf("mouse action=%s button=%s x=%d y=%d scroll=%d ctrl=%v alt=%v shift=%v",
			e.Action, e.Button, e.X, e.Y, e.Scroll, e.Ctrl, e.Alt, e.Shift)
	case EventPaste:
		return fmt.Sprintf("paste text=%q", e.Text)
	}
	return fmt.Sprintf("focus focused=%v", e.Focused)
}

func describeFixtureEvent(t *testing.T, v any) string {
	switch str(get(v, "type")) {
	case "key":
		char := "none"
		// JSON.stringify drops an undefined `char` entirely.
		if has(v, "char") {
			char = fmt.Sprintf("%q", str(get(v, "char")))
		}
		return fmt.Sprintf("key name=%s key=%s ctrl=%v alt=%v shift=%v char=%s raw=%q",
			str(get(v, "name")), str(get(v, "key")), boolean(get(v, "ctrl")),
			boolean(get(v, "alt")), boolean(get(v, "shift")), char, str(get(v, "raw")))
	case "mouse":
		return fmt.Sprintf("mouse action=%s button=%s x=%d y=%d scroll=%d ctrl=%v alt=%v shift=%v",
			str(get(v, "action")), str(get(v, "button")), i(get(v, "x")), i(get(v, "y")),
			i(get(v, "scroll")), boolean(get(v, "ctrl")), boolean(get(v, "alt")),
			boolean(get(v, "shift")))
	case "paste":
		return fmt.Sprintf("paste text=%q", str(get(v, "text")))
	case "focus":
		return fmt.Sprintf("focus focused=%v", boolean(get(v, "focused")))
	}
	t.Fatalf("unknown event type %q", str(get(v, "type")))
	return ""
}

func TestInputMatchesReference(t *testing.T) {
	cases := arr(fixture(t, "input"))
	if len(cases) == 0 {
		t.Fatal("no input fixtures loaded")
	}

	for _, c := range cases {
		name := str(get(c, "name"))
		parser := NewInputParser()
		var events []InputEvent
		for _, chunk := range arr(get(c, "chunks")) {
			events = append(events, parser.Parse(str(chunk))...)
		}
		if boolean(get(c, "flush")) {
			events = append(events, parser.Flush()...)
		}

		want := arr(get(c, "events"))
		if len(events) != len(want) {
			t.Errorf("%s: %d events, want %d", name, len(events), len(want))
			for _, e := range events {
				t.Logf("  got  %s", describeEvent(e))
			}
			for _, w := range want {
				t.Logf("  want %s", describeFixtureEvent(t, w))
			}
			continue
		}
		for k := range want {
			got := describeEvent(events[k])
			expected := describeFixtureEvent(t, want[k])
			if got != expected {
				t.Errorf("%s: event %d\n got %s\nwant %s", name, k, got, expected)
			}
		}
		if parser.HasPending() != boolean(get(c, "pending")) {
			t.Errorf("%s: pending %v, want %v", name, parser.HasPending(), boolean(get(c, "pending")))
		}
	}
}
