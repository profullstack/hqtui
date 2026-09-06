"""Turns two framebuffers into the smallest practical stream of escape sequences.

The encoder keeps a model of the terminal's current pen so no redundant SGR is
emitted.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import ansi
from .buffer import Attrs, FrameBuffer
from .capabilities import ColorDepth
from .color import Color, DEFAULT_COLOR
from .unicode import CONTINUATION, cell_text, cell_width

__all__ = ["EncodeResult", "Encoder", "encode_full"]

_GAP_MERGE = 5
"""Rewriting up to this many unchanged cells is cheaper than the escape sequence
needed to jump over them, so neighbouring dirty spans get merged."""

_ATTR_CODES = (
    (Attrs.BOLD, 1),
    (Attrs.DIM, 2),
    (Attrs.ITALIC, 3),
    (Attrs.UNDERLINE, 4),
    (Attrs.BLINK, 5),
    (Attrs.REVERSE, 7),
    (Attrs.STRIKE, 9),
)


@dataclass(frozen=True, slots=True)
class EncodeResult:
    output: str
    """The bytes to hand to stdout."""
    changed_cells: int
    dirty_rows: int
    """Rows that contained at least one change."""


class Encoder:
    __slots__ = ("colors", "monochrome", "_x", "_y", "_known", "_fg", "_bg", "_attrs", "_parts")

    def __init__(
        self, colors: ColorDepth = ColorDepth.TRUECOLOR, monochrome: bool = False
    ) -> None:
        self.colors = colors
        self.monochrome = monochrome
        self._parts: list[str] = []
        self._reset_state()

    def _reset_state(self) -> None:
        self._x = -1
        self._y = -1
        # False after anything that makes the cursor position unknowable.
        self._known = False
        self._fg = DEFAULT_COLOR
        self._bg = DEFAULT_COLOR
        self._attrs = 0

    def invalidate_state(self) -> None:
        """Forget what we believe about the terminal; the next write re-states
        everything."""
        self._reset_state()
        self._parts.append("\x1b[0m")

    def _fg_seq(self, c: Color) -> str:
        if self.colors == ColorDepth.NONE:
            return ""
        if c == DEFAULT_COLOR:
            return ansi.FG_DEFAULT
        col = c.grayscale() if self.monochrome else c
        if self.colors == ColorDepth.TRUECOLOR:
            return ansi.fg_true(col.r, col.g, col.b)
        if self.colors == ColorDepth.ANSI256:
            return ansi.fg_256(col.to_256())
        return ansi.fg_16(col.to_16())

    def _bg_seq(self, c: Color) -> str:
        if self.colors == ColorDepth.NONE:
            return ""
        if c == DEFAULT_COLOR:
            return ansi.BG_DEFAULT
        col = c.grayscale() if self.monochrome else c
        if self.colors == ColorDepth.TRUECOLOR:
            return ansi.bg_true(col.r, col.g, col.b)
        if self.colors == ColorDepth.ANSI256:
            return ansi.bg_256(col.to_256())
        return ansi.bg_16(col.to_16())

    def _apply_style(self, fg: Color, bg: Color, attrs: int) -> None:
        if self._fg == fg and self._bg == bg and self._attrs == attrs:
            return

        # Attributes can only be added cheaply; removing one means a full reset.
        if self._attrs & ~attrs:
            self._parts.append("\x1b[0m")
            self._attrs = 0
            self._fg = DEFAULT_COLOR
            self._bg = DEFAULT_COLOR

        added = attrs & ~self._attrs
        if added:
            codes = [code for bit, code in _ATTR_CODES if added & bit]
            if codes:
                self._parts.append("\x1b[" + ";".join(str(c) for c in codes) + "m")
            self._attrs = attrs

        if self._fg != fg:
            self._parts.append(self._fg_seq(fg))
            self._fg = fg
        if self._bg != bg:
            self._parts.append(self._bg_seq(bg))
            self._bg = bg

    def _move_cursor(self, x: int, y: int) -> None:
        if self._known and self._y == y:
            if self._x == x:
                return
            if x > self._x and x - self._x <= 3:
                # Short hop: cheaper than a full CUP, and never repaints cells.
                self._parts.append(ansi.move_right(x - self._x))
            elif x == 0:
                self._parts.append("\r")
            else:
                self._parts.append(ansi.move_to_column(x))
        else:
            self._parts.append(ansi.move_to(x, y))
        self._x, self._y, self._known = x, y, True

    def encode(self, prev: FrameBuffer, next_: FrameBuffer, full: bool = False) -> EncodeResult:
        """Encode the difference between ``prev`` and ``next_``.

        Pass ``full`` to repaint every cell (first frame, resize, or after a
        redraw request).
        """
        self._parts = []
        changed = 0
        dirty_rows = 0

        w, h = next_.width, next_.height
        same_size = prev.width == w and prev.height == h
        repaint = full or not same_size
        if repaint:
            self.invalidate_state()

        nc, nf, nb, na = next_.chars, next_.fg, next_.bg, next_.attrs
        pc, pf, pb, pa = prev.chars, prev.fg, prev.bg, prev.attrs

        def differs(i: int) -> bool:
            """Whether this cell actually changed. When the sizes disagree the
            previous frame cannot be indexed with this frame's stride, so every
            cell counts as different."""
            if not same_size:
                return True
            return nc[i] != pc[i] or nf[i] != pf[i] or nb[i] != pb[i] or na[i] != pa[i]

        def dirty_at(i: int) -> bool:
            """Whether this cell needs emitting, which a full repaint forces even
            for unchanged cells. The two are deliberately separate:
            ``changed_cells`` reports real churn, not repaint volume."""
            return repaint or differs(i)

        for y in range(h):
            row_start = y * w
            x = 0
            row_dirty = False

            while x < w:
                if not dirty_at(row_start + x):
                    x += 1
                    continue

                # Walk left onto the lead cell if we landed on a wide char's tail.
                start = x
                while start > 0 and nc[row_start + start] == CONTINUATION:
                    start -= 1

                # Extend the run while cells are dirty, tolerating short gaps.
                end, clean, probe = start, 0, start
                while probe < w:
                    if dirty_at(row_start + probe):
                        end, clean = probe, 0
                    else:
                        clean += 1
                        if clean > _GAP_MERGE:
                            break
                    probe += 1

                self._move_cursor(start, y)
                for cx in range(start, end + 1):
                    j = row_start + cx
                    value = nc[j]
                    if value == CONTINUATION:
                        continue  # emitted with its lead cell
                    self._apply_style(Color(nf[j]), Color(nb[j]), na[j])
                    self._parts.append(" " if value == 0 else cell_text(value))
                    self._x += max(1, cell_width(value))
                    if differs(j):
                        changed += 1
                # Writing the final column may have triggered autowrap; stop
                # trusting x.
                if self._x >= w:
                    self._known = False
                row_dirty = True
                x = end + 1

            if row_dirty:
                dirty_rows += 1

        return EncodeResult("".join(self._parts), changed, dirty_rows)


def encode_full(
    buffer: FrameBuffer,
    colors: ColorDepth = ColorDepth.TRUECOLOR,
    monochrome: bool = False,
) -> str:
    """One-shot encode of a whole buffer, e.g. for a screenshot."""
    empty = FrameBuffer(buffer.width, buffer.height)
    return Encoder(colors, monochrome).encode(empty, buffer, True).output
