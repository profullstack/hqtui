//go:build !(linux || darwin || freebsd || netbsd || openbsd || dragonfly)

package hqtui

import "os"

// No SIGWINCH here; the app falls back to polling the size each frame, which
// windowSize already does.
func notifyResize(chan<- os.Signal) {}
