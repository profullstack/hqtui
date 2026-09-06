"""The screen is one grid of cells, not a tree of widgets.

Four parallel arrays keep a frame allocation-free: no object is created per
cell, ever. Python's ``array`` module gives the same flat typed storage the
reference gets from ``Uint32Array``, and matters more here than there — a list
of boxed ints for a 200x50 screen is ten thousand objects per frame.
"""

from __future__ import annotations

from array import array
from dataclasses import dataclass
from typing import Iterable

from .color import Color, DEFAULT_COLOR
from .unicode import (
    CLUSTER_BASE,
    CONTINUATION,
    REPLACEMENT,
    cell_text,
    cell_width,
    graphemes,
    is_unsafe_codepoint,
)

__all__ = ["Attrs", "Style", "FrameBuffer"]


class Attrs:
    """Style attribute bits packed into a cell's 16-bit slot.

    A namespace of ints rather than an ``IntFlag``: these are combined and
    tested millions of times per frame, and ``IntFlag`` arithmetic allocates.
    """

    NONE = 0
    BOLD = 1 << 0
    DIM = 1 << 1
    ITALIC = 1 << 2
    UNDERLINE = 1 << 3
    BLINK = 1 << 4
    REVERSE = 1 << 5
    STRIKE = 1 << 6


@dataclass(frozen=True, slots=True)
class Style:
    """A partial style.

    ``None`` on a field means "leave whatever is already there", which is what
    lets a widget set only the foreground of a region.
    """

    fg: Color | None = None
    bg: Color | None = None
    attrs: int | None = None

    def merged(self, other: "Style") -> "Style":
        """Fill in anything this style leaves unset from ``other``."""
        return Style(
            fg=self.fg if self.fg is not None else other.fg,
            bg=self.bg if self.bg is not None else other.bg,
            attrs=self.attrs if self.attrs is not None else other.attrs,
        )


NO_STYLE = Style()

_INFINITY = 1 << 30


