"""Braille turns every terminal cell into a 2x4 pixel matrix.

That is why a terminal graph can look like a real plot instead of a bar chart of
hashes.
"""

from __future__ import annotations

import math
from typing import Sequence

from ..color import round_half_up

__all__ = ["BrailleCanvas"]

_BRAILLE_BASE = 0x2800

# Dot numbering is column-major and famously not sequential.
_DOT_BITS = ((0x01, 0x08), (0x02, 0x10), (0x04, 0x20), (0x40, 0x80))

_LIMIT = 1e7
"""Coordinates are clamped to this before anything iterates over them.

It is far larger than any canvas and far below 2^53, where ``x += 1`` stops
advancing and a Bresenham walk can never reach its endpoint.
"""

_MAX_WALK = 100_000.0
"""Above this many Bresenham steps the walk is clipped to the canvas first.

Clipping shifts which pixels a partly-offscreen line lands on, so it is reserved
for walks long enough that their exact pattern cannot matter.
"""


def _is_nan(v: float) -> bool:
    return v != v


def _js_min(a: float, b: float) -> float:
    """``Math.min``, which propagates NaN where Python's ``min`` returns the
    first operand. Every bounds test below is written so that NaN falls out
    rather than landing in cell zero, and that only holds with JavaScript's
    semantics."""
    if _is_nan(a) or _is_nan(b):
        return math.nan
    return a if a < b else b


def _js_max(a: float, b: float) -> float:
    if _is_nan(a) or _is_nan(b):
        return math.nan
    return a if a > b else b


def _finite(v: float) -> float | None:
    """Finite, bounded, and direction-preserving. NaN has no direction."""
    if _is_nan(v):
        return None
    if v > _LIMIT:
        return _LIMIT
    if v < -_LIMIT:
        return -_LIMIT
    return v


