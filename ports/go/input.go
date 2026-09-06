package hqtui

import (
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Decodes raw terminal bytes into normalized events. Applications should never
// see an escape sequence — only "ctrl+c", "up", or a printable character.
//
// InputParser.Parse takes a string because a sequence can be split across reads
// and the parser has to hold the remainder. Splitting a *multi-byte character*
// across reads is the terminal's problem, not the parser's: Terminal buffers
// partial UTF-8 before it gets here.

type EventKind int

const (
	EventKey EventKind = iota
	EventMouse
	EventPaste
	EventFocus
)

type MouseAction int

const (
	MousePress MouseAction = iota
	MouseRelease
	MouseMove
	MouseDrag
	MouseScroll
)

func (a MouseAction) String() string {
	switch a {
	case MousePress:
		return "press"
	case MouseRelease:
		return "release"
	case MouseMove:
		return "move"
	case MouseDrag:
		return "drag"
	}
	return "scroll"
}

type MouseButton int

const (
	ButtonLeft MouseButton = iota
	ButtonMiddle
	ButtonRight
	ButtonNone
)

func (b MouseButton) String() string {
	switch b {
	case ButtonLeft:
		return "left"
	case ButtonMiddle:
		return "middle"
	case ButtonRight:
		return "right"
	}
	return "none"
}

// InputEvent is one decoded event. Kind says which fields are meaningful; the
// reference uses a discriminated union and Go uses one struct, which keeps the
// event channel free of interface boxing.
type InputEvent struct {
	Kind EventKind

	// Key fields.
	//
	// Name is normalized: "a", "up", "enter", "f5", "escape", "space".
	Name string
	// Key is the full form including modifiers, e.g. "ctrl+c" — what you
	// usually match on.
	Key string
	// Char is the printable character, when there is one.
	Char    string
	HasChar bool
	Raw     string
	Ctrl    bool
	Alt     bool
	Shift   bool

	// Mouse fields. X and Y are zero-based cell coordinates.
	Action MouseAction
	Button MouseButton
	X, Y   int
	// Scroll is -1 up, 1 down; 0 when this is not a scroll.
	Scroll int

	// Paste field.
	Text string

	// Focus field.
	Focused bool
}

// The escape sequences that map to a named key, without their leading ESC.
var specialKeys = map[string]string{
	"[A": "up", "[B": "down", "[C": "right", "[D": "left",
	"[H": "home", "[F": "end", "[Z": "shift+tab",
	"OA": "up", "OB": "down", "OC": "right", "OD": "left",
	"OH": "home", "OF": "end",
	"OP": "f1", "OQ": "f2", "OR": "f3", "OS": "f4",
	"[1~": "home", "[2~": "insert", "[3~": "delete", "[4~": "end",
	"[5~": "pageup", "[6~": "pagedown", "[7~": "home", "[8~": "end",
	"[11~": "f1", "[12~": "f2", "[13~": "f3", "[14~": "f4", "[15~": "f5",
	"[17~": "f6", "[18~": "f7", "[19~": "f8", "[20~": "f9", "[21~": "f10",
	"[23~": "f11", "[24~": "f12",
}

// Longest match first, so `[1~` never loses to a shorter prefix. Map iteration
// order in Go is randomised, which would otherwise make this non-deterministic.
var specialSorted = func() []string {
	keys := make([]string, 0, len(specialKeys))
	for k := range specialKeys {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if len(keys[i]) != len(keys[j]) {
			return len(keys[i]) > len(keys[j])
		}
		return keys[i] < keys[j]
	})
	return keys
}()

type modifiers struct{ shift, alt, ctrl bool }

// decodeModifiers reads the xterm modifier parameter: 1 + bitfield(shift=1,
// alt=2, ctrl=4).
func decodeModifiers(param int) modifiers {
	bits := param - 1
	if bits < 0 {
		bits = 0
	}
	return modifiers{shift: bits&1 != 0, alt: bits&2 != 0, ctrl: bits&4 != 0}
}

func keyEvent(name string, m modifiers, char string, hasChar bool, raw string) InputEvent {
	parts := make([]string, 0, 4)
	if m.ctrl {
		parts = append(parts, "ctrl")
	}
	if m.alt {
		parts = append(parts, "alt")
	}
	// The reference tests `name.length`, which counts UTF-16 units. It only
	// matters for named keys, which are all ASCII, but matching it exactly costs
	// nothing.
	if m.shift && utf16Len(name) > 1 {
		parts = append(parts, "shift")
	}
	parts = append(parts, name)
	return InputEvent{
		Kind: EventKey, Name: name, Key: strings.Join(parts, "+"),
		Char: char, HasChar: hasChar, Raw: raw,
		Ctrl: m.ctrl, Alt: m.alt, Shift: m.shift,
	}
}

