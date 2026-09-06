"""A clipped, translated view onto the framebuffer.

Widgets only ever see a ``Surface``, so nothing can draw outside the rectangle
it was given.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import NamedTuple

from .buffer import Attrs, FrameBuffer, NO_STYLE, Style
from .color import Color
from .layout import Rect
from .theme import Theme
from .unicode import Align, fit, graphemes, string_width, truncate

__all__ = ["BorderStyle", "BoxOptions", "Surface", "TextOptions"]


class BorderStyle(str, Enum):
    ROUNDED = "rounded"
    SINGLE = "single"
    DOUBLE = "double"
    THICK = "thick"
    DASHED = "dashed"
    ASCII = "ascii"
    NONE = "none"


class BorderChars(NamedTuple):
    tl: str
    tr: str
    bl: str
    br: str
    h: str
    v: str
    ml: str
    mr: str
    mt: str
    mb: str
    cross: str


BORDERS: dict[str, BorderChars] = {
    "rounded": BorderChars("╭", "╮", "╰", "╯", "─", "│", "├", "┤", "┬", "┴", "┼"),
    "single": BorderChars("┌", "┐", "└", "┘", "─", "│", "├", "┤", "┬", "┴", "┼"),
    "double": BorderChars("╔", "╗", "╚", "╝", "═", "║", "╠", "╣", "╦", "╩", "╬"),
    "thick": BorderChars("┏", "┓", "┗", "┛", "━", "┃", "┣", "┫", "┳", "┻", "╋"),
    "dashed": BorderChars("╭", "╮", "╰", "╯", "╌", "╎", "├", "┤", "┬", "┴", "┼"),
    "ascii": BorderChars("+", "+", "+", "+", "-", "|", "+", "+", "+", "+", "+"),
}


@dataclass(frozen=True, slots=True)
class TextOptions:
    """How a run of text is drawn into a surface."""

    fg: Color | None = None
    bg: Color | None = None
    attrs: int | None = None
    align: "Align | str" = Align.LEFT
    ellipsis: bool = True
    """Truncate with an ellipsis instead of clipping mid-word."""
    max_width: int | None = None

    @property
    def style(self) -> Style:
        return Style(self.fg, self.bg, self.attrs)


@dataclass(frozen=True, slots=True)
class BoxOptions:
    """A bordered box: the workhorse behind every panel in the library."""

    bg: Color | None = None
    border: "BorderStyle | str" = BorderStyle.ROUNDED
    border_color: Color | None = None
    title: str = ""
    title_align: "Align | str" = Align.LEFT
    title_color: Color | None = None
    subtitle: str = ""
    """Right-aligned text on the top border, e.g. a value or a hint."""
    subtitle_color: Color | None = None
    fill: bool = True
    """Paint the interior with ``bg`` before drawing."""
    footer: str = ""
    footer_color: Color | None = None


class Surface:
    __slots__ = ("buffer", "rect", "clip", "theme")

    def __init__(
        self, buffer: FrameBuffer, rect: Rect, theme: Theme, clip: Rect | None = None
    ) -> None:
        self.buffer = buffer
        self.rect = rect
        self.clip = rect.intersect(clip) if clip is not None else rect
        self.theme = theme

    @staticmethod
    def root(buffer: FrameBuffer, theme: Theme) -> "Surface":
        """A surface covering a whole framebuffer."""
        return Surface(buffer, Rect(0, 0, buffer.width, buffer.height), theme)

    @property
    def width(self) -> int:
        return self.rect.width

    @property
    def height(self) -> int:
        return self.rect.height

    @property
    def empty(self) -> bool:
        return self.rect.is_empty

    def sub(self, x: int, y: int, width: int, height: int) -> "Surface":
        """A child surface in local coordinates, clipped to this one."""
        abs_rect = Rect(self.rect.x + x, self.rect.y + y, width, height)
        return Surface(self.buffer, abs_rect, self.theme, self.clip)

    def region(self, rect: Rect) -> "Surface":
        """A child surface from an absolute rect, as the layout solver produces."""
        return Surface(self.buffer, rect, self.theme, self.clip)

    def inset(self, padding) -> "Surface":
        return self.region(self.rect.inset(padding))

    def hit_rect(self) -> Rect:
        """Absolute rect of this surface, for hit-testing mouse events."""
        return self.rect

    def _visible(self, ax: int, ay: int) -> bool:
        return self.clip.contains(ax, ay)

    def char(self, x: int, y: int, value: "int | str", style: Style = NO_STYLE) -> None:
        ax, ay = self.rect.x + x, self.rect.y + y
        if not self._visible(ax, ay):
            return
        cp = ord(value[0]) if isinstance(value, str) else value
        self.buffer.set_cell(ax, ay, cp, style)

    def text(self, x: int, y: int, text: str, options: TextOptions = TextOptions()) -> int:
        """Draw text at local (x, y). Returns columns written."""
        ay = self.rect.y + y
        if ay < self.clip.y or ay >= self.clip.y + self.clip.height:
            return 0
        room = max(0, self.width - x)
        limit = room if options.max_width is None else min(options.max_width, room)
        if limit <= 0:
            return 0

        content = text
        if options.ellipsis and string_width(content) > limit:
            content = truncate(content, limit)
        if options.align != Align.LEFT:
            content = fit(content, limit, options.align)

        style = options.style
        cx, written = self.rect.x + x, 0
        for g in graphemes(content):
            if written + g.width > limit:
                break
            if cx >= self.clip.x and cx + g.width <= self.clip.x + self.clip.width:
                self.buffer.set_cell(cx, ay, g.value, style)
            cx += g.width
            written += g.width
        return written

    def text_aligned(
        self, y: int, text: str, align: "Align | str", options: TextOptions = TextOptions()
    ) -> None:
        """Text positioned within the full surface width."""
        padded = fit(truncate(text, self.width), self.width, align)
        from dataclasses import replace

        self.text(0, y, padded, replace(options, align=Align.LEFT))

    def fill(self, style: Style, ch: int = 32) -> None:
        self.fill_rect(0, 0, self.width, self.height, style, ch)

    def fill_rect(self, x: int, y: int, w: int, h: int, style: Style, ch: int = 32) -> None:
        abs_rect = Rect(self.rect.x + x, self.rect.y + y, w, h).intersect(self.clip)
        if abs_rect.is_empty:
            return
        self.buffer.fill_rect(abs_rect.x, abs_rect.y, abs_rect.width, abs_rect.height, ch, style)

    def style_rect(self, x: int, y: int, w: int, h: int, style: Style) -> None:
        abs_rect = Rect(self.rect.x + x, self.rect.y + y, w, h).intersect(self.clip)
        if abs_rect.is_empty:
            return
        self.buffer.style_rect(abs_rect.x, abs_rect.y, abs_rect.width, abs_rect.height, style)

    def hline(self, x: int, y: int, length: int, ch: str = "─", style: Style = NO_STYLE) -> None:
        for i in range(length):
            self.char(x + i, y, ch, style)

    def vline(self, x: int, y: int, length: int, ch: str = "│", style: Style = NO_STYLE) -> None:
        for i in range(length):
            self.char(x, y + i, ch, style)

    def box(self, options: BoxOptions = BoxOptions()) -> "Surface":
        """Draw a bordered box with an optional title, and return the interior.

        Every panel in the library goes through here.
        """
        border = str(options.border.value if isinstance(options.border, BorderStyle) else options.border)
        fg = options.border_color if options.border_color is not None else self.theme.border
        bg = options.bg

        if options.fill and bg is not None:
            self.fill(Style(bg=bg))

        if border == "none":
            return self.inset(0)
        if self.width < 2 or self.height < 1:
            return self.inset(1)

        b = BORDERS[border]
        w, h = self.width, self.height
        border_style = Style(fg=fg, bg=bg)

        self.char(0, 0, b.tl, border_style)
        self.char(w - 1, 0, b.tr, border_style)
        self.hline(1, 0, w - 2, b.h, border_style)
        if h > 1:
            self.char(0, h - 1, b.bl, border_style)
            self.char(w - 1, h - 1, b.br, border_style)
            self.hline(1, h - 1, w - 2, b.h, border_style)
            self.vline(0, 1, h - 2, b.v, border_style)
            self.vline(w - 1, 1, h - 2, b.v, border_style)

        # Measured before the title is drawn: both share the top border row, and
        # the title used to be truncated against the full width and then painted
        # over by the subtitle.
        subtitle = f" {options.subtitle} " if options.subtitle else ""
        subtitle_width = (
            string_width(subtitle) if subtitle and string_width(subtitle) + 4 < w else 0
        )

        if options.title:
            title_color = (
                options.title_color if options.title_color is not None else self.theme.title
            )
            label = f" {options.title} "
            # The title lives in [2, limit). Reserving the width is not enough on
            # its own: right- and centre-aligned titles are positioned from the
            # panel edge, so they would still be drawn over the subtitle — and a
            # wide glyph straddling the boundary bisects it, leaving an orphaned
            # half-character. Both labels carry a space of padding, and those two
            # spaces may share a column, so the region ends one past the subtitle
            # when there is one.
            limit = w - 1 - subtitle_width if subtitle_width > 0 else w - 2
            shown = truncate(label, max(0, limit - 2))
            tw = string_width(shown)
            align = options.title_align
            if align == Align.RIGHT:
                tx = max(2, limit - tw)
            elif align == Align.CENTER:
                tx = max(2, min(limit - tw, (w - tw) // 2))
            else:
                tx = 2
            self.text(tx, 0, shown, TextOptions(fg=title_color, bg=bg, attrs=Attrs.BOLD))

        if subtitle_width > 0:
            color = (
                options.subtitle_color
                if options.subtitle_color is not None
                else self.theme.muted
            )
            self.text(w - 2 - subtitle_width, 0, subtitle, TextOptions(fg=color, bg=bg))

        if options.footer and h > 2:
            foot = f" {options.footer} "
            if string_width(foot) + 4 < w:
                color = (
                    options.footer_color
                    if options.footer_color is not None
                    else self.theme.muted
                )
                self.text(2, h - 1, foot, TextOptions(fg=color, bg=bg))

        return self.sub(1, 1, max(0, w - 2), max(0, h - 2))