class BrailleCanvas:
    __slots__ = ("width", "height", "cols", "rows", "_dots")

    def __init__(self, cols: int, rows: int) -> None:
        self.cols = max(0, int(cols))
        self.rows = max(0, int(rows))
        self.width = self.cols * 2
        """Pixel width: two per cell."""
        self.height = self.rows * 4
        """Pixel height: four per cell."""
        self._dots = bytearray(self.cols * self.rows)

    def clear(self) -> None:
        self._dots = bytearray(len(self._dots))

    def _locate(self, x: float, y: float) -> tuple[int, int] | None:
        """Resolve a pixel coordinate to a cell index and dot bit.

        The test is written positively so that NaN, which compares false against
        everything, is ignored rather than landing in cell 0.
        """
        px, py = round_half_up(x), round_half_up(y)
        if not (0 <= px < self.width and 0 <= py < self.height):
            return None
        ix, iy = int(px), int(py)
        return (iy >> 2) * self.cols + (ix >> 1), _DOT_BITS[iy & 3][ix & 1]

    def pixel(self, x: float, y: float) -> None:
        """Set one pixel. Out-of-range coordinates are ignored, not clamped."""
        found = self._locate(x, y)
        if found is not None:
            cell, bit = found
            self._dots[cell] |= bit

    def unset(self, x: float, y: float) -> None:
        found = self._locate(x, y)
        if found is not None:
            cell, bit = found
            self._dots[cell] &= ~bit & 0xFF

    def get(self, x: float, y: float) -> bool:
        found = self._locate(x, y)
        if found is None:
            return False
        cell, bit = found
        return bool(self._dots[cell] & bit)

    def _span(self, a: float, b: float, limit: int) -> tuple[int, int]:
        """The inclusive range an axis-aligned loop should cover, clipped to the
        canvas. Nothing outside it can draw, so clipping here is what makes
        every loop below finite for any input — infinite, enormous or NaN."""
        lo, hi = _js_min(a, b), _js_max(a, b)
        if not lo <= hi:
            return 0, -1
        start = _js_max(0, math.ceil(lo))
        end = _js_min(limit - 1, math.floor(hi))
        return int(start), int(end)

    def _clip(
        self, x0: float, y0: float, x1: float, y1: float
    ) -> tuple[float, float, float, float] | None:
        """Liang-Barsky.

        Clipping before the walk — rather than clamping the endpoints, which
        would change the slope — keeps the line where it belongs and bounds the
        number of steps to the canvas.
        """
        fx0, fy0 = _finite(x0), _finite(y0)
        fx1, fy1 = _finite(x1), _finite(y1)
        if fx0 is None or fy0 is None or fx1 is None or fy1 is None:
            return None
        dx, dy = fx1 - fx0, fy1 - fy0
        t0, t1 = 0.0, 1.0
        for p, q in (
            (-dx, fx0),
            (dx, self.width - 1 - fx0),
            (-dy, fy0),
            (dy, self.height - 1 - fy0),
        ):
            if p == 0:
                if q < 0:
                    return None
                continue
            r = q / p
            if p < 0:
                if r > t1:
                    return None
                if r > t0:
                    t0 = r
            else:
                if r < t0:
                    return None
                if r < t1:
                    t1 = r
        return fx0 + t0 * dx, fy0 + t0 * dy, fx0 + t1 * dx, fy0 + t1 * dy

    def line(self, x0: float, y0: float, x1: float, y1: float) -> None:
        """Bresenham. Used for every line graph in the library."""
        # The walk below only ends at `x == ex and y == ey`. Testing the
        # endpoints for finiteness is not enough to guarantee it gets there: the
        # deltas are derived from them and overflow, and past 2^53 `x += 1` does
        # not advance at all. Clipping to the canvas bounds the walk for every
        # input.
        ax, ay = _finite(x0), _finite(y0)
        bx, by = _finite(x1), _finite(y1)
        if ax is None or ay is None or bx is None or by is None:
            return
        if _js_max(abs(bx - ax), abs(by - ay)) > _MAX_WALK:
            clipped = self._clip(ax, ay, bx, by)
            if clipped is None:
                return
            ax, ay, bx, by = clipped

        x, y = int(round_half_up(ax)), int(round_half_up(ay))
        ex, ey = int(round_half_up(bx)), int(round_half_up(by))
        dx, dy = abs(ex - x), -abs(ey - y)
        sx = 1 if x < ex else -1
        sy = 1 if y < ey else -1
        err = dx + dy
        while True:
            self.pixel(x, y)
            if x == ex and y == ey:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x += sx
            if e2 <= dx:
                err += dx
                y += sy

    def polyline(self, points: Sequence[tuple[float, float]]) -> None:
        for i in range(1, len(points)):
            self.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])

    def vline(self, x: float, y0: float, y1: float) -> None:
        a, b = self._span(y0, y1, self.height)
        for y in range(a, b + 1):
            self.pixel(x, y)

    def hline(self, y: float, x0: float, x1: float) -> None:
        a, b = self._span(x0, x1, self.width)
        for x in range(a, b + 1):
            self.pixel(x, y)

    def rect(self, x0: float, y0: float, x1: float, y1: float) -> None:
        self.hline(y0, x0, x1)
        self.hline(y1, x0, x1)
        self.vline(x0, y0, y1)
        self.vline(x1, y0, y1)

    def fill_rect(self, x0: float, y0: float, x1: float, y1: float) -> None:
        a, b = self._span(y0, y1, self.height)
        for y in range(a, b + 1):
            self.hline(y, x0, x1)

    def fill_under(self, points: Sequence[tuple[float, float]], baseline: float) -> None:
        """Fill the area under a series — the shaded region of an area graph."""
        for i in range(1, len(points)):
            x0, y0 = points[i - 1]
            x1, y1 = points[i]
            # Bounded by the canvas: a span wider than it cannot add a column.
            raw = round_half_up(abs(x1 - x0)) or 1
            steps = _js_max(1, _js_min(self.width, raw))
            for s in range(int(steps) + 1):
                t = s / steps
                self.vline(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, baseline)

    def circle(self, cx: float, cy: float, radius: float) -> None:
        # A radius larger than the canvas draws the same arc as one exactly its
        # size, and an unbounded one never finishes the `x >= y` walk.
        r = _finite(radius)
        if r is None:
            return
        x = int(round_half_up(_js_min(abs(r), self.width + self.height)))
        y = 0
        err = 1 - x
        while x >= y:
            self.pixel(cx + x, cy + y)
            self.pixel(cx + y, cy + x)
            self.pixel(cx - y, cy + x)
            self.pixel(cx - x, cy + y)
            self.pixel(cx - x, cy - y)
            self.pixel(cx - y, cy - x)
            self.pixel(cx + y, cy - x)
            self.pixel(cx + x, cy - y)
            y += 1
            if err < 0:
                err += 2 * y + 1
            else:
                x -= 1
                err += 2 * (y - x) + 1

    def cell(self, col: int, row: int) -> int:
        """The Braille codepoint for one cell, or 0 when the cell is empty."""
        if col < 0 or row < 0 or col >= self.cols or row >= self.rows:
            return 0
        bits = self._dots[row * self.cols + col]
        return _BRAILLE_BASE | bits if bits else 0

    def to_lines(self) -> list[str]:
        """Rows of Braille text — handy for tests and for the HTML renderer."""
        return [
            "".join(
                " " if (c := self.cell(col, row)) == 0 else chr(c)
                for col in range(self.cols)
            )
            for row in range(self.rows)
        ]