const (
	pasteEnd   = "\x1b[201~"
	pasteStart = "\x1b[200~"
)

// partialSuffix is the length of the longest suffix of text that is a proper
// prefix of marker.
func partialSuffix(text, marker string) int {
	maxN := min(len(text), len(marker)-1)
	for n := maxN; n > 0; n-- {
		if strings.HasSuffix(text, marker[:n]) {
			return n
		}
	}
	return 0
}

// InputParser turns chunks into events. It is stateful, so a sequence split
// across two reads — routine over SSH — still decodes correctly.
type InputParser struct {
	pending     string
	pasteBuffer *string
	// pasteTail holds bytes back mid-paste because they could be the start of
	// the end marker. Kept separate from pending so they do not look like an
	// unterminated escape and trip the Escape-key timeout.
	pasteTail string
}

func NewInputParser() *InputParser { return &InputParser{} }

// HasPending is true when bytes are buffered awaiting the rest of a sequence.
func (p *InputParser) HasPending() bool { return p.pending != "" }

// Flush resolves buffered bytes that turned out to be complete after all. A
// lone ESC is ambiguous — it only becomes the Escape key once no more bytes
// follow — so the terminal calls this on a short timeout.
func (p *InputParser) Flush() []InputEvent {
	// pasteTail is deliberately left alone. Folding it into the paste content
	// here destroyed a partial end marker whenever the Escape timeout fired
	// between the two reads carrying it: the rest of the marker then arrived
	// alone, never matched, and the paste could never end — the exact wedge
	// this holdback exists to prevent.
	if p.pending == "" {
		return nil
	}
	data := p.pending
	p.pending = ""
	if data == "\x1b" {
		return []InputEvent{keyEvent("escape", modifiers{}, "", false, "\x1b")}
	}
	// An incomplete sequence that never completed: emit ESC and re-parse.
	events := []InputEvent{keyEvent("escape", modifiers{}, "", false, "\x1b")}
	return append(events, p.Parse(data[1:])...)
}

func (p *InputParser) Parse(chunk string) []InputEvent {
	var events []InputEvent
	// The reference prepends pasteTail to `pending + chunk`; with only one of
	// the two ever set at a time, this order is the same string.
	data := p.pasteTail + p.pending + chunk
	p.pasteTail, p.pending = "", ""

	for len(data) > 0 {
		if p.pasteBuffer != nil {
			end := strings.Index(data, pasteEnd)
			if end == -1 {
				// The end marker can straddle two reads, which is routine over
				// SSH. Swallowing a partial one here used to lose it for good:
				// the paste never ended, and every later keystroke — Ctrl+C
				// included — went into the buffer instead of being dispatched.
				keep := partialSuffix(data, pasteEnd)
				split := len(data) - keep
				*p.pasteBuffer += data[:split]
				p.pasteTail = data[split:]
				break
			}
			*p.pasteBuffer += data[:end]
			events = append(events, InputEvent{Kind: EventPaste, Text: *p.pasteBuffer})
			p.pasteBuffer = nil
			data = data[end+len(pasteEnd):]
			continue
		}

		if data[0] != 0x1b {
			consumed := parsePlain(data, &events)
			data = data[consumed:]
			continue
		}

		// Lone ESC at the end of a chunk: could be the start of a sequence.
		if len(data) == 1 {
			p.pending = data
			break
		}

		consumed := p.parseEscape(data, &events)
		if consumed < 0 {
			p.pending = data // incomplete; wait for more bytes
			break
		}
		data = data[consumed:]
	}
	return events
}

