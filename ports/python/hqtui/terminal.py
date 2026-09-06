"""Owns the TTY: raw mode, alternate screen, mouse reporting, and — above all —
putting everything back.

A crashed app must never leave an unusable shell.

Python has the easiest job of the four ports here: ``termios``, ``tty``,
``signal``, ``select`` and ``shutil.get_terminal_size`` are all standard
library, correctly implemented per platform. There is no FFI and no subprocess.
"""

from __future__ import annotations

import os
import select
import signal
import sys
from dataclasses import dataclass, field
from typing import NamedTuple

from . import ansi
from .capabilities import Capabilities, CapabilityOverrides, detect_capabilities
from .input import InputParser

__all__ = ["Terminal", "TerminalOptions", "TerminalSize", "emergency_restore"]

try:  # pragma: no cover - the import is the platform test
    import termios
    import tty

    _POSIX = True
except ImportError:  # pragma: no cover - Windows
    termios = None  # type: ignore[assignment]
    tty = None  # type: ignore[assignment]
    _POSIX = False


class TerminalSize(NamedTuple):
    columns: int
    rows: int


@dataclass(slots=True)
class TerminalOptions:
    alternate_screen: bool = True
    """Use the alternate screen so the user's scrollback survives."""
    mouse: bool | None = None
    hide_cursor: bool = True
    bracketed_paste: bool | None = None
    focus_events: bool | None = None
    title: str = ""
    capabilities: CapabilityOverrides = field(default_factory=CapabilityOverrides)
    install_exit_handlers: bool = True
    """Restore the terminal on SIGTERM/SIGHUP and on an uncaught exception."""
    escape_timeout: float = 0.03
    """How long to wait before a lone ESC counts as the Escape key, in seconds."""


_saved_mode: list | None = None
"""The ``termios`` attributes captured when raw mode was entered.

Module-level because the exit handlers have no ``self`` to reach for.
"""

_resized = False
_terminated = 0


def _on_winch(signum, frame) -> None:  # pragma: no cover - signal path
    global _resized
    _resized = True


def _on_terminate(signum, frame) -> None:  # pragma: no cover - signal path
    global _terminated
    _terminated = signum


def _enter_raw_mode() -> bool:
    """cfmakeraw, plus turning off ISIG: Ctrl+C has to arrive as a keystroke,
    because quitting is the application's decision and ``quit_keys`` is
    configurable."""
    global _saved_mode
    if not _POSIX:
        return False
    try:
        fd = sys.stdin.fileno()
        _saved_mode = termios.tcgetattr(fd)
        tty.setraw(fd)
        return True
    except (termios.error, ValueError, OSError):
        return False


def _leave_raw_mode() -> None:
    global _saved_mode
    if not _POSIX or _saved_mode is None:
        return
    try:
        termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, _saved_mode)
    except (termios.error, ValueError, OSError):  # pragma: no cover
        pass
    _saved_mode = None


def emergency_restore() -> None:
    """Restore the terminal for a process that lost its ``Terminal``.

    Safe to call twice, and safe to call from an exception hook.
    """
    sys.stdout.write(
        ansi.RESET + ansi.FOCUS_OFF + ansi.BRACKETED_PASTE_OFF + ansi.MOUSE_OFF
        + ansi.CURSOR_SHOW + ansi.ALTERNATE_SCREEN_OFF
    )
    sys.stdout.flush()
    _leave_raw_mode()


