//go:build linux

package hqtui

import "syscall"

// The two ioctl requests that read and write terminal attributes. Linux spells
// them TCGETS/TCSETS; the BSDs (macOS included) use TIOCGETA/TIOCSETA.
const (
	ioctlReadTermios  = syscall.TCGETS
	ioctlWriteTermios = syscall.TCSETS
)
