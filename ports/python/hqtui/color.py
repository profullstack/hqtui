"""Colors packed into a single 32-bit integer so a cell never needs an object.

::

    0                       -> "terminal default"
    0x1000000 | 0xRRGGBB    -> truecolor
    0x2000000 | index       -> explicit 256-colour palette index

A ``Color`` is a plain ``int`` subclass rather than a dataclass: the framebuffer
holds millions of them per second, and an object per cell is exactly what the
reference implementation exists to avoid.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

__all__ = [
    "Color",
    "DEFAULT_COLOR",
    "Gradient",
    "from_256",
    "hex_color",
    "rgb",
    "ansi256",
]

_RGB_FLAG = 0x1000000
_IDX_FLAG = 0x2000000

_CUBE = (0, 95, 135, 175, 215, 255)

_BASE16 = (
    (0, 0, 0), (205, 49, 49), (13, 188, 121), (229, 229, 16),
    (36, 114, 200), (188, 63, 188), (17, 168, 205), (229, 229, 229),
    (102, 102, 102), (241, 76, 76), (35, 209, 139), (245, 245, 67),
    (59, 142, 234), (214, 112, 214), (41, 184, 219), (255, 255, 255),
)


def round_half_up(value: float) -> float:
    """JavaScript's ``Math.round``.

    It rounds half *up*, including for negatives, where Python's ``round`` uses
    banker's rounding. Every quantization here has to agree with the reference
    cell for cell, so the tie-break is spelled out rather than inherited.

    NaN and the infinities pass through, as they do in JavaScript. Python's
    ``math.floor`` raises on them, and this function is reached from the
    drawing paths, where the reference's answer is "draw nothing" rather than
    "crash the app".
    """
    if value != value or math.isinf(value):
        return value
    return math.floor(value + 0.5)


class Color(int):
    """A packed terminal color. Arithmetic on it is meaningless; use the methods."""

    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        if self == 0:
            return "Color.DEFAULT"
        if self & _IDX_FLAG:
            return f"Color.ansi256({self & 255})"
        return f"Color.hex(0x{self & 0xFFFFFF:06x})"

    # ------------------------------------------------------------ construction

    @staticmethod
    def rgb(r: int, g: int, b: int) -> "Color":
        """Truecolor from 0-255 components. Values outside the range wrap, as
        the reference's ``& 255`` does."""
        return Color(_RGB_FLAG | (r & 255) << 16 | (g & 255) << 8 | (b & 255))

    @staticmethod
    def hex(value: "str | int") -> "Color":
        """``Color.hex("#00d7ff")``, ``Color.hex("#0df")`` or ``Color.hex(0x00d7ff)``.

        Anything unparseable becomes black rather than an error: a color is
        cosmetic, and a theme that fails to load is worse than one that is wrong.
        """
        if isinstance(value, int):
            return Color(_RGB_FLAG | (value & 0xFFFFFF))
        s = value.strip().lstrip("#")
        if len(s) == 3:
            s = s[0] * 2 + s[1] * 2 + s[2] * 2
        try:
            n = int(s, 16)
        except ValueError:
            n = 0
        return Color(_RGB_FLAG | (n & 0xFFFFFF))

    @staticmethod
    def ansi256(index: int) -> "Color":
        """An explicit xterm-256 palette entry. Rarely needed; truecolor is
        quantized for you when the terminal cannot do better."""
        return Color(_IDX_FLAG | (index & 255))

    # -------------------------------------------------------------- inspection

    @property
    def is_default(self) -> bool:
        return self == 0

    @property
    def _indexed(self) -> bool:
        return bool(self & _IDX_FLAG)

    @property
    def r(self) -> int:
        return (self >> 16) & 255

    @property
    def g(self) -> int:
        return (self >> 8) & 255

    @property
    def b(self) -> int:
        return self & 255

    # ----------------------------------------------------------------- blending

    def mix(self, other: "Color", t: float) -> "Color":
        """Blend towards ``other``. ``t`` of 0 returns self, 1 returns other.

        Software alpha — terminals have none.
        """
        if self.is_default or other.is_default:
            return self if t < 0.5 else other
        k = 0.0 if not t > 0 else (1.0 if t > 1 else t)
        return Color.rgb(
            int(round_half_up(self.r + (other.r - self.r) * k)),
            int(round_half_up(self.g + (other.g - self.g) * k)),
            int(round_half_up(self.b + (other.b - self.b) * k)),
        )

    def alpha(self, background: "Color", a: float) -> "Color":
        """Blend over a background at ``a`` (0-1), for subtle fills and shadows."""
        return background.mix(self, a)

    def lighten(self, amount: float = 0.2) -> "Color":
        return self.mix(Color.rgb(255, 255, 255), amount)

    def darken(self, amount: float = 0.2) -> "Color":
        return self.mix(Color.rgb(0, 0, 0), amount)

    def luminance(self) -> float:
        """Relative luminance, 0-1."""

        def channel(v: int) -> float:
            x = v / 255
            return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4

        return 0.2126 * channel(self.r) + 0.7152 * channel(self.g) + 0.0722 * channel(self.b)

    def contrast(self, other: "Color") -> float:
        """WCAG contrast ratio against another color (1-21)."""
        a, b = self.luminance(), other.luminance()
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)

    def grayscale(self) -> "Color":
        """Desaturate towards grey — this powers monochrome mode."""
        if self.is_default:
            return self
        v = int(round_half_up(0.299 * self.r + 0.587 * self.g + 0.114 * self.b))
        return Color.rgb(v, v, v)

    # -------------------------------------------------------------- quantizing

    def to_256(self) -> int:
        """Quantize to the xterm-256 palette, for terminals without truecolor."""
        if self._indexed:
            return self & 255
        r, g, b = self.r, self.g, self.b
        # The grey ramp often beats the cube for desaturated colors.
        if abs(r - g) < 8 and abs(g - b) < 8:
            if r < 8:
                return 16
            if r > 248:
                return 231
            return 232 + int(round_half_up((r - 8) / 247 * 24))
        return 16 + 36 * _nearest_cube(r) + 6 * _nearest_cube(g) + _nearest_cube(b)

    def to_16(self) -> int:
        """Quantize to the 16-color palette, for last-resort terminals."""
        if self._indexed:
            i = self & 255
            return i if i < 16 else from_256(i).to_16()
        r, g, b = self.r, self.g, self.b
        best, best_d = 7, None
        for i, (br, bg, bb) in enumerate(_BASE16):
            d = (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2
            if best_d is None or d < best_d:
                best, best_d = i, d
        return best


DEFAULT_COLOR = Color(0)
"""The terminal's own foreground/background. Never emitted as an SGR color."""

# Module-level aliases, so callers can write `rgb(1, 2, 3)` as the reference does.
rgb = Color.rgb
hex_color = Color.hex
ansi256 = Color.ansi256


def _nearest_cube(v: int) -> int:
    best, best_d = 0, None
    for i, c in enumerate(_CUBE):
        d = abs(c - v)
        if best_d is None or d < best_d:
            best, best_d = i, d
    return best


def from_256(index: int) -> Color:
    """Convert a 256-palette index back to truecolor."""
    i = index & 255
    if i < 16:
        r, g, b = _BASE16[i]
        return Color.rgb(r, g, b)
    if i >= 232:
        v = 8 + (i - 232) * 10
        return Color.rgb(v, v, v)
    n = i - 16
    return Color.rgb(_CUBE[(n // 36) % 6], _CUBE[(n // 6) % 6], _CUBE[n % 6])


class Gradient:
    """A multi-stop color ramp.

    ::

        heat = Gradient([Color.hex("#00d7ff"), Color.hex("#ff5f5f")])
        warm = heat.sample(0.75)
    """

    __slots__ = ("stops",)

    def __init__(self, stops: Iterable[Color] = ()) -> None:
        self.stops: Sequence[Color] = tuple(stops)

    def sample(self, t: float) -> Color:
        n = len(self.stops)
        if n == 0:
            return DEFAULT_COLOR
        if n == 1:
            return self.stops[0]
        # Ordered so NaN falls through to 0 rather than indexing wild.
        k = 1.0 if t > 1 else (t if t > 0 else 0.0)
        pos = k * (n - 1)
        i = min(int(math.floor(pos)), n - 2)
        return self.stops[i].mix(self.stops[i + 1], pos - i)

    def steps(self, n: int) -> list[Color]:
        """Sample ``n`` evenly spaced colors."""
        return [self.sample(0.0 if n == 1 else i / (n - 1)) for i in range(n)]