class Terminal:
    def __init__(self, options: TerminalOptions | None = None) -> None:
        self.options = options or TerminalOptions()
        self.capabilities: Capabilities = detect_capabilities(self.options.capabilities)
        self.escape_timeout = self.options.escape_timeout
        self._parser = InputParser()
        self._entered = False
        self._raw_set = False
        # Bytes that ended mid-character, held until the rest of them arrive.
        self._partial = b""

    @property
    def _mouse(self) -> bool:
        o = self.options.mouse
        return self.capabilities.mouse if o is None else o

    @property
    def _paste(self) -> bool:
        o = self.options.bracketed_paste
        return self.capabilities.bracketed_paste if o is None else o

    @property
    def _focus(self) -> bool:
        o = self.options.focus_events
        return self.capabilities.focus_events if o is None else o

    def size(self) -> TerminalSize:
        """The current window size, falling back the way the reference does: the
        kernel, then ``COLUMNS``/``LINES``, then 80x24.

        Anything that is not a positive number means "ask somewhere else" — some
        ptys report zero, which would otherwise leave a 0x0 framebuffer that
        renders nothing at all.
        """
        try:
            size = os.get_terminal_size(sys.stdout.fileno())
            if size.columns > 0 and size.lines > 0:
                return TerminalSize(size.columns, size.lines)
        except (OSError, ValueError):
            pass

        def from_env(name: str, fallback: int) -> int:
            try:
                v = int(os.environ.get(name, ""))
                return v if v > 0 else fallback
            except ValueError:
                return fallback

        return TerminalSize(from_env("COLUMNS", 80), from_env("LINES", 24))

    def take_resize(self) -> bool:
        """Whether a SIGWINCH has arrived since this was last called."""
        global _resized
        was, _resized = _resized, False
        return was

    def termination_signal(self) -> int:
        """The signal that asked the process to quit, or 0."""
        return _terminated

    def write(self, data: str) -> None:
        if not data:
            return
        sys.stdout.write(data)
        sys.stdout.flush()

    def enter(self) -> None:
        """Enter full-screen mode. Idempotent."""
        if self._entered:
            return
        self._entered = True

        setup = ""
        if self.options.alternate_screen:
            setup += ansi.ALTERNATE_SCREEN_ON
        if self.options.hide_cursor:
            setup += ansi.CURSOR_HIDE
        if self._mouse and self.capabilities.mouse:
            setup += ansi.MOUSE_ON
        if self._paste:
            setup += ansi.BRACKETED_PASTE_ON
        if self._focus:
            setup += ansi.FOCUS_ON
        if self.options.title:
            setup += ansi.set_title(self.options.title)
        setup += ansi.CLEAR_SCREEN + ansi.CURSOR_HOME
        self.write(setup)

        if self.capabilities.tty:
            self._raw_set = _enter_raw_mode()
        if self.options.install_exit_handlers:
            self._install_exit_handlers()

    def restore(self) -> None:
        """Put the terminal back exactly as it was found. Safe to call twice."""
        if not self._entered:
            return
        self._entered = False

        teardown = ansi.RESET
        if self._focus:
            teardown += ansi.FOCUS_OFF
        if self._paste:
            teardown += ansi.BRACKETED_PASTE_OFF
        if self._mouse:
            teardown += ansi.MOUSE_OFF
        if self.options.hide_cursor:
            teardown += ansi.CURSOR_SHOW
        teardown += ansi.ALTERNATE_SCREEN_OFF if self.options.alternate_screen else "\n"
        self.write(teardown)

        if self._raw_set:
            _leave_raw_mode()
            self._raw_set = False

    def poll_input(self, timeout: float = 0.0) -> list:
        """Every input event available within ``timeout`` seconds, decoded.

        A lone ESC is only the Escape key once nothing follows it, so it is held
        back until ``escape_timeout`` has passed with no further bytes. Unlike
        the other ports, this can wait on the file descriptor itself rather than
        on a clock, because ``select`` is right there.
        """
        events: list = []
        received = False

        while True:
            try:
                ready, _, _ = select.select([sys.stdin], [], [], timeout if not received else 0)
            except (OSError, ValueError):  # pragma: no cover - closed stdin
                break
            if not ready:
                break
            try:
                chunk = os.read(sys.stdin.fileno(), 4096)
            except (OSError, ValueError):  # pragma: no cover
                break
            if not chunk:
                break
            received = True
            self._partial += chunk
            # A read can end in the middle of a multi-byte character. Decode
            # what is whole and keep the tail for the next read, or the parser
            # would see a replacement character where a letter belongs.
            text, self._partial = _split_complete_utf8(self._partial)
            events.extend(self._parser.parse(text))

        if not received and self._parser.has_pending:
            events.extend(self._parser.flush())
        return events

    def _install_exit_handlers(self) -> None:
        """Restoring is not negotiable — a crash must not leave an unusable
        shell — but deciding the process should die is the host's call, not a
        rendering library's. So these handlers only record the signal; the app
        loop notices and exits on its own terms.
        """
        if not _POSIX:
            return
        try:
            signal.signal(signal.SIGWINCH, _on_winch)
            signal.signal(signal.SIGTERM, _on_terminate)
            signal.signal(signal.SIGHUP, _on_terminate)
            # SIGINT is delivered only if raw mode failed; with ISIG off, Ctrl+C
            # arrives as a keystroke instead.
            signal.signal(signal.SIGINT, _on_terminate)
        except (ValueError, OSError):  # pragma: no cover - not the main thread
            return

        previous = sys.excepthook

        def hook(exc_type, exc, tb):  # pragma: no cover - exception path
            # The terminal is usable again, so the traceback is readable.
            emergency_restore()
            previous(exc_type, exc, tb)

        sys.excepthook = hook


def _split_complete_utf8(buf: bytes) -> tuple[str, bytes]:
    """Return the longest valid-UTF-8 prefix and whatever is left over, which is
    at most three bytes of a truncated character."""
    end = len(buf)
    # A character is at most four bytes, so at most three can be incomplete.
    for back in range(min(4, len(buf))):
        i = len(buf) - 1 - back
        b = buf[i]
        if b & 0x80 == 0:
            break  # ASCII: nothing pending
        if b & 0xC0 == 0xC0:
            # A lead byte. If the character it starts is not yet complete, hold
            # it back.
            need = 4 if b & 0xF8 == 0xF0 else 3 if b & 0xF0 == 0xE0 else 2
            if len(buf) - i < need:
                end = i
            break
    return buf[:end].decode("utf-8", errors="replace"), buf[end:]
