package hqtui

import (
	"fmt"
	"strings"
)

// Raw VT/ANSI control sequences. Nothing above this layer writes an escape by
// hand.

const (
	ESC = "\x1b"
	CSI = "\x1b["

	AnsiReset = "\x1b[0m"

	AnsiAlternateScreenOn  = "\x1b[?1049h"
	AnsiAlternateScreenOff = "\x1b[?1049l"

	AnsiCursorHide    = "\x1b[?25l"
	AnsiCursorShow    = "\x1b[?25h"
	AnsiCursorHome    = "\x1b[H"
	AnsiCursorSave    = "\x1b7"
	AnsiCursorRestore = "\x1b8"

	AnsiClearScreen     = "\x1b[2J"
	AnsiClearScrollback = "\x1b[3J"
	AnsiClearLine       = "\x1b[2K"
	AnsiClearToEnd      = "\x1b[0J"

	// 1000 = clicks, 1002 = drag, 1003 = any motion, 1006 = SGR extended coords.
	AnsiMouseOn  = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h"
	AnsiMouseOff = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l"

	AnsiBracketedPasteOn  = "\x1b[?2004h"
	AnsiBracketedPasteOff = "\x1b[?2004l"

	AnsiFocusOn  = "\x1b[?1004h"
	AnsiFocusOff = "\x1b[?1004l"

	// AnsiBeginSync starts an atomic frame: the terminal shows nothing until
	// AnsiEndSync. Kills tearing.
	AnsiBeginSync = "\x1b[?2026h"
	AnsiEndSync   = "\x1b[?2026l"

	AnsiSoftReset = "\x1b[!p"

	AnsiFgDefault = "\x1b[39m"
	AnsiBgDefault = "\x1b[49m"
)

func MoveTo(x, y int) string { return fmt.Sprintf("\x1b[%d;%dH", y+1, x+1) }

func MoveRight(n int) string {
	if n == 1 {
		return "\x1b[C"
	}
	return fmt.Sprintf("\x1b[%dC", n)
}

func MoveToColumn(x int) string { return fmt.Sprintf("\x1b[%dG", x+1) }

// SetTitle interpolates a title into an OSC sequence, so anything that could
// end or restart it has to go. StripUnsafe is the same policy the grid uses.
func SetTitle(title string) string { return "\x1b]0;" + StripUnsafe(title) + "\x07" }

func FgTrue(r, g, b int) string { return fmt.Sprintf("\x1b[38;2;%d;%d;%dm", r, g, b) }
func BgTrue(r, g, b int) string { return fmt.Sprintf("\x1b[48;2;%d;%d;%dm", r, g, b) }
func Fg256(i int) string        { return fmt.Sprintf("\x1b[38;5;%dm", i) }
func Bg256(i int) string        { return fmt.Sprintf("\x1b[48;5;%dm", i) }

func Fg16(i int) string {
	if i < 8 {
		return fmt.Sprintf("\x1b[%dm", 30+i)
	}
	return fmt.Sprintf("\x1b[%dm", 90+i-8)
}

func Bg16(i int) string {
	if i < 8 {
		return fmt.Sprintf("\x1b[%dm", 40+i)
	}
	return fmt.Sprintf("\x1b[%dm", 100+i-8)
}

// StripAnsi removes escape sequences — used by the headless renderer and by
// tests, and exported for apps that want to sanitise text themselves.
//
// Two things the obvious approach misses, both of which leave a live sequence
// behind: CSI may carry intermediate bytes (0x20-0x2f) before its final byte,
// as in `ESC [ 0 SP q`; and every sequence has an 8-bit C1 form where a single
// byte replaces `ESC x`. After the structured pass, anything still holding a
// control or bidi override is removed outright, so the result cannot steer a
// terminal even if a form was missed.
func StripAnsi(text string) string {
	runes := []rune(text)
	n := len(runes)
	var b strings.Builder
	i := 0

	for i < n {
		c := runes[i]

		// CSI: ESC [ … or the C1 form, U+009B.
		csiStart := -1
		if c == 0x1b && i+1 < n && runes[i+1] == '[' {
			csiStart = i + 2
		} else if c == 0x9b {
			csiStart = i + 1
		}
		if csiStart >= 0 {
			j := csiStart
			for j < n && isCSIParam(runes[j]) {
				j++
			}
			for j < n && runes[j] >= 0x20 && runes[j] <= 0x2f {
				j++
			}
			// Without a final byte this is not a sequence yet; fall through and
			// let the unsafe pass below drop the bare ESC.
			if j < n && runes[j] >= 0x40 && runes[j] <= 0x7e {
				i = j + 1
				continue
			}
		}

		// OSC: ESC ] … terminated by BEL, ST, C1 ST, or end of string.
		oscStart := -1
		if c == 0x1b && i+1 < n && runes[i+1] == ']' {
			oscStart = i + 2
		} else if c == 0x9d {
			oscStart = i + 1
		}
		if oscStart >= 0 {
			i = scanToTerminator(runes, oscStart, true)
			continue
		}

		// DCS: ESC P … terminated by ST, C1 ST, or end of string.
		dcsStart := -1
		if c == 0x1b && i+1 < n && runes[i+1] == 'P' {
			dcsStart = i + 2
		} else if c == 0x90 {
			dcsStart = i + 1
		}
		if dcsStart >= 0 {
			i = scanToTerminator(runes, dcsStart, false)
			continue
		}

		// Any other two-character escape: ESC then 0x40-0x5A or 0x5C-0x5F.
		if c == 0x1b && i+1 < n {
			next := runes[i+1]
			if (next >= 0x40 && next <= 0x5a) || (next >= 0x5c && next <= 0x5f) {
				i += 2
				continue
			}
		}

		b.WriteRune(c)
		i++
	}

	// The grid's unsafe set minus tab, newline and carriage return. This works
	// on text, not cells, and multi-line callers rely on those three; the
	// framebuffer refuses them separately, which is the right layer for it.
	var out strings.Builder
	for _, r := range b.String() {
		if !isTextUnsafe(r) {
			out.WriteRune(r)
		}
	}
	return out.String()
}

func isCSIParam(r rune) bool {
	return (r >= '0' && r <= '9') || r == ';' || r == '?' || r == '<' || r == '=' || r == '>'
}

func scanToTerminator(runes []rune, from int, belTerminates bool) int {
	n := len(runes)
	for j := from; j < n; j++ {
		switch {
		case belTerminates && runes[j] == 0x07:
			return j + 1
		case runes[j] == 0x9c:
			return j + 1
		case runes[j] == 0x1b && j+1 < n && runes[j+1] == '\\':
			return j + 2
		}
	}
	return n
}

func isTextUnsafe(r rune) bool {
	return r <= 0x08 || r == 0x0b || r == 0x0c ||
		(r >= 0x0e && r <= 0x1f) ||
		(r >= 0x7f && r <= 0x9f) ||
		(r >= 0x202a && r <= 0x202e) ||
		(r >= 0x2066 && r <= 0x2069)
}