// parseEscape returns -1 when the sequence is incomplete and more bytes are
// needed.
func (p *InputParser) parseEscape(data string, events *[]InputEvent) int {
	if strings.HasPrefix(data, pasteStart) {
		empty := ""
		p.pasteBuffer = &empty
		return len(pasteStart)
	}
	if strings.HasPrefix(data, "\x1b[I") {
		*events = append(*events, InputEvent{Kind: EventFocus, Focused: true})
		return 3
	}
	if strings.HasPrefix(data, "\x1b[O") {
		*events = append(*events, InputEvent{Kind: EventFocus, Focused: false})
		return 3
	}

	// SGR mouse: ESC [ < b ; x ; y (M press | m release)
	if code, col, row, pressed, n, ok := parseSGRMouse(data); ok {
		*events = append(*events, decodeMouse(code, col, row, pressed))
		return n
	}
	if isPartialMouse(data) {
		return -1
	}

	// CSI with modifier parameters: ESC [ 1 ; 5 A  → ctrl+up
	if param, final, n, ok := parseModifiedCSI(data); ok {
		base, found := specialKeys["["+string(final)]
		if !found {
			base, found = specialKeys["O"+string(final)]
		}
		if found {
			*events = append(*events, keyEvent(base, decodeModifiers(param), "", false, data[:n]))
			return n
		}
	}
	if key, mod, n, ok := parseModifiedTilde(data); ok {
		if base, found := specialKeys["["+strconv.Itoa(key)+"~"]; found {
			*events = append(*events, keyEvent(base, decodeModifiers(mod), "", false, data[:n]))
			return n
		}
	}

	// Plain special keys, longest match first.
	for _, seq := range specialSorted {
		full := "\x1b" + seq
		if strings.HasPrefix(data, full) {
			name := specialKeys[seq]
			if name == "shift+tab" {
				*events = append(*events, keyEvent("tab", modifiers{shift: true}, "", false, full))
			} else {
				*events = append(*events, keyEvent(name, modifiers{}, "", false, full))
			}
			return len(full)
		}
	}

	// Possibly-incomplete CSI/SS3 sequence.
	if isPartialCSI(data) {
		return -1
	}

	// Alt+key.
	if len(data) >= 2 && data[1] != '[' && data[1] != 'O' {
		var sub []InputEvent
		consumed := parsePlain(data[1:], &sub)
		if len(sub) > 0 && sub[0].Kind == EventKey {
			first := sub[0]
			*events = append(*events, keyEvent(
				first.Name,
				modifiers{ctrl: first.Ctrl, alt: true, shift: first.Shift},
				first.Char, first.HasChar, "\x1b"+first.Raw,
			))
			return consumed + 1
		}
	}

	*events = append(*events, keyEvent("escape", modifiers{}, "", false, "\x1b"))
	return 1
}

// parsePlain returns the number of bytes consumed.
func parsePlain(data string, events *[]InputEvent) int {
	r, size := utf8.DecodeRuneInString(data)
	ch := data[:size]
	cp := int(r)
	none := modifiers{}

	switch {
	case cp == 13 || cp == 10:
		*events = append(*events, keyEvent("enter", none, "", false, ch))
	case cp == 9:
		*events = append(*events, keyEvent("tab", none, "", false, ch))
	case cp == 127 || cp == 8:
		*events = append(*events, keyEvent("backspace", none, "", false, ch))
	case cp == 32:
		*events = append(*events, keyEvent("space", none, " ", true, ch))
	case cp < 32:
		// Ctrl+letter arrives as the control code itself.
		*events = append(*events, keyEvent(string(rune(cp+96)), modifiers{ctrl: true}, "", false, ch))
	default:
		*events = append(*events, keyEvent(ch, none, ch, true, ch))
	}
	return size
}

func decodeMouse(code, col, row int, pressed bool) InputEvent {
	shift := code&4 != 0
	alt := code&8 != 0
	ctrl := code&16 != 0
	motion := code&32 != 0
	isScroll := code&64 != 0
	buttonBits := code & 3

	buttonOf := func(bits int) MouseButton {
		switch bits {
		case 0:
			return ButtonLeft
		case 1:
			return ButtonMiddle
		case 2:
			return ButtonRight
		}
		return ButtonNone
	}

	var action MouseAction
	button := ButtonNone
	scroll := 0
	switch {
	case isScroll:
		action = MouseScroll
		scroll = 1
		if buttonBits == 0 {
			scroll = -1
		}
	case motion:
		action = MouseDrag
		if buttonBits == 3 {
			action = MouseMove
		}
		button = buttonOf(buttonBits)
	default:
		action = MouseRelease
		if pressed {
			action = MousePress
		}
		button = buttonOf(buttonBits)
	}

	return InputEvent{
		Kind: EventMouse, Action: action, Button: button,
		X: max(0, col-1), Y: max(0, row-1), Scroll: scroll,
		Ctrl: ctrl, Alt: alt, Shift: shift,
	}
}

