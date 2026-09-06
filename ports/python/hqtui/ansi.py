"""Raw VT/ANSI control sequences.

Nothing above this layer writes an escape by hand.
"""

from __future__ import annotations

from .unicode import strip_unsafe

__all__ = [
    "ESC", "CSI", "RESET",
    "ALTERNATE_SCREEN_ON", "ALTERNATE_SCREEN_OFF",
    "CURSOR_HIDE", "CURSOR_SHOW", "CURSOR_HOME",
    "CLEAR_SCREEN", "MOUSE_ON", "MOUSE_OFF",
    "BRACKETED_PASTE_ON", "BRACKETED_PASTE_OFF",
    "FOCUS_ON", "FOCUS_OFF", "BEGIN_SYNC", "END_SYNC",
    "FG_DEFAULT", "BG_DEFAULT",
    "move_to", "move_right", "move_to_column", "set_title",
    "fg_true", "bg_true", "fg_256", "bg_256", "fg_16", "bg_16",
    "strip_ansi",
]

ESC = "\x1b"
CSI = "\x1b["

RESET = "\x1b[0m"

ALTERNATE_SCREEN_ON = "\x1b[?1049h"
ALTERNATE_SCREEN_OFF = "\x1b[?1049l"

CURSOR_HIDE = "\x1b[?25l"
CURSOR_SHOW = "\x1b[?25h"
CURSOR_HOME = "\x1b[H"
CURSOR_SAVE = "\x1b7"
CURSOR_RESTORE = "\x1b8"

CLEAR_SCREEN = "\x1b[2J"
CLEAR_SCROLLBACK = "\x1b[3J"
CLEAR_LINE = "\x1b[2K"
CLEAR_TO_END = "\x1b[0J"

# 1000 = clicks, 1002 = drag, 1003 = any motion, 1006 = SGR extended coords.
MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h"
MOUSE_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l"

BRACKETED_PASTE_ON = "\x1b[?2004h"
BRACKETED_PASTE_OFF = "\x1b[?2004l"

FOCUS_ON = "\x1b[?1004h"
FOCUS_OFF = "\x1b[?1004l"

# Atomic frame: the terminal shows nothing until END_SYNC. Kills tearing.
BEGIN_SYNC = "\x1b[?2026h"
END_SYNC = "\x1b[?2026l"

SOFT_RESET = "\x1b[!p"

FG_DEFAULT = "\x1b[39m"
BG_DEFAULT = "\x1b[49m"


def move_to(x: int, y: int) -> str:
    return f"\x1b[{y + 1};{x + 1}H"


def move_right(n: int) -> str:
    return "\x1b[C" if n == 1 else f"\x1b[{n}C"


def move_to_column(x: int) -> str:
    return f"\x1b[{x + 1}G"


def set_title(title: str) -> str:
    """The title is interpolated into an OSC sequence, so anything that could
    end or restart it has to go. ``strip_unsafe`` is the same policy the grid
    uses."""
    return f"\x1b]0;{strip_unsafe(title)}\x07"


def fg_true(r: int, g: int, b: int) -> str:
    return f"\x1b[38;2;{r};{g};{b}m"


def bg_true(r: int, g: int, b: int) -> str:
    return f"\x1b[48;2;{r};{g};{b}m"


def fg_256(i: int) -> str:
    return f"\x1b[38;5;{i}m"


def bg_256(i: int) -> str:
    return f"\x1b[48;5;{i}m"


def fg_16(i: int) -> str:
    return f"\x1b[{30 + i}m" if i < 8 else f"\x1b[{90 + i - 8}m"


def bg_16(i: int) -> str:
    return f"\x1b[{40 + i}m" if i < 8 else f"\x1b[{100 + i - 8}m"


_CSI_PARAMS = frozenset("0123456789;?<=>")


def _scan_to_terminator(text: str, start: int, bel_terminates: bool) -> int:
    n = len(text)
    j = start
    while j < n:
        c = text[j]
        if bel_terminates and c == "\x07":
            return j + 1
        if c == "\x9c":
            return j + 1
        if c == "\x1b" and j + 1 < n and text[j + 1] == "\\":
            return j + 2
        j += 1
    return n


def _is_text_unsafe(c: str) -> bool:
    """The grid's unsafe set minus tab, newline and carriage return.

    ``strip_ansi`` works on text, not cells, and multi-line callers rely on
    those three; the framebuffer refuses them separately, which is the right
    layer for it.
    """
    cp = ord(c)
    return (
        cp <= 0x08
        or cp in (0x0B, 0x0C)
        or 0x0E <= cp <= 0x1F
        or 0x7F <= cp <= 0x9F
        or 0x202A <= cp <= 0x202E
        or 0x2066 <= cp <= 0x2069
    )


def strip_ansi(text: str) -> str:
    """Strip escape sequences.

    Two things the obvious approach misses, both of which leave a live sequence
    behind: CSI may carry intermediate bytes (0x20-0x2f) before its final byte,
    as in ``ESC [ 0 SP q``; and every sequence has an 8-bit C1 form where a
    single byte replaces ``ESC x``. After the structured pass, anything still
    holding a control or bidi override is removed outright, so the result cannot
    steer a terminal even if a form was missed.
    """
    n = len(text)
    out: list[str] = []
    i = 0

    while i < n:
        c = text[i]

        # CSI: ESC [ … or the C1 form, U+009B.
        csi_start = -1
        if c == "\x1b" and i + 1 < n and text[i + 1] == "[":
            csi_start = i + 2
        elif c == "\x9b":
            csi_start = i + 1
        if csi_start >= 0:
            j = csi_start
            while j < n and text[j] in _CSI_PARAMS:
                j += 1
            while j < n and 0x20 <= ord(text[j]) <= 0x2F:
                j += 1
            # Without a final byte this is not a sequence yet; fall through and
            # let the unsafe pass below drop the bare ESC.
            if j < n and 0x40 <= ord(text[j]) <= 0x7E:
                i = j + 1
                continue

        # OSC: ESC ] … terminated by BEL, ST, C1 ST, or end of string.
        osc_start = -1
        if c == "\x1b" and i + 1 < n and text[i + 1] == "]":
            osc_start = i + 2
        elif c == "\x9d":
            osc_start = i + 1
        if osc_start >= 0:
            i = _scan_to_terminator(text, osc_start, True)
            continue

        # DCS: ESC P … terminated by ST, C1 ST, or end of string.
        dcs_start = -1
        if c == "\x1b" and i + 1 < n and text[i + 1] == "P":
            dcs_start = i + 2
        elif c == "\x90":
            dcs_start = i + 1
        if dcs_start >= 0:
            i = _scan_to_terminator(text, dcs_start, False)
            continue

        # Any other two-character escape: ESC then 0x40-0x5A or 0x5C-0x5F.
        if c == "\x1b" and i + 1 < n:
            nxt = ord(text[i + 1])
            if 0x40 <= nxt <= 0x5A or 0x5C <= nxt <= 0x5F:
                i += 2
                continue

        out.append(c)
        i += 1

    return "".join(c for c in out if not _is_text_unsafe(c))
