"""Render a view to an in-memory screen.

No TTY, no escape codes, no timers — which is what makes TUI code written with
this library actually testable.

::

    screen = render_to_screen(80, 24, lambda ui: ui.panel(
        Panel(title="CPU"), lambda p: p.text("72%")))
    assert screen.contains("72%")
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Callable, NamedTuple

from .buffer import Attrs, FrameBuffer
from .capabilities import Capabilities, CapabilityOverrides, ColorDepth, detect_capabilities
from .color import Color, DEFAULT_COLOR
from .diff import Encoder
from .layout import Direction
from .surface import Surface
from .theme import Theme, resolve_theme
from .ui import Container, HitRegion, RenderContext
from .unicode import CONTINUATION, cell_text

__all__ = [
    "CellSnapshot",
    "HtmlOptions",
    "RenderedScreen",
    "render_to_ansi",
    "render_to_html",
    "render_to_screen",
    "render_to_text",
]


class CellSnapshot(NamedTuple):
    char: str
    fg: Color
    bg: Color
    attrs: int


@dataclass(slots=True)
class RenderedScreen:
    width: int
    height: int
    buffer: FrameBuffer
    theme: Theme
    regions: list[HitRegion]
    """Mouse regions the view registered, in draw order.

    They let a test assert that a widget is actually reachable by the wheel or a
    click, which is otherwise only observable by running a real terminal.
    """
    focus_count: int
    """How many controls joined the Tab order."""

    def text(self) -> str:
        """Plain text, one line per row, trailing spaces trimmed."""
        return self.buffer.to_text()

    def line(self, y: int) -> str:
        """One row of plain text."""
        from .unicode import _trim_end

        return _trim_end(self.buffer.row_text(y))

    def ansi(self) -> str:
        """Everything with colors — paste into a terminal to see it."""
        empty = FrameBuffer(self.width, self.height)
        return Encoder(ColorDepth.TRUECOLOR).encode(empty, self.buffer, True).output

    def cell(self, x: int, y: int) -> CellSnapshot:
        i = self.buffer.index(x, y)
        value = self.buffer.chars[i]
        char = "" if value == CONTINUATION else (" " if value == 0 else cell_text(value))
        return CellSnapshot(
            char, Color(self.buffer.fg[i]), Color(self.buffer.bg[i]), self.buffer.attrs[i]
        )

    def find(self, needle: str) -> tuple[int, int] | None:
        """Column and row of the first occurrence, or None.

        The column counts cells, not characters — a row with a wide glyph in it
        has more characters than columns to its left.
        """
        for y in range(self.height):
            row = self.buffer.row_text(y)
            at = row.find(needle)
            if at != -1:
                from .unicode import string_width

                return string_width(row[:at]), y
        return None

    def contains(self, needle: str) -> bool:
        return self.find(needle) is not None


def render_to_screen(
    width: int = 80,
    height: int = 24,
    theme: "Theme | str | None" = None,
    view: Callable[[Container], None] | None = None,
    *,
    frame: int = 0,
    capabilities: CapabilityOverrides | None = None,
) -> RenderedScreen:
    """Render a view to an in-memory screen."""
    resolved = resolve_theme(theme)
    buffer = FrameBuffer(width, height)
    buffer.clear(resolved.background, resolved.foreground)

    ctx = RenderContext(
        theme=resolved,
        capabilities=_headless_capabilities(capabilities),
        width=width,
        height=height,
        frame=frame,
    )

    root = Surface.root(buffer, resolved)
    container = Container(root, ctx, Direction.COLUMN)
    if view is not None:
        view(container)
    container.flush()
    for overlay in ctx.overlays:
        overlay(root)

    return RenderedScreen(
        width=width, height=height, buffer=buffer, theme=resolved,
        regions=ctx.hits, focus_count=ctx.focus_cursor,
    )


def _headless_capabilities(overrides: CapabilityOverrides | None) -> Capabilities:
    """A headless render should look like a capable terminal, not like whatever
    is running the test suite — otherwise a plot silently degrades to ASCII in
    CI."""
    o = overrides or CapabilityOverrides()
    merged = replace(
        o,
        tty=True if o.tty is None else o.tty,
        colors=ColorDepth.TRUECOLOR if o.colors is None else o.colors,
        unicode=True if o.unicode is None else o.unicode,
        braille=True if o.braille is None else o.braille,
    )
    return detect_capabilities(merged, env={}, is_tty=True)


def render_to_text(
    width: int = 80, height: int = 24, theme: "Theme | str | None" = None,
    view: Callable[[Container], None] | None = None,
) -> str:
    """Shorthand: render and return plain text. Ideal for snapshot tests."""
    return render_to_screen(width, height, theme, view).text()


def render_to_ansi(
    width: int = 80, height: int = 24, theme: "Theme | str | None" = None,
    view: Callable[[Container], None] | None = None,
) -> str:
    """Render with ANSI colors, e.g. to write a demo screenshot to a file."""
    return render_to_screen(width, height, theme, view).ansi()


_HTML_ESCAPES = str.maketrans({"&": "&amp;", "<": "&lt;", ">": "&gt;"})
_ATTR_ESCAPES = str.maketrans(
    {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}
)

_FONT_SAFE = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ,._'-"
)


def _css_color(color: Color, fallback: str) -> str:
    if color == DEFAULT_COLOR:
        return fallback
    return f"#{color & 0xFFFFFF:06x}"


@dataclass(slots=True)
class HtmlOptions:
    font_size: float = 14.0
    padding: float = 16.0
    class_name: str = "hqtui-screen"
    font_family: str = (
        "ui-monospace,SFMono-Regular,Menlo,'DejaVu Sans Mono',"
        "'Liberation Mono',Consolas,'Segoe UI Symbol',monospace"
    )
    """The default stack is ordered by box-drawing and Braille coverage."""


def render_to_html(screen: RenderedScreen, options: HtmlOptions | None = None) -> str:
    """Render to standalone HTML — a real screenshot of the UI, no terminal."""
    o = options or HtmlOptions()
    theme = screen.theme
    bg_fallback = _css_color(theme.background, "#000")
    fg_fallback = _css_color(theme.foreground, "#fff")
    buffer = screen.buffer
    rows: list[str] = []

    for y in range(screen.height):
        row: list[str] = []
        run: list[str] = []
        run_fg = run_bg = run_attrs = None

        def flush() -> None:
            if not run:
                return
            style = (
                f"color:{_css_color(Color(run_fg or 0), fg_fallback)};"
                f"background:{_css_color(Color(run_bg or 0), bg_fallback)}"
            )
            attrs = run_attrs or 0
            if attrs & Attrs.BOLD:
                style += ";font-weight:700"
            if attrs & Attrs.DIM:
                style += ";opacity:.65"
            if attrs & Attrs.ITALIC:
                style += ";font-style:italic"
            if attrs & Attrs.UNDERLINE:
                style += ";text-decoration:underline"
            row.append(f'<span style="{style}">{"".join(run).translate(_HTML_ESCAPES)}</span>')
            run.clear()

        for x in range(screen.width):
            i = buffer.index(x, y)
            if buffer.chars[i] == CONTINUATION:
                continue
            fg, bg, attrs = buffer.fg[i], buffer.bg[i], buffer.attrs[i]
            if (fg, bg, attrs) != (run_fg, run_bg, run_attrs):
                flush()
                run_fg, run_bg, run_attrs = fg, bg, attrs
            run.append(" " if buffer.chars[i] == 0 else cell_text(buffer.chars[i]))
        flush()
        rows.append("".join(row))

    # Every one of these is spliced into an attribute, so none may be trusted to
    # be the type the signature claims. Numbers are bounded, and a font stack is
    # reduced to the characters a font stack can legitimately contain — escaping
    # alone still lets `;` open a new CSS property.
    def number(value: float, fallback: float) -> float:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return fallback
        return v if 0 < v <= 1000 else fallback

    font_size = number(o.font_size, 14.0)
    padding = number(o.padding, 16.0)
    font = "".join(c for c in str(o.font_family) if c in _FONT_SAFE)

    # One <pre> with newline-separated rows: wrapping each row in its own element
    # gives the browser licence to lay out lines independently, which pulls
    # box-drawing rules apart. A single text flow tiles the grid exactly.
    return (
        f'<pre class="{o.class_name.translate(_ATTR_ESCAPES)}" '
        f'style="background:{bg_fallback};color:{fg_fallback};'
        f"padding:{padding:g}px;font-size:{font_size:g}px;"
        f"line-height:{font_size * 1.18:.2f}px;font-family:{font.translate(_ATTR_ESCAPES)};"
        f"margin:0;overflow-x:auto;border-radius:8px;white-space:pre;"
        f'font-variant-ligatures:none;-webkit-font-smoothing:antialiased">'
        + "\n".join(rows)
        + "</pre>"
    )