class FrameBuffer:
    """A grid of styled cells. The only thing the encoder ever reads."""

    __slots__ = ("width", "height", "chars", "fg", "bg", "attrs")

    def __init__(self, width: int, height: int) -> None:
        self.width = max(0, int(width))
        self.height = max(0, int(height))
        n = self.width * self.height
        self.chars = array("L", [32]) * n if n else array("L")
        self.fg = array("L", [0]) * n if n else array("L")
        self.bg = array("L", [0]) * n if n else array("L")
        self.attrs = array("H", [0]) * n if n else array("H")

    def resize(self, width: int, height: int) -> None:
        """Resize, reusing the existing allocation when it is large enough."""
        w, h = max(0, int(width)), max(0, int(height))
        if w == self.width and h == self.height:
            return
        n = w * h
        if n > len(self.chars):
            self.chars = array("L", [32]) * n if n else array("L")
            self.fg = array("L", [0]) * n if n else array("L")
            self.bg = array("L", [0]) * n if n else array("L")
            self.attrs = array("H", [0]) * n if n else array("H")
        self.width, self.height = w, h
        self.clear()

    def index(self, x: int, y: int) -> int:
        return y * self.width + x

    def clear(self, bg: Color = DEFAULT_COLOR, fg: Color = DEFAULT_COLOR) -> None:
        n = self.width * self.height
        self.chars[:n] = array("L", [32]) * n if n else array("L")
        self.fg[:n] = array("L", [int(fg)]) * n if n else array("L")
        self.bg[:n] = array("L", [int(bg)]) * n if n else array("L")
        self.attrs[:n] = array("H", [0]) * n if n else array("H")

    def in_bounds(self, x: int, y: int) -> bool:
        return 0 <= x < self.width and 0 <= y < self.height

    def _apply(self, i: int, style: Style) -> None:
        if style.fg is not None:
            self.fg[i] = int(style.fg)
        if style.bg is not None:
            self.bg[i] = int(style.bg)
        if style.attrs is not None:
            self.attrs[i] = style.attrs

    def set_cell(self, x: int, y: int, value: int, style: Style = NO_STYLE) -> int:
        """Write one already-decoded cell value. Returns columns consumed.

        This is the only path that writes a character into the grid, and the
        encoder hands cell text straight to the terminal. Refusing unsafe values
        here means the buffer *cannot* hold a live escape, whatever the caller
        passes — including the low-level escape hatch.
        """
        if not self.in_bounds(x, y):
            return 0

        # Validate what will actually be stored: the arrays are unsigned, so a
        # huge value truncates and could otherwise become a live ESC.
        value &= 0xFFFFFFFF
        # Ordered so printable ASCII costs one comparison. A lead-less
        # continuation is not writable either; it would silently eat a column.
        if value >= 0x7F:
            if is_unsafe_codepoint(value) or value == CONTINUATION:
                value = 32
            elif not _valid_scalar(value):
                value = REPLACEMENT
        elif value < 0x20:
            value = 32

        w = cell_width(value)
        i = self.index(x, y)
        # Overwriting the tail of a wide char to our left would orphan it.
        if self.chars[i] == CONTINUATION and x > 0:
            self.chars[i - 1] = 32
        self.chars[i] = value
        self._apply(i, style)

        if w == 2:
            if x + 1 < self.width:
                self.chars[i + 1] = CONTINUATION
                self._apply(i + 1, style)
            else:
                # No room for the second half: draw a space rather than corrupt
                # the row.
                self.chars[i] = 32
                return 1
        return max(1, w)

    def write(
        self, x: int, y: int, text: str, style: Style = NO_STYLE, max_width: int = _INFINITY
    ) -> int:
        """Write text left to right. Returns the number of columns written."""
        if y < 0 or y >= self.height:
            return 0
        cx, used = x, 0
        for g in graphemes(text):
            if used + g.width > max_width:
                break
            if cx >= self.width or cx + g.width > self.width:
                break
            if cx >= 0:
                self.set_cell(cx, y, g.value, style)
            cx += g.width
            used += g.width
        return used

    def fill_rect(
        self, x: int, y: int, w: int, h: int, ch: int = 32, style: Style = NO_STYLE
    ) -> None:
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self.width, x + w), min(self.height, y + h)
        for cy in range(y0, y1):
            for cx in range(x0, x1):
                self.set_cell(cx, cy, ch, style)

    def style_rect(self, x: int, y: int, w: int, h: int, style: Style) -> None:
        """Restyle a region without touching its characters."""
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self.width, x + w), min(self.height, y + h)
        for cy in range(y0, y1):
            row = cy * self.width
            for cx in range(x0, x1):
                self._apply(row + cx, style)

    def copy_from(self, other: "FrameBuffer") -> None:
        """Copy another buffer's contents (same dimensions assumed)."""
        n = min(self.width * self.height, other.width * other.height)
        self.chars[:n] = other.chars[:n]
        self.fg[:n] = other.fg[:n]
        self.bg[:n] = other.bg[:n]
        self.attrs[:n] = other.attrs[:n]

    def row_text(self, y: int) -> str:
        """Plain text of one row, for tests and headless rendering."""
        if y < 0 or y >= self.height:
            return ""
        row = y * self.width
        parts: list[str] = []
        for x in range(self.width):
            v = self.chars[row + x]
            if v == CONTINUATION:
                continue
            parts.append(" " if v == 0 else cell_text(v))
        return "".join(parts)

    def to_text(self) -> str:
        """Whole buffer as plain text, trailing whitespace trimmed per row."""
        from .unicode import _trim_end

        return "\n".join(_trim_end(self.row_text(y)) for y in range(self.height))

    def cells(self) -> Iterable[int]:
        return self.chars[: self.width * self.height]


def _valid_scalar(value: int) -> bool:
    """A cell value only holds a real character if it is a Unicode scalar.

    The reference reaches this check via lone surrogates, which a Python ``str``
    cannot contain; a caller using the raw ``set_cell`` escape hatch still can,
    so the guard stays.
    """
    if value >= CLUSTER_BASE:
        return True
    return value <= 0x10FFFF and not (0xD800 <= value <= 0xDFFF)
