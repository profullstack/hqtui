"""A theme is flat and small on purpose.

Every token here is one a widget actually reaches for. Anything deeper is
computed, not configured.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field

from .color import Color, Gradient

__all__ = [
    "Theme",
    "THEMES",
    "define_theme",
    "elevate",
    "heat_color",
    "resolve_theme",
    "series_color",
]

_hex = Color.hex


@dataclass(frozen=True, slots=True)
class Theme:
    name: str = "dark"
    dark: bool = True
    """True for palettes designed against a dark terminal background."""

    background: Color = field(default_factory=lambda: _hex(0x05070A))
    surface: Color = field(default_factory=lambda: _hex(0x0A0E14))
    """Panel interiors, lifted slightly off the page."""
    foreground: Color = field(default_factory=lambda: _hex(0xC6D0DB))
    muted: Color = field(default_factory=lambda: _hex(0x5A6B7D))

    primary: Color = field(default_factory=lambda: _hex(0x58A6FF))
    secondary: Color = field(default_factory=lambda: _hex(0xBD93F9))
    accent: Color = field(default_factory=lambda: _hex(0x56D4DD))

    success: Color = field(default_factory=lambda: _hex(0x5FFF87))
    warning: Color = field(default_factory=lambda: _hex(0xFFD75F))
    danger: Color = field(default_factory=lambda: _hex(0xFF6B6B))
    info: Color = field(default_factory=lambda: _hex(0x56D4DD))

    border: Color = field(default_factory=lambda: _hex(0x243040))
    border_focused: Color = field(default_factory=lambda: _hex(0x56D4DD))
    title: Color = field(default_factory=lambda: _hex(0x7EE2FF))

    selection: Color = field(default_factory=lambda: _hex(0x1D3A52))
    selection_text: Color = field(default_factory=lambda: _hex(0xE6F2FF))
    cursor: Color = field(default_factory=lambda: _hex(0x56D4DD))

    graph: tuple[Color, ...] = field(
        default_factory=lambda: (
            _hex(0x58A6FF), _hex(0x5FFF87), _hex(0xFF79C6),
            _hex(0xFFD75F), _hex(0x56D4DD), _hex(0xFFA657),
        )
    )
    """Series colors for multi-line graphs, in draw order."""
    heat: tuple[Color, ...] = field(
        default_factory=lambda: (
            _hex(0x5FFF87), _hex(0xA8FF60), _hex(0xFFD75F),
            _hex(0xFFA657), _hex(0xFF6B6B),
        )
    )
    """Low-to-high ramp for gauges, meters and heat bars."""


def define_theme(base: Theme | None = None, **overrides) -> Theme:
    """Build a theme by overriding a base (dark unless you say otherwise)."""
    start = base if base is not None else Theme()
    if "name" not in overrides:
        overrides["name"] = f"{start.name}-custom"
    return dataclasses.replace(start, **overrides)


def _variant(name: str, **overrides) -> Theme:
    """The reference's ``variant(DARK, {...})``: start from dark and override,
    so anything a palette does not mention is inherited."""
    return dataclasses.replace(Theme(), name=name, **overrides)


DARK = Theme()

DRACULA = _variant(
    "dracula",
    background=_hex(0x191A21), surface=_hex(0x21222C),
    foreground=_hex(0xF8F8F2), muted=_hex(0x6272A4),
    primary=_hex(0xBD93F9), secondary=_hex(0xFF79C6), accent=_hex(0x8BE9FD),
    success=_hex(0x50FA7B), warning=_hex(0xF1FA8C), danger=_hex(0xFF5555), info=_hex(0x8BE9FD),
    border=_hex(0x44475A), border_focused=_hex(0xBD93F9), title=_hex(0xFF79C6),
    selection=_hex(0x44475A), selection_text=_hex(0xF8F8F2),
    graph=(_hex(0xBD93F9), _hex(0x50FA7B), _hex(0xFF79C6), _hex(0xF1FA8C), _hex(0x8BE9FD), _hex(0xFFB86C)),
    heat=(_hex(0x50FA7B), _hex(0xF1FA8C), _hex(0xFFB86C), _hex(0xFF5555)),
)

NORD = _variant(
    "nord",
    background=_hex(0x2E3440), surface=_hex(0x333B4A),
    foreground=_hex(0xE5E9F0), muted=_hex(0x7B88A1),
    primary=_hex(0x88C0D0), secondary=_hex(0xB48EAD), accent=_hex(0x8FBCBB),
    success=_hex(0xA3BE8C), warning=_hex(0xEBCB8B), danger=_hex(0xBF616A), info=_hex(0x81A1C1),
    border=_hex(0x434C5E), border_focused=_hex(0x88C0D0), title=_hex(0x8FBCBB),
    selection=_hex(0x434C5E), selection_text=_hex(0xECEFF4),
    graph=(_hex(0x88C0D0), _hex(0xA3BE8C), _hex(0xB48EAD), _hex(0xEBCB8B), _hex(0x81A1C1), _hex(0xD08770)),
    heat=(_hex(0xA3BE8C), _hex(0xEBCB8B), _hex(0xD08770), _hex(0xBF616A)),
)

TOKYO_NIGHT = _variant(
    "tokyo-night",
    background=_hex(0x1A1B26), surface=_hex(0x1F2335),
    foreground=_hex(0xC0CAF5), muted=_hex(0x565F89),
    primary=_hex(0x7AA2F7), secondary=_hex(0xBB9AF7), accent=_hex(0x7DCFFF),
    success=_hex(0x9ECE6A), warning=_hex(0xE0AF68), danger=_hex(0xF7768E), info=_hex(0x7DCFFF),
    border=_hex(0x2F3549), border_focused=_hex(0x7AA2F7), title=_hex(0x7DCFFF),
    selection=_hex(0x283457), selection_text=_hex(0xC0CAF5),
    graph=(_hex(0x7AA2F7), _hex(0x9ECE6A), _hex(0xBB9AF7), _hex(0xE0AF68), _hex(0x7DCFFF), _hex(0xFF9E64)),
    heat=(_hex(0x9ECE6A), _hex(0xE0AF68), _hex(0xFF9E64), _hex(0xF7768E)),
)

GRUVBOX = _variant(
    "gruvbox",
    background=_hex(0x1D2021), surface=_hex(0x282828),
    foreground=_hex(0xEBDBB2), muted=_hex(0x928374),
    primary=_hex(0x83A598), secondary=_hex(0xD3869B), accent=_hex(0x8EC07C),
    success=_hex(0xB8BB26), warning=_hex(0xFABD2F), danger=_hex(0xFB4934), info=_hex(0x83A598),
    border=_hex(0x3C3836), border_focused=_hex(0xFABD2F), title=_hex(0xFABD2F),
    selection=_hex(0x3C3836), selection_text=_hex(0xFBF1C7),
    graph=(_hex(0x83A598), _hex(0xB8BB26), _hex(0xD3869B), _hex(0xFABD2F), _hex(0x8EC07C), _hex(0xFE8019)),
    heat=(_hex(0xB8BB26), _hex(0xFABD2F), _hex(0xFE8019), _hex(0xFB4934)),
)

MATRIX = _variant(
    "matrix",
    background=_hex(0x000000), surface=_hex(0x020A02),
    foreground=_hex(0x9DFF9D), muted=_hex(0x2F6B2F),
    primary=_hex(0x00FF41), secondary=_hex(0x00C853), accent=_hex(0x7CFF7C),
    success=_hex(0x00FF41), warning=_hex(0xD4FF00), danger=_hex(0xFF3B30), info=_hex(0x00E5B0),
    border=_hex(0x12401F), border_focused=_hex(0x00FF41), title=_hex(0x00FF41),
    selection=_hex(0x0D2F14), selection_text=_hex(0xC9FFC9),
    graph=(_hex(0x00FF41), _hex(0x00C853), _hex(0x7CFF7C), _hex(0x00E5B0), _hex(0xD4FF00), _hex(0x2F9E44)),
    heat=(_hex(0x0F7A2E), _hex(0x00C853), _hex(0x00FF41), _hex(0xD4FF00)),
)

MONOCHROME = _variant(
    "monochrome",
    background=_hex(0x000000), surface=_hex(0x0B0B0B),
    foreground=_hex(0xD0D0D0), muted=_hex(0x6E6E6E),
    primary=_hex(0xFFFFFF), secondary=_hex(0xC0C0C0), accent=_hex(0xE0E0E0),
    success=_hex(0xE8E8E8), warning=_hex(0xB8B8B8), danger=_hex(0xFFFFFF), info=_hex(0xA0A0A0),
    border=_hex(0x3A3A3A), border_focused=_hex(0xD0D0D0), title=_hex(0xFFFFFF),
    selection=_hex(0x303030), selection_text=_hex(0xFFFFFF),
    graph=(_hex(0xFFFFFF), _hex(0xC8C8C8), _hex(0x909090), _hex(0x686868), _hex(0xB0B0B0), _hex(0x808080)),
    heat=(_hex(0x585858), _hex(0x909090), _hex(0xC8C8C8), _hex(0xFFFFFF)),
)

HIGH_CONTRAST = _variant(
    "high-contrast",
    background=_hex(0x000000), surface=_hex(0x000000),
    foreground=_hex(0xFFFFFF), muted=_hex(0xC0C0C0),
    primary=_hex(0x00FFFF), secondary=_hex(0xFF00FF), accent=_hex(0xFFFF00),
    success=_hex(0x00FF00), warning=_hex(0xFFFF00), danger=_hex(0xFF0000), info=_hex(0x00FFFF),
    border=_hex(0xFFFFFF), border_focused=_hex(0xFFFF00), title=_hex(0xFFFFFF),
    selection=_hex(0xFFFFFF), selection_text=_hex(0x000000),
    graph=(_hex(0x00FFFF), _hex(0x00FF00), _hex(0xFF00FF), _hex(0xFFFF00), _hex(0xFFFFFF), _hex(0xFF8000)),
    heat=(_hex(0x00FF00), _hex(0xFFFF00), _hex(0xFF8000), _hex(0xFF0000)),
)

LIGHT = Theme(
    name="light", dark=False,
    background=_hex(0xFBFCFD), surface=_hex(0xFFFFFF),
    foreground=_hex(0x1C2530), muted=_hex(0x6B7A8C),
    primary=_hex(0x0B62D0), secondary=_hex(0x7C3AED), accent=_hex(0x0E7490),
    success=_hex(0x128A3F), warning=_hex(0xA86A00), danger=_hex(0xC62828), info=_hex(0x0E7490),
    border=_hex(0xD3DBE4), border_focused=_hex(0x0B62D0), title=_hex(0x0B3D78),
    selection=_hex(0xD6E6FB), selection_text=_hex(0x0B2545), cursor=_hex(0x0B62D0),
    graph=(_hex(0x0B62D0), _hex(0x128A3F), _hex(0xA3348A), _hex(0xA86A00), _hex(0x0E7490), _hex(0xC2410C)),
    heat=(_hex(0x128A3F), _hex(0x7AA300), _hex(0xA86A00), _hex(0xC2410C), _hex(0xC62828)),
)

THEMES: dict[str, Theme] = {
    "dark": DARK,
    "dracula": DRACULA,
    "nord": NORD,
    "tokyoNight": TOKYO_NIGHT,
    "gruvbox": GRUVBOX,
    "matrix": MATRIX,
    "monochrome": MONOCHROME,
    "highContrast": HIGH_CONTRAST,
    "light": LIGHT,
}
"""Every built-in, keyed as the reference names them. Both ``tokyoNight`` and
``tokyo-night`` reach the same palette through :func:`resolve_theme`."""


def resolve_theme(theme: "Theme | str | None") -> Theme:
    """Look a theme up by key or by its own name.

    Unknown names fall back to dark, because a mistyped theme should not stop an
    app from starting.
    """
    if theme is None:
        return DARK
    if isinstance(theme, Theme):
        return theme
    direct = THEMES.get(theme)
    if direct is not None:
        return direct
    for t in THEMES.values():
        if t.name == theme:
            return t
    return DARK


def elevate(theme: Theme, amount: float = 0.06) -> Color:
    """A slightly lifted or dropped shade of the surface, for zebra rows and
    tracks."""
    return theme.surface.mix(_hex(0xFFFFFF) if theme.dark else _hex(0x000000), amount)


def heat_color(theme: Theme, ratio: float) -> Color:
    """Color a 0-1 ratio along the theme's heat ramp: green when idle, red when
    hot."""
    return Gradient(theme.heat).sample(ratio)


def series_color(theme: Theme, index: int) -> Color:
    """The nth series color, wrapping around. Negative indices wrap from the end."""
    n = len(theme.graph)
    if n == 0:
        from .color import DEFAULT_COLOR

        return DEFAULT_COLOR
    return theme.graph[((index % n) + n) % n]
