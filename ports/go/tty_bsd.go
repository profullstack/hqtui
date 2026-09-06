//go:build darwin || freebsd || netbsd || openbsd || dragonfly

package hqtui

import "syscall"

// macOS and the BSDs spell the terminal-attribute ioctls TIOCGETA/TIOCSETA.
const (
	ioctlReadTermios  = syscall.TIOCGETA
	ioctlWriteTermios = syscall.TIOCSETA
)
