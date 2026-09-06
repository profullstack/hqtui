//go:build linux || darwin || freebsd || netbsd || openbsd || dragonfly

package hqtui

import (
	"os"
	"syscall"
	"unsafe"
)

// Raw mode and window size, through the standard library only.
//
// Unlike the Rust port — which cannot see a correct `struct termios` without a
// dependency and shells out to `stty` instead — Go's `syscall` package already
// declares the struct and its flag constants correctly for every platform it
// supports. So this is the direct route, and it is the better one: no
// subprocess, and the saved state is the real thing rather than a description
// of it.
//
// The two ioctl request numbers are the only per-platform detail, and they live
// in tty_linux.go and tty_bsd.go beside this file.

type termiosState struct {
	saved syscall.Termios
	valid bool
}

func ttyFd() uintptr { return os.Stdin.Fd() }

func getTermios(fd uintptr) (syscall.Termios, error) {
	var t syscall.Termios
	_, _, errno := syscall.Syscall(
		syscall.SYS_IOCTL, fd, uintptr(ioctlReadTermios), uintptr(unsafe.Pointer(&t)),
	)
	if errno != 0 {
		return t, errno
	}
	return t, nil
}

func setTermios(fd uintptr, t syscall.Termios) error {
	_, _, errno := syscall.Syscall(
		syscall.SYS_IOCTL, fd, uintptr(ioctlWriteTermios), uintptr(unsafe.Pointer(&t)),
	)
	if errno != 0 {
		return errno
	}
	return nil
}

// enterRawMode is cfmakeraw, plus turning off ISIG: Ctrl+C has to arrive as a
// keystroke, because quitting is the application's decision and QuitKeys is
// configurable.
func enterRawMode(s *termiosState) bool {
	fd := ttyFd()
	saved, err := getTermios(fd)
	if err != nil {
		return false
	}
	s.saved, s.valid = saved, true

	raw := saved
	raw.Iflag &^= syscall.IGNBRK | syscall.BRKINT | syscall.PARMRK | syscall.ISTRIP |
		syscall.INLCR | syscall.IGNCR | syscall.ICRNL | syscall.IXON
	raw.Oflag &^= syscall.OPOST
	raw.Lflag &^= syscall.ECHO | syscall.ECHONL | syscall.ICANON | syscall.ISIG | syscall.IEXTEN
	raw.Cflag &^= syscall.CSIZE | syscall.PARENB
	raw.Cflag |= syscall.CS8
	raw.Cc[syscall.VMIN] = 1
	raw.Cc[syscall.VTIME] = 0
	return setTermios(fd, raw) == nil
}

func leaveRawMode(s *termiosState) {
	if !s.valid {
		return
	}
	_ = setTermios(ttyFd(), s.saved)
	s.valid = false
}

type winsize struct {
	rows, cols, xpixel, ypixel uint16
}

// windowSize asks the kernel. The second return is false when stdout is not a
// terminal, or reports a zero — some ptys do, which would otherwise leave a 0x0
// framebuffer that renders nothing at all.
func windowSize() (TerminalSize, bool) {
	var ws winsize
	_, _, errno := syscall.Syscall(
		syscall.SYS_IOCTL, os.Stdout.Fd(), uintptr(syscall.TIOCGWINSZ),
		uintptr(unsafe.Pointer(&ws)),
	)
	if errno != 0 || ws.cols == 0 || ws.rows == 0 {
		return TerminalSize{}, false
	}
	return TerminalSize{Columns: int(ws.cols), Rows: int(ws.rows)}, true
}

func isTerminal() bool {
	info, err := os.Stdout.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

func runningOnWindows() bool { return false }
