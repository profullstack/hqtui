"""Decodes raw terminal bytes into normalized events.

Applications should never see an escape sequence — only ``"ctrl+c"``, ``"up"``,
or a printable character.

:meth:`InputParser.parse` takes ``str`` because a sequence can be split across
reads and the parser has to hold the remainder. Splitting a *multi-byte
character* across reads is the terminal's problem, not the parser's:
:class:`~hqtui.terminal.Terminal` buffers partial UTF-8 before it gets here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from .unicode import utf16_length

__all__ = [
    "FocusEvent",
    "InputEvent",
    "InputParser",
    "KeyEvent",
    "MouseAction",
    "MouseButton",
    "MouseEvent",
    "PasteEvent",
    "match_key",
]


@dataclass(frozen=True, slots=True)
class KeyEvent:
    name: str
    """Normalized: ``"a"``, ``"up"``, ``"enter"``, ``"f5"``, ``"escape"``, ``"space"``."""
    key: str
    """Full form including modifiers, e.g. ``"ctrl+c"`` — what you match on."""
    ctrl: bool = False
    alt: bool = False
    shift: bool = False
    char: str | None = None
    """The printable character, when there is one."""
    raw: str = ""

    type = "key"


class MouseAction(str, Enum):
    PRESS = "press"
    RELEASE = "release"
    MOVE = "move"
    DRAG = "drag"
    SCROLL = "scroll"


class MouseButton(str, Enum):
    LEFT = "left"
    MIDDLE = "middle"
    RIGHT = "right"
    NONE = "none"


@dataclass(frozen=True, slots=True)
class MouseEvent:
    action: MouseAction
    button: MouseButton
    x: int
    """Zero-based cell column."""
    y: int
    scroll: int = 0
    """-1 up, 1 down; 0 when this is not a scroll."""
    ctrl: bool = False
    alt: bool = False
    shift: bool = False

    type = "mouse"


@dataclass(frozen=True, slots=True)
class PasteEvent:
    text: str

    type = "paste"


@dataclass(frozen=True, slots=True)
class FocusEvent:
    focused: bool

    type = "focus"


InputEvent = "KeyEvent | MouseEvent | PasteEvent | FocusEvent"

# The escape sequences that map to a named key, without their leading ESC.
_SPECIAL: dict[str, str] = {
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

# Longest match first, so `[1~` never loses to a shorter prefix.
_SPECIAL_SORTED = sorted(_SPECIAL, key=len, reverse=True)

_MOUSE_RE = re.compile(r"^\x1b\[<(\d+);(\d+);(\d+)([Mm])")
_PARTIAL_MOUSE_RE = re.compile(r"^\x1b\[<[\d;]*$")
_MODDED_RE = re.compile(r"^\x1b\[1;(\d+)([A-HPQRS])")
_MODDED_TILDE_RE = re.compile(r"^\x1b\[(\d+);(\d+)~")
_PARTIAL_CSI_RE = re.compile(r"^\x1b(\[|O)[\d;<]*$")

_PASTE_START = "\x1b[200~"
_PASTE_END = "\x1b[201~"


def _decode_modifiers(param: int) -> tuple[bool, bool, bool]:
    """xterm modifier parameter: 1 + bitfield(shift=1, alt=2, ctrl=4).

    Returns ``(shift, alt, ctrl)``.
    """
    bits = max(0, param - 1)
    return bool(bits & 1), bool(bits & 2), bool(bits & 4)


def _key(
    name: str,
    ctrl: bool = False,
    alt: bool = False,
    shift: bool = False,
    char: str | None = None,
    raw: str = "",
) -> KeyEvent:
    parts: list[str] = []
    if ctrl:
        parts.append("ctrl")
    if alt:
        parts.append("alt")
    # The reference tests `name.length`, which counts UTF-16 units. It only
    # matters for named keys, which are all ASCII, but matching it exactly costs
    # nothing.
    if shift and utf16_length(name) > 1:
        parts.append("shift")
    parts.append(name)
    return KeyEvent(
        name=name, key="+".join(parts), ctrl=ctrl, alt=alt, shift=shift, char=char, raw=raw
    )


def _partial_suffix(text: str, marker: str) -> int:
    """Length of the longest suffix of ``text`` that is a proper prefix of
    ``marker``."""
    for n in range(min(len(text), len(marker) - 1), 0, -1):
        if text.endswith(marker[:n]):
            return n
    return 0


class InputParser:
    """Feed it chunks, get events.

    Stateful, so a sequence split across two reads — routine over SSH — still
    decodes correctly.
    """

    __slots__ = ("_pending", "_paste_buffer", "_paste_tail")

    def __init__(self) -> None:
        self._pending = ""
        self._paste_buffer: str | None = None
        # Bytes held back mid-paste because they could be the start of the end
        # marker. Kept separate from `_pending` so they do not look like an
        # unterminated escape and trip the Escape-key timeout.
        self._paste_tail = ""

    @property
    def has_pending(self) -> bool:
        """True when bytes are buffered awaiting the rest of a sequence."""
        return bool(self._pending)

    def flush(self) -> list:
        """Resolve buffered bytes that turned out to be complete after all.

        A lone ESC is ambiguous — it only becomes the Escape key once no more
        bytes follow — so the terminal calls this on a short timeout.
        """
        # `_paste_tail` is deliberately left alone. Folding it into the paste
        # content here destroyed a partial end marker whenever the Escape
        # timeout fired between the two reads carrying it: the rest of the
        # marker then arrived alone, never matched, and the paste could never
        # end — the exact wedge this holdback exists to prevent.
        if not self._pending:
            return []
        data, self._pending = self._pending, ""
        if data == "\x1b":
            return [_key("escape", raw="\x1b")]
        # An incomplete sequence that never completed: emit ESC and re-parse.
        return [_key("escape", raw="\x1b"), *self.parse(data[1:])]

    def parse(self, chunk: str) -> list:
        events: list = []
        # The reference prepends the paste tail to `pending + chunk`; with only
        # one of the two ever set at a time, this order is the same string.
        data = self._paste_tail + self._pending + chunk
        self._paste_tail = self._pending = ""

        while data:
            if self._paste_buffer is not None:
                end = data.find(_PASTE_END)
                if end == -1:
                    # The end marker can straddle two reads, which is routine
                    # over SSH. Swallowing a partial one here used to lose it for
                    # good: the paste never ended, and every later keystroke —
                    # Ctrl+C included — went into the buffer instead of being
                    # dispatched.
                    keep = _partial_suffix(data, _PASTE_END)
                    split = len(data) - keep
                    self._paste_buffer += data[:split]
                    self._paste_tail = data[split:]
                    break
                self._paste_buffer += data[:end]
                events.append(PasteEvent(self._paste_buffer))
                self._paste_buffer = None
                data = data[end + len(_PASTE_END) :]
                continue

            if data[0] != "\x1b":
                consumed = _parse_plain(data, events)
                data = data[consumed:]
                continue

            # Lone ESC at the end of a chunk: could be the start of a sequence.
            if len(data) == 1:
                self._pending = data
                break

            consumed = self._parse_escape(data, events)
            if consumed < 0:
                self._pending = data  # incomplete; wait for more bytes
                break
            data = data[consumed:]
        return events

    def _parse_escape(self, data: str, events: list) -> int:
        """Returns -1 when the sequence is incomplete and more bytes are needed."""
        if data.startswith(_PASTE_START):
            self._paste_buffer = ""
            return len(_PASTE_START)
        if data.startswith("\x1b[I"):
            events.append(FocusEvent(True))
            return 3
        if data.startswith("\x1b[O"):
            events.append(FocusEvent(False))
            return 3

        # SGR mouse: ESC [ < b ; x ; y (M press | m release)
        mouse = _MOUSE_RE.match(data)
        if mouse:
            events.append(
                _decode_mouse(
                    int(mouse[1]), int(mouse[2]), int(mouse[3]), mouse[4] == "M"
                )
            )
            return len(mouse[0])
        if _PARTIAL_MOUSE_RE.match(data):
            return -1

        # CSI with modifier parameters: ESC [ 1 ; 5 A  → ctrl+up
        modded = _MODDED_RE.match(data)
        if modded:
            base = _SPECIAL.get(f"[{modded[2]}") or _SPECIAL.get(f"O{modded[2]}")
            if base:
                shift, alt, ctrl = _decode_modifiers(int(modded[1]))
                events.append(_key(base, ctrl, alt, shift, raw=modded[0]))
                return len(modded[0])
        tilde = _MODDED_TILDE_RE.match(data)
        if tilde:
            base = _SPECIAL.get(f"[{tilde[1]}~")
            if base:
                shift, alt, ctrl = _decode_modifiers(int(tilde[2]))
                events.append(_key(base, ctrl, alt, shift, raw=tilde[0]))
                return len(tilde[0])

        # Plain special keys, longest match first.
        for seq in _SPECIAL_SORTED:
            full = "\x1b" + seq
            if data.startswith(full):
                name = _SPECIAL[seq]
                if name == "shift+tab":
                    events.append(_key("tab", shift=True, raw=full))
                else:
                    events.append(_key(name, raw=full))
                return len(full)

        # Possibly-incomplete CSI/SS3 sequence.
        if _PARTIAL_CSI_RE.match(data):
            return -1

        # Alt+key.
        if len(data) >= 2 and data[1] not in "[O":
            sub: list = []
            consumed = _parse_plain(data[1:], sub)
            if sub and isinstance(sub[0], KeyEvent):
                first = sub[0]
                events.append(
                    _key(
                        first.name, ctrl=first.ctrl, alt=True, shift=first.shift,
                        char=first.char, raw="\x1b" + first.raw,
                    )
                )
                return consumed + 1

        events.append(_key("escape", raw="\x1b"))
        return 1


def _parse_plain(data: str, events: list) -> int:
    """Returns the number of characters consumed."""
    ch = data[0]
    cp = ord(ch)

    if cp in (13, 10):
        events.append(_key("enter", raw=ch))
    elif cp == 9:
        events.append(_key("tab", raw=ch))
    elif cp in (127, 8):
        events.append(_key("backspace", raw=ch))
    elif cp == 32:
        events.append(_key("space", char=" ", raw=ch))
    elif cp < 32:
        # Ctrl+letter arrives as the control code itself.
        events.append(_key(chr(cp + 96), ctrl=True, raw=ch))
    else:
        events.append(_key(ch, char=ch, raw=ch))
    return 1


def _decode_mouse(code: int, col: int, row: int, pressed: bool) -> MouseEvent:
    shift = bool(code & 4)
    alt = bool(code & 8)
    ctrl = bool(code & 16)
    motion = bool(code & 32)
    is_scroll = bool(code & 64)
    bits = code & 3

    button_of = {
        0: MouseButton.LEFT,
        1: MouseButton.MIDDLE,
        2: MouseButton.RIGHT,
    }.get(bits, MouseButton.NONE)

    if is_scroll:
        action, button, scroll = MouseAction.SCROLL, MouseButton.NONE, (-1 if bits == 0 else 1)
    elif motion:
        action = MouseAction.MOVE if bits == 3 else MouseAction.DRAG
        button, scroll = button_of, 0
    else:
        action = MouseAction.PRESS if pressed else MouseAction.RELEASE
        button, scroll = button_of, 0

    return MouseEvent(
        action=action, button=button, x=max(0, col - 1), y=max(0, row - 1),
        scroll=scroll, ctrl=ctrl, alt=alt, shift=shift,
    )


def match_key(event: KeyEvent, binding: str) -> bool:
    """Does this event match a binding like ``"ctrl+c"``, ``"q"``, or ``"f10"``?"""
    b = binding.strip().lower()
    if event.key.lower() == b:
        return True
    # A bare name matches whatever the shift state. Rejecting shift here was
    # justified by Tab focus firing both ways at once, which was simply wrong —
    # App reads the name directly and never calls this — and it silently stopped
    # every shifted named key (shift+up, shift+home, shift+f1, …) from matching
    # its own name. Bind "shift+tab" to distinguish; `key` carries it.
    return event.name.lower() == b and not event.ctrl and not event.alt
