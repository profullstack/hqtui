package hqtui

import (
	"bufio"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"
)

// Owns the TTY: raw mode, alternate screen, mouse reporting, and — above all —
// putting everything back. A crashed app must never leave an unusable shell.

type TerminalSize struct {
	Columns int
	Rows    int
}

type TerminalOptions struct {
	// AlternateScreen uses the alternate screen so the user's scrollback
	// survives. Default true; set NoAlternateScreen to turn it off.
	NoAlternateScreen bool
	Mouse             *bool
	ShowCursor        bool
	BracketedPaste    *bool
	FocusEvents       *bool
	Title             string
	Capabilities      CapabilityOverrides
	// NoExitHandlers stops the terminal being restored on SIGTERM/SIGHUP.
	NoExitHandlers bool
	// EscapeTimeout is how long to wait before a lone ESC counts as the Escape
	// key. Zero means 30ms.
	EscapeTimeout time.Duration
}

func (o TerminalOptions) escapeTimeout() time.Duration {
	if o.EscapeTimeout == 0 {
		return 30 * time.Millisecond
	}
	return o.EscapeTimeout
}

// resized and terminated are set from signal-handling goroutines and read by
// the render loop, so they are atomics rather than plain fields.
var (
	resized    atomic.Bool
	terminated atomic.Int32
	handlersOn atomic.Bool
)

type Terminal struct {
	Capabilities Capabilities
	EscapeTimeout time.Duration

	options TerminalOptions
	parser  *InputParser
	entered bool
	raw     termiosState
	rawSet  bool

	input chan []byte
	// partial holds bytes that ended mid-character until the rest arrive.
	partial []byte
}

func NewTerminal(o TerminalOptions) *Terminal {
	return &Terminal{
		Capabilities:  DetectCapabilities(o.Capabilities),
		EscapeTimeout: o.escapeTimeout(),
		options:       o,
		parser:        NewInputParser(),
	}
}

func (t *Terminal) mouseOn() bool {
	if t.options.Mouse != nil {
		return *t.options.Mouse
	}
	return t.Capabilities.Mouse
}

func (t *Terminal) pasteOn() bool {
	if t.options.BracketedPaste != nil {
		return *t.options.BracketedPaste
	}
	return t.Capabilities.BracketedPaste
}

func (t *Terminal) focusOn() bool {
	if t.options.FocusEvents != nil {
		return *t.options.FocusEvents
	}
	return t.Capabilities.FocusEvents
}

// Size is the current window size, falling back the way the reference does: the
// kernel, then COLUMNS/LINES, then 80x24. Anything that is not a positive
// number means "ask somewhere else".
func (t *Terminal) Size() TerminalSize {
	if size, ok := windowSize(); ok {
		return size
	}
	fromEnv := func(name string, fallback int) int {
		if v, err := strconv.Atoi(os.Getenv(name)); err == nil && v > 0 {
			return v
		}
		return fallback
	}
	return TerminalSize{Columns: fromEnv("COLUMNS", 80), Rows: fromEnv("LINES", 24)}
}

// TakeResize reports whether a SIGWINCH has arrived since it was last called.
func (t *Terminal) TakeResize() bool { return resized.Swap(false) }

// TerminationSignal is the signal that asked the process to quit, if one has
// arrived.
func (t *Terminal) TerminationSignal() int { return int(terminated.Load()) }

func (t *Terminal) Write(data string) {
	if data == "" {
		return
	}
	_, _ = os.Stdout.WriteString(data)
}

// Enter switches to full-screen mode. It is idempotent.
func (t *Terminal) Enter() {
	if t.entered {
		return
	}
	t.entered = true

	setup := ""
	if !t.options.NoAlternateScreen {
		setup += AnsiAlternateScreenOn
	}
	if !t.options.ShowCursor {
		setup += AnsiCursorHide
	}
	if t.mouseOn() && t.Capabilities.Mouse {
		setup += AnsiMouseOn
	}
	if t.pasteOn() {
		setup += AnsiBracketedPasteOn
	}
	if t.focusOn() {
		setup += AnsiFocusOn
	}
	if t.options.Title != "" {
		setup += SetTitle(t.options.Title)
	}
	setup += AnsiClearScreen + AnsiCursorHome
	t.Write(setup)

	if t.Capabilities.TTY {
		t.rawSet = enterRawMode(&t.raw)
	}
	t.startReader()
	if !t.options.NoExitHandlers {
		installExitHandlers()
	}
}

