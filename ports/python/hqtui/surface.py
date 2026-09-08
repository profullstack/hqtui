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


# Edge bits for a border glyph: 1 up, 2 right, 4 down, 8 left.
#
# Collapsing two panel borders is the union of their edges. A panel's top-right
# corner (down + left) landing on its neighbour's top-left (down + right) is
# down + left + right, which is the T that makes the two read as one frame.
EDGE_UP = 1
EDGE_RIGHT = 2
EDGE_DOWN = 4
EDGE_LEFT = 8

# The edges each part of a border carries, in field order.
_PART_BITS = (
    EDGE_RIGHT | EDGE_DOWN,                     # tl
    EDGE_LEFT | EDGE_DOWN,                      # tr
    EDGE_UP | EDGE_RIGHT,                       # bl
    EDGE_UP | EDGE_LEFT,                        # br
    EDGE_LEFT | EDGE_RIGHT,                     # h
    EDGE_UP | EDGE_DOWN,                        # v
    EDGE_UP | EDGE_DOWN | EDGE_RIGHT,           # ml
    EDGE_UP | EDGE_DOWN | EDGE_LEFT,            # mr
    EDGE_LEFT | EDGE_RIGHT | EDGE_DOWN,         # mt
    EDGE_LEFT | EDGE_RIGHT | EDGE_UP,           # mb
    EDGE_UP | EDGE_RIGHT | EDGE_DOWN | EDGE_LEFT,  # cross
)

# Every border glyph in every style, to its edges. ASCII borders collide (every
# corner is "+") and the first entry wins, which is right: the union of anything
# with a "+" is a "+".
_BITS_BY_CHAR: dict[str, int] = {}
for _chars in BORDERS.values():
    for _i, _part in enumerate(
        (_chars.tl, _chars.tr, _chars.bl, _chars.br, _chars.h, _chars.v,
         _chars.ml, _chars.mr, _chars.mt, _chars.mb, _chars.cross)
    ):
        _BITS_BY_CHAR.setdefault(_part, _PART_BITS[_i])


def border_bits(ch: str) -> int | None:
    """The edges of a border glyph, or None when it is not one."""
    return _BITS_BY_CHAR.get(ch)


def border_glyph(style: str, bits: int) -> str | None:
    """The glyph in ``style`` with exactly these edges, or None."""
    chars = BORDERS.get(style)
    if chars is None:
        return None
    parts = (chars.tl, chars.tr, chars.bl, chars.br, chars.h, chars.v,
             chars.ml, chars.mr, chars.mt, chars.mb, chars.cross)
    for i, value in enumerate(_PART_BITS):
        if value == bits:
            return parts[i]
    return None


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
    collapse: bool = False
    #: Which edges to draw: None for all four, "none" for no rule, or a
    #: sequence of "top"/"right"/"bottom"/"left". The interior follows the
    #: sides actually drawn, so a top-only box costs one row rather than two.
    sides: object = None
    """Merge this border with one already in the same cell rather than
    overwriting it. Set for you by the container when the app asks for
    collapsed borders; there is no reason to pass it by hand."""


#: Which edges of a box to draw. ``None`` means all four, which is what a box
#: was before this existed; an empty tuple draws no rule and insets nothing,
#: the same as a border style of "none".
SIDES = ("top", "right", "bottom", "left")


def resolve_sides(sides) -> dict:
    """Turn whatever the caller gave into four flags."""
    if sides is None or sides == "all":
        return {name: True for name in SIDES}
    if sides == "none":
        return {name: False for name in SIDES}
    chosen = set(sides)
    return {name: name in chosen for name in SIDES}


