//go:build !(linux || darwin || freebsd || netbsd || openbsd || dragonfly)

package hqtui

import "os"

// Windows and anything else without a POSIX terminal layer. Everything above
// this file — the framebuffer, widgets, encoder and headless renderer — is pure
// computation and works fine here; only the interactive App does not.

type termiosState struct{}

func enterRawMode(*termiosState) bool { return false }
func leaveRawMode(*termiosState)      {}

func windowSize() (TerminalSize, bool) { return TerminalSize{}, false }

func isTerminal() bool {
	info, err := os.Stdout.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

func runningOnWindows() bool { return true }
