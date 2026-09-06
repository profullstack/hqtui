//go:build linux || darwin || freebsd || netbsd || openbsd || dragonfly

package hqtui

import (
	"os"
	"os/signal"
	"syscall"
)

// SIGWINCH does not exist on every platform Go builds for, so the subscription
// is split out rather than guarded at the call site.
func notifyResize(ch chan<- os.Signal) { signal.Notify(ch, syscall.SIGWINCH) }
