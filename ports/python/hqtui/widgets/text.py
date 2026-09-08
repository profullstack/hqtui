"""Text, badges, label/value pairs, dividers and the function-key bar."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Sequence

from ..buffer import Attrs, Style
from ..color import Color
from ..surface import Surface, TextOptions
from ..theme import elevate
from ..unicode import Align, drop_columns, fit, string_width, truncate, wrap

__all__ = [
    "BadgeOptions",
    "BadgeVariant",
    "DividerOptions",
    "KeyStyle",
    "KeyValueOptions",
    "KeyValueRow",
    "StatusBarOptions",
    "StatusItem",
    "TextStyle",
    "draw_badge",
    "draw_divider",
    "draw_key_values",
    "draw_status_bar",
    "draw_text",
]


@dataclass(frozen=True, slots=True)
class TextStyle:
    fg: Color | None = None
    bg: Color | None = None
    attrs: int | None = None
    align: "Align | str" = Align.LEFT
    wrap: bool = False
    bold: bool = False
    dim: bool = False
    italic: bool = False
    underline: bool = False
    #: First line to show, counted after wrapping.
    #:
    #: After wrapping is the only place this can be correct: the caller does not
    #: know how many lines their text became, and pre-slicing the string means
    #: re-deciding every time the width changes.
    scroll: int = 0
    #: Columns to shift the text left by, for lines wider than the surface.
    scroll_x: int = 0

    @property
    def resolved_attrs(self) -> int:
        a = self.attrs or 0
        if self.bold:
            a |= Attrs.BOLD
        if self.dim:
            a |= Attrs.DIM
        if self.italic:
            a |= Attrs.ITALIC
        if self.underline:
            a |= Attrs.UNDERLINE
        return a


def draw_text(surface: Surface, content: str, options: TextStyle = TextStyle()) -> None:
    if surface.empty:
        return
    style = TextOptions(
        fg=options.fg if options.fg is not None else surface.theme.foreground,
        bg=options.bg,
        attrs=options.resolved_attrs,
    )
    lines = wrap(content, surface.width) if options.wrap else content.split("\n")
    if options.scroll > 0:
        lines = lines[options.scroll :]
    for i, line in enumerate(lines[: surface.height]):
        if options.scroll_x > 0:
            line = drop_columns(line, options.scroll_x)
        surface.text(0, i, fit(truncate(line, surface.width), surface.width, options.align), style)


class BadgeVariant(str, Enum):
    """Filled reads as a chip; outline keeps the panel quiet."""

    FILLED = "filled"
    OUTLINE = "outline"
    SUBTLE = "subtle"


@dataclass(frozen=True, slots=True)
class BadgeOptions:
    text: str = ""
    color: Color | None = None
    variant: "BadgeVariant | str" = BadgeVariant.FILLED
    align: "Align | str" = Align.LEFT


def draw_badge(surface: Surface, options: BadgeOptions) -> int:
    """Returns the width drawn, so callers can advance a cursor past it."""
    if surface.empty:
        return 0
    theme = surface.theme
    color = options.color if options.color is not None else theme.primary
    label = f" {options.text} "

    if options.variant == BadgeVariant.FILLED:
        style = Style(
            fg=theme.background if theme.dark else theme.surface, bg=color, attrs=Attrs.BOLD
        )
    elif options.variant == BadgeVariant.SUBTLE:
        style = Style(fg=color, bg=theme.surface.mix(color, 0.18))
    else:
        style = Style(fg=color, attrs=Attrs.BOLD)

    width = min(string_width(label), surface.width)
    if options.align == Align.RIGHT:
        x = surface.width - width
    elif options.align == Align.CENTER:
        x = (surface.width - width) // 2
    else:
        x = 0
    surface.text(
        max(0, x), 0, truncate(label, surface.width),
        TextOptions(fg=style.fg, bg=style.bg, attrs=style.attrs),
    )
    return width


@dataclass(frozen=True, slots=True)
class KeyValueRow:
    label: str
    value: str
    color: Color | None = None
    label_color: Color | None = None


@dataclass(frozen=True, slots=True)
class KeyValueOptions:
    rows: Sequence[KeyValueRow] = ()
    label_width: int | None = None
    """Columns reserved for labels. None means the widest label."""
    gap: int = 1
    spread: bool = True
    """Push values to the right edge instead of next to the label."""
    label_color: Color | None = None
    value_color: Color | None = None
    background: Color | None = None


def draw_key_values(surface: Surface, options: KeyValueOptions) -> None:
    """Aligned label/value pairs — the backbone of every "System" panel."""
    if surface.empty:
        return
    theme = surface.theme
    label_width = options.label_width
    if label_width is None:
        widest = max((string_width(r.label) for r in options.rows), default=0)
        label_width = min(widest + 1, max(4, int(surface.width * 0.6)))

    for i, row in enumerate(options.rows[: surface.height]):
        label_color = row.label_color or options.label_color or theme.muted
        surface.text(
            0, i, fit(truncate(row.label, label_width), label_width, Align.LEFT),
            TextOptions(fg=label_color, bg=options.background),
        )
        vx = label_width + options.gap
        vw = max(0, surface.width - vx)
        if vw == 0:
            continue
        value = truncate(row.value, vw)
        if options.spread:
            value = fit(value, vw, Align.RIGHT)
        surface.text(
            vx, i, value,
            TextOptions(
                fg=row.color or options.value_color or theme.foreground,
                bg=options.background,
            ),
        )


@dataclass(frozen=True, slots=True)
class DividerOptions:
    label: str = ""
    color: Color | None = None
    char: str = "─"
    align: "Align | str" = Align.LEFT


def draw_divider(surface: Surface, options: DividerOptions = DividerOptions()) -> None:
    if surface.empty:
        return
    theme = surface.theme
    color = options.color if options.color is not None else theme.border
    surface.hline(0, 0, surface.width, options.char, Style(fg=color))
    if options.label:
        text = f" {options.label} "
        w = string_width(text)
        if options.align == Align.RIGHT:
            x = surface.width - w - 1
        elif options.align == Align.CENTER:
            x = (surface.width - w) // 2
        else:
            x = 1
        surface.text(
            max(0, x), 0, truncate(text, surface.width), TextOptions(fg=theme.muted)
        )


@dataclass(frozen=True, slots=True)
class StatusItem:
    label: str = ""
    key: str = ""
    color: Color | None = None
    active: bool = False
    """Highlight this entry, e.g. the active tab or a live indicator."""


class KeyStyle(str, Enum):
    """Caps reverse-videos the key caps, like a function-key bar."""

    CAPS = "caps"
    PLAIN = "plain"


@dataclass(frozen=True, slots=True)
class StatusBarOptions:
    items: Sequence[StatusItem] = ()
    right: Sequence[StatusItem] = ()
    background: Color | None = None
    key_color: Color | None = None
    key_style: "KeyStyle | str" = KeyStyle.CAPS


def draw_status_bar(surface: Surface, options: StatusBarOptions) -> None:
    """The F1/F2/F10 bar along the bottom of every serious TUI."""
    if surface.empty:
        return
    theme = surface.theme
    bg = options.background if options.background is not None else elevate(theme, 0.04)
    surface.fill(Style(bg=bg))
    key_color = options.key_color if options.key_color is not None else theme.accent

    def draw_items(items: Sequence[StatusItem], start_x: int) -> int:
        cx = start_x
        for item in items:
            if cx >= surface.width:
                break
            if item.key:
                if options.key_style == KeyStyle.PLAIN:
                    cap = TextOptions(fg=key_color, bg=bg, attrs=Attrs.BOLD)
                else:
                    cap = TextOptions(
                        fg=theme.background if theme.dark else theme.surface,
                        bg=key_color,
                        attrs=Attrs.BOLD,
                    )
                cx += surface.text(cx, 0, item.key, cap)
                cx += surface.text(cx, 0, " ", TextOptions(bg=bg))
            fg = theme.foreground if item.active else (item.color or theme.muted)
            cx += surface.text(
                cx, 0, item.label,
                TextOptions(fg=fg, bg=bg, attrs=Attrs.BOLD if item.active else 0),
            )
            cx += surface.text(cx, 0, "  ", TextOptions(bg=bg))
        return cx

    x = draw_items(options.items, 1)

    if options.right:
        width = sum(
            string_width(i.label) + (string_width(i.key) + 1 if i.key else 0) + 2
            for i in options.right
        )
        draw_items(options.right, max(x, surface.width - width - 1))