def side_glyph(border: str, bits: int) -> "str | None":
    """The glyph for a cell where two edges meet, given which are drawn.

    A single edge has no glyph of its own, so the plain rule stands in: that
    cell is part of a run, not a corner.
    """
    if not bits:
        return None
    glyph = border_glyph(border, bits)
    if glyph is not None:
        return glyph
    chars = BORDERS[border]
    return chars.h if bits & (EDGE_LEFT | EDGE_RIGHT) else chars.v


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

    def _merge_border(self, x: int, y: int, ch: str, style: str, cell_style: Style) -> None:
        """Write a border glyph, merging it with whatever border is already there.

        Only border glyphs merge. Anything else in the cell is overwritten,
        which keeps a panel drawn over a chart looking like a panel rather than
        growing junctions out of the data.
        """
        ax, ay = self.rect.x + x, self.rect.y + y
        if not self._visible(ax, ay):
            return
        existing = chr(self.buffer.chars[self.buffer.index(ax, ay)])
        before = border_bits(existing)
        after = border_bits(ch)
        if before is not None and after is not None and before != after:
            ch = border_glyph(style, before | after) or ch
        self.char(x, y, ch, cell_style)

    def box(self, options: BoxOptions = BoxOptions()) -> "Surface":  # noqa: C901
        """Draw a bordered box with an optional title, and return the interior.

        Every panel in the library goes through here.
        """
        border = str(options.border.value if isinstance(options.border, BorderStyle) else options.border)
        fg = options.border_color if options.border_color is not None else self.theme.border
        bg = options.bg

        if options.fill and bg is not None:
            self.fill(Style(bg=bg))

        sides = resolve_sides(options.sides)
        if border == "none" or not any(sides.values()):
            return self.inset(0)
        if self.width < 2 or self.height < 1:
            return self.inset(1)

        b = BORDERS[border]
        w, h = self.width, self.height
        border_style = Style(fg=fg, bg=bg)

        # With collapsing on, a border glyph landing on another one becomes the
        # union of the two. Without it this is a plain write, so a screen that
        # never asks for collapsing renders byte for byte as it did.
        def put(x: int, y: int, ch: str) -> None:
            if options.collapse:
                self._merge_border(x, y, ch, border, border_style)
            else:
                self.char(x, y, ch, border_style)

        def put_h(x: int, y: int, length: int, ch: str) -> None:
            for i in range(length):
                put(x + i, y, ch)

        def put_v(x: int, y: int, length: int, ch: str) -> None:
            for i in range(length):
                put(x, y + i, ch)

        # A corner belongs to the two sides that meet there, so it exists only
        # when both are drawn; where one is, the rule runs straight through the
        # cell the corner would have occupied.
        def corner(a: bool, a_bit: int, c: bool, c_bit: int) -> "str | None":
            return side_glyph(border, (a_bit if a else 0) | (c_bit if c else 0))

        if sides["top"]:
            put_h(1, 0, w - 2, b.h)
        tl = corner(sides["top"], EDGE_RIGHT, sides["left"], EDGE_DOWN)
        tr = corner(sides["top"], EDGE_LEFT, sides["right"], EDGE_DOWN)
        if tl is not None:
            put(0, 0, tl)
        if tr is not None:
            put(w - 1, 0, tr)
        if h > 1:
            bl = corner(sides["bottom"], EDGE_RIGHT, sides["left"], EDGE_UP)
            br = corner(sides["bottom"], EDGE_LEFT, sides["right"], EDGE_UP)
            if sides["bottom"]:
                put_h(1, h - 1, w - 2, b.h)
            if bl is not None:
                put(0, h - 1, bl)
            if br is not None:
                put(w - 1, h - 1, br)
            if sides["left"]:
                put_v(0, 1, h - 2, b.v)
            if sides["right"]:
                put_v(w - 1, 1, h - 2, b.v)

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

        # The interior follows the sides actually drawn.
        left = 1 if sides["left"] else 0
        top = 1 if sides["top"] else 0
        shrink_x = left + (1 if sides["right"] else 0)
        shrink_y = top + (1 if sides["bottom"] else 0)
        return self.sub(left, top, max(0, w - shrink_x), max(0, h - shrink_y))