// Restore puts the terminal back exactly as it was found. Safe to call twice.
func (t *Terminal) Restore() {
	if !t.entered {
		return
	}
	t.entered = false

	teardown := AnsiReset
	if t.focusOn() {
		teardown += AnsiFocusOff
	}
	if t.pasteOn() {
		teardown += AnsiBracketedPasteOff
	}
	if t.mouseOn() {
		teardown += AnsiMouseOff
	}
	if !t.options.ShowCursor {
		teardown += AnsiCursorShow
	}
	if t.options.NoAlternateScreen {
		teardown += "\n"
	} else {
		teardown += AnsiAlternateScreenOff
	}
	t.Write(teardown)

	if t.rawSet {
		leaveRawMode(&t.raw)
		t.rawSet = false
	}
}

// startReader reads stdin on its own goroutine. The reader owns the blocking
// read so the render loop never does, which is what keeps a frame from waiting
// on a keystroke that may never come.
func (t *Terminal) startReader() {
	if t.input != nil {
		return
	}
	ch := make(chan []byte, 32)
	t.input = ch
	go func() {
		reader := bufio.NewReader(os.Stdin)
		buf := make([]byte, 4096)
		for {
			n, err := reader.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				ch <- chunk
			}
			if err != nil {
				close(ch)
				return
			}
		}
	}()
}

// PollInput returns every input event available right now, decoded. It never
// blocks.
//
// A lone ESC is only the Escape key once nothing follows it, so it is held back
// until EscapeTimeout has passed with no further bytes; pass the time since the
// last call so the caller's own clock decides.
func (t *Terminal) PollInput(waited time.Duration) []InputEvent {
	var events []InputEvent
	received := false

	for {
		var chunk []byte
		select {
		case c, ok := <-t.input:
			if !ok {
				t.input = nil
				goto done
			}
			chunk = c
		default:
			goto done
		}

		received = true
		t.partial = append(t.partial, chunk...)
		// A read can end in the middle of a multi-byte character. Decode what
		// is whole and keep the tail for the next read, or the parser would see
		// a replacement character where a letter belongs.
		text, rest := splitCompleteUTF8(t.partial)
		t.partial = rest
		events = append(events, t.parser.Parse(text)...)
	}

done:
	if !received && t.parser.HasPending() && waited >= t.EscapeTimeout {
		events = append(events, t.parser.Flush()...)
	}
	return events
}

// splitCompleteUTF8 returns the longest valid-UTF-8 prefix and whatever is left
// over, which is at most three bytes of a truncated character.
func splitCompleteUTF8(buf []byte) (string, []byte) {
	end := len(buf)
	// A character is at most four bytes, so at most three can be incomplete.
	for back := 0; back < 4 && back < len(buf); back++ {
		i := len(buf) - 1 - back
		b := buf[i]
		if b&0x80 == 0 {
			break // ASCII: nothing pending
		}
		if b&0xc0 == 0xc0 {
			// A lead byte. If the character it starts is not yet complete,
			// hold it back.
			need := 2
			switch {
			case b&0xf8 == 0xf0:
				need = 4
			case b&0xf0 == 0xe0:
				need = 3
			}
			if len(buf)-i < need {
				end = i
			}
			break
		}
	}
	text := string(buf[:end])
	rest := append([]byte(nil), buf[end:]...)
	return text, rest
}

// EmergencyRestore restores the terminal for a process that lost its Terminal.
// Safe to call twice.
func EmergencyRestore() {
	_, _ = os.Stdout.WriteString(
		AnsiReset + AnsiFocusOff + AnsiBracketedPasteOff + AnsiMouseOff +
			AnsiCursorShow + AnsiAlternateScreenOff,
	)
	var s termiosState
	leaveRawMode(&s)
}

// Restoring is not negotiable — a crash must not leave an unusable shell — but
// deciding the process should die is the host's call, not a rendering library's.
// So these handlers only record the signal; the app loop notices and exits on
// its own terms.
func installExitHandlers() {
	if handlersOn.Swap(true) {
		return
	}
	winch := make(chan os.Signal, 1)
	notifyResize(winch)
	go func() {
		for range winch {
			resized.Store(true)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGHUP, syscall.SIGINT)
	go func() {
		for sig := range quit {
			if s, ok := sig.(syscall.Signal); ok {
				terminated.Store(int32(s))
			} else {
				terminated.Store(int32(syscall.SIGTERM))
			}
		}
	}()
}
