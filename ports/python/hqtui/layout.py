"""Sizes are resolved once per frame with a single pass.

No manual coordinate arithmetic should ever appear in application code.

::

    12       12 columns/rows
    "40%"    40% of the container
    "2fr"    two shares of whatever is left over
    "auto"   whatever the widget says it needs
    "fill"   same as "1fr"

Python takes the reference implementation's spelling directly: a ``Size`` is an
``int`` or one of those strings, and nothing needs constructing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import NamedTuple, Sequence

from .color import round_half_up

__all__ = [
    "Constraint",
    "Direction",
    "Padding",
    "Rect",
    "Size",
    "normalize_padding",
    "solve",
    "stack",
]

Size = "int | str"
"""A number of cells, or one of ``"auto"``, ``"fill"``, ``"40%"``, ``"2fr"``."""

Padding = "int | tuple[int, int] | tuple[int, int, int, int]"
"""One value, ``(vertical, horizontal)``, or ``(top, right, bottom, left)``."""


@dataclass(frozen=True, slots=True)
class Constraint:
    """What one item contributes to a layout solve."""

    size: "int | str | None" = None
    min: int | None = None
    max: int | None = None
    intrinsic: int | None = None
    """Natural size, used by ``"auto"`` and as the floor for flexible items."""


class Rect(NamedTuple):
    """A rectangle in absolute buffer coordinates."""

    x: int
    y: int
    width: int
    height: int

    @property
    def is_empty(self) -> bool:
        return self.width <= 0 or self.height <= 0

    def contains(self, x: int, y: int) -> bool:
        return self.x <= x < self.x + self.width and self.y <= y < self.y + self.height

    def inset(self, padding: "int | tuple") -> "Rect":
        """Shrink by padding, never past zero."""
        t, r, b, left = normalize_padding(padding)
        return Rect(
            self.x + left,
            self.y + t,
            max(0, self.width - left - r),
            max(0, self.height - t - b),
        )

    def intersect(self, other: "Rect") -> "Rect":
        x, y = max(self.x, other.x), max(self.y, other.y)
        x2 = min(self.x + self.width, other.x + other.width)
        y2 = min(self.y + self.height, other.y + other.height)
        return Rect(x, y, max(0, x2 - x), max(0, y2 - y))


def normalize_padding(padding: "int | tuple | None") -> tuple[int, int, int, int]:
    if padding is None:
        return (0, 0, 0, 0)
    if isinstance(padding, int):
        return (padding, padding, padding, padding)
    if len(padding) == 2:
        v, h = padding
        return (v, h, v, h)
    return tuple(padding)  # type: ignore[return-value]


class Direction(str, Enum):
    """Which way a container lays its children out."""

    ROW = "row"
    COLUMN = "column"


class _Resolved(NamedTuple):
    value: float
    fr: float
    min: float
    max: float


def _leading_float(s: str) -> float:
    """``Number.parseFloat``: read as much of a leading number as parses."""
    s = s.strip()
    end, seen_digit, seen_dot = 0, False, False
    while end < len(s):
        c = s[end]
        if c in "+-" and end == 0:
            pass
        elif c.isdigit():
            seen_digit = True
        elif c == "." and not seen_dot:
            seen_dot = True
        else:
            break
        end += 1
    if not seen_digit:
        return 0.0
    try:
        return float(s[:end])
    except ValueError:
        return 0.0


def _parse(c: Constraint, total: int) -> _Resolved:
    lo = 0.0 if c.min is None else float(c.min)
    hi = math.inf if c.max is None else float(c.max)
    size = "auto" if c.size is None else c.size

    if isinstance(size, (int, float)) and not isinstance(size, bool):
        return _Resolved(float(size), 0.0, lo, hi)

    s = str(size).strip()
    if s == "auto":
        return _Resolved(float(c.intrinsic or 0), 0.0, lo, hi)
    if s == "fill":
        return _Resolved(0.0, 1.0, lo, hi)
    if s.endswith("%"):
        pct = _leading_float(s[:-1]) / 100
        if not math.isfinite(pct):
            pct = 0.0
        return _Resolved(round_half_up(total * pct), 0.0, lo, hi)
    if s.endswith("fr"):
        n = _leading_float(s[:-2])
        return _Resolved(0.0, n if math.isfinite(n) and n > 0 else 1.0, lo, hi)
    return _Resolved(_leading_float(s), 0.0, lo, hi)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def solve(total: int, items: Sequence[Constraint], gap: int = 0) -> list[int]:
    """Distribute ``total`` across ``items``, honouring gaps, fractions and
    min/max. Always returns non-negative sizes that sum to at most ``total``."""
    n = len(items)
    if n == 0:
        return []
    available = max(0, total - gap * (n - 1))
    parsed = [_parse(c, available) for c in items]

    used = 0
    fr_total = 0.0
    # -1 marks an item resolved in the flexible pass below.
    out = [-1] * n

    for i in range(n):
        p = parsed[i]
        if p.fr > 0:
            fr_total += p.fr
        else:
            out[i] = int(_clamp(round_half_up(p.value), p.min, min(p.max, available)))
            used += out[i]

    free = max(0.0, float(available - used))
    if fr_total > 0:
        # Two passes: clamped items give their surplus back to the rest.
        remaining_fr = fr_total
        pool = free
        pending = [i for i in range(n) if out[i] == -1]

        changed = True
        while changed and pending:
            changed = False
            for i in list(pending):
                p = parsed[i]
                share = pool * p.fr / remaining_fr if remaining_fr > 0 else 0.0
                clamped = _clamp(share, p.min, p.max)
                if clamped != share:
                    out[i] = int(round_half_up(clamped))
                    pool -= out[i]
                    remaining_fr -= p.fr
                    pending.remove(i)
                    changed = True

        # Distribute what is left, giving the rounding remainder to the last.
        assigned = 0
        for k, i in enumerate(pending):
            p = parsed[i]
            exact = pool * p.fr / remaining_fr if remaining_fr > 0 else 0.0
            v = max(0, int(pool) - assigned) if k == len(pending) - 1 else int(math.floor(exact))
            out[i] = v
            assigned += v

    # Overflow: shrink from the end until it fits rather than drawing outside.
    total_out = sum(out)
    if total_out > available:
        for i in range(n - 1, -1, -1):
            if total_out <= available:
                break
            shrink = min(out[i] - int(parsed[i].min), total_out - available)
            if shrink > 0:
                out[i] -= shrink
                total_out -= shrink
        for i in range(n - 1, -1, -1):
            if total_out <= available:
                break
            shrink = min(out[i], total_out - available)
            out[i] -= shrink
            total_out -= shrink

    return [max(0, v) for v in out]


def stack(
    rect: Rect,
    items: Sequence[Constraint],
    direction: "Direction | str" = Direction.COLUMN,
    gap: int = 0,
) -> list[Rect]:
    """Lay children out along one axis inside ``rect``."""
    horizontal = direction == Direction.ROW
    sizes = solve(rect.width if horizontal else rect.height, items, gap)
    out: list[Rect] = []
    offset = rect.x if horizontal else rect.y
    for size in sizes:
        if horizontal:
            out.append(Rect(offset, rect.y, size, rect.height))
        else:
            out.append(Rect(rect.x, offset, rect.width, size))
        offset += size + gap
    return out