// parseSGRMouse matches `^\x1b\[<(\d+);(\d+);(\d+)([Mm])`.
func parseSGRMouse(data string) (code, col, row int, pressed bool, n int, ok bool) {
	rest, found := strings.CutPrefix(data, "\x1b[<")
	if !found {
		return
	}
	i := 0
	number := func() (int, bool) {
		start := i
		for i < len(rest) && rest[i] >= '0' && rest[i] <= '9' {
			i++
		}
		if i == start {
			return 0, false
		}
		v, err := strconv.Atoi(rest[start:i])
		return v, err == nil
	}
	var good bool
	if code, good = number(); !good {
		return
	}
	if i >= len(rest) || rest[i] != ';' {
		return
	}
	i++
	if col, good = number(); !good {
		return
	}
	if i >= len(rest) || rest[i] != ';' {
		return
	}
	i++
	if row, good = number(); !good {
		return
	}
	if i >= len(rest) || (rest[i] != 'M' && rest[i] != 'm') {
		return
	}
	pressed = rest[i] == 'M'
	i++
	return code, col, row, pressed, 3 + i, true
}

// isPartialMouse matches `^\x1b\[<[\d;]*$` — a mouse report cut off mid-sequence.
func isPartialMouse(data string) bool {
	rest, ok := strings.CutPrefix(data, "\x1b[<")
	if !ok {
		return false
	}
	for i := 0; i < len(rest); i++ {
		if !(rest[i] >= '0' && rest[i] <= '9') && rest[i] != ';' {
			return false
		}
	}
	return true
}

// parseModifiedCSI matches `^\x1b\[1;(\d+)([A-HPQRS])`.
func parseModifiedCSI(data string) (param int, final byte, n int, ok bool) {
	rest, found := strings.CutPrefix(data, "\x1b[1;")
	if !found {
		return
	}
	i := 0
	for i < len(rest) && rest[i] >= '0' && rest[i] <= '9' {
		i++
	}
	if i == 0 || i >= len(rest) {
		return
	}
	v, err := strconv.Atoi(rest[:i])
	if err != nil {
		return
	}
	final = rest[i]
	if !((final >= 'A' && final <= 'H') || final == 'P' || final == 'Q' || final == 'R' || final == 'S') {
		return 0, 0, 0, false
	}
	return v, final, 4 + i + 1, true
}

// parseModifiedTilde matches `^\x1b\[(\d+);(\d+)~`.
func parseModifiedTilde(data string) (key, mod, n int, ok bool) {
	rest, found := strings.CutPrefix(data, "\x1b[")
	if !found {
		return
	}
	i := 0
	for i < len(rest) && rest[i] >= '0' && rest[i] <= '9' {
		i++
	}
	if i == 0 {
		return
	}
	key, err := strconv.Atoi(rest[:i])
	if err != nil {
		return 0, 0, 0, false
	}
	if i >= len(rest) || rest[i] != ';' {
		return 0, 0, 0, false
	}
	i++
	start := i
	for i < len(rest) && rest[i] >= '0' && rest[i] <= '9' {
		i++
	}
	if i == start {
		return 0, 0, 0, false
	}
	mod, err = strconv.Atoi(rest[start:i])
	if err != nil {
		return 0, 0, 0, false
	}
	if i >= len(rest) || rest[i] != '~' {
		return 0, 0, 0, false
	}
	return key, mod, 2 + i + 1, true
}

// isPartialCSI matches `^\x1b(\[|O)[\d;<]*$` — CSI or SS3 with no final byte yet.
func isPartialCSI(data string) bool {
	rest, ok := strings.CutPrefix(data, "\x1b[")
	if !ok {
		rest, ok = strings.CutPrefix(data, "\x1bO")
		if !ok {
			return false
		}
	}
	for i := 0; i < len(rest); i++ {
		c := rest[i]
		if !(c >= '0' && c <= '9') && c != ';' && c != '<' {
			return false
		}
	}
	return true
}

// MatchKey reports whether an event matches a binding like "ctrl+c", "q", or
// "f10".
func MatchKey(event InputEvent, binding string) bool {
	b := strings.ToLower(strings.TrimSpace(binding))
	if strings.ToLower(event.Key) == b {
		return true
	}
	// A bare name matches whatever the shift state. Rejecting shift here was
	// justified by Tab focus firing both ways at once, which was simply wrong —
	// App reads the name directly and never calls this — and it silently
	// stopped every shifted named key (shift+up, shift+home, shift+f1, …) from
	// matching its own name. Bind "shift+tab" to distinguish; Key carries it.
	return strings.ToLower(event.Name) == b && !event.Ctrl && !event.Alt
}
