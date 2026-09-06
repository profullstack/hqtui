"""Buttons, inputs, tabs and the overlays that sit above a whole screen."""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum
from typing import Sequence

from ..buffer import Attrs, Style
from ..color import Color
from ..surface import BorderStyle, BoxOptions, Surface, TextOptions
from ..theme import elevate
from ..unicode import Align, fit, string_width, truncate, wrap

__all__ = [
    "ButtonOptions",
    "ButtonVariant",
    "CheckboxOptions",
    "CheckboxVariant",
    "CommandPaletteOptions",
    "ModalButton",
    "ModalOptions",
    "PaletteItem",
    "SelectOptions",
    "TabVariant",
    "TabsOptions",
    "TextInputOptions",
    "TooltipOptions",
    "draw_button",
    "draw_checkbox",
    "draw_command_palette",
    "draw_modal",
    "draw_select",
    "draw_tabs",
    "draw_text_input",
    "draw_tooltip",
]


class ButtonVariant(str, Enum):
    PRIMARY = "primary"
    SUCCESS = "success"
    WARNING = "warning"
    DANGER = "danger"
    GHOST = "ghost"


@dataclass(frozen=True, slots=True)
class ButtonOptions:
    label: str = ""
    focused: bool = False
    color: Color | None = None
    variant: "ButtonVariant | str" = ButtonVariant.PRIMARY
    disabled: bool = False
    width: int | None = None
    align: "Align | str" = Align.CENTER


def _variant_color(surface: Surface, options: ButtonOptions) -> Color:
    if options.color is not None:
        return options.color
    t = surface.theme
    return {
        ButtonVariant.SUCCESS: t.success,
        ButtonVariant.WARNING: t.warning,
        ButtonVariant.DANGER: t.danger,
        ButtonVariant.GHOST: t.muted,
    }.get(options.variant, t.primary)


def draw_button(surface: Surface, options: ButtonOptions) -> int:
    """Returns the width drawn."""
    if surface.empty:
        return 0
    theme = surface.theme
    color = _variant_color(surface, options)
    label = f" {options.label} "
    width = min(
        options.width if options.width is not None else string_width(label), surface.width
    )

    if options.disabled:
        style = Style(fg=theme.muted, bg=elevate(theme, 0.05))
    elif options.focused:
        style = Style(
            fg=theme.background if theme.dark else theme.surface, bg=color, attrs=Attrs.BOLD
        )
    elif options.variant == ButtonVariant.GHOST:
        style = Style(fg=color)
    else:
        style = Style(fg=color, bg=theme.surface.mix(color, 0.16), attrs=Attrs.BOLD)

    surface.text(
        0, 0, fit(truncate(label, width), width, options.align),
        TextOptions(fg=style.fg, bg=style.bg, attrs=style.attrs),
    )
    return width


class CheckboxVariant(str, Enum):
    """Render as a box, a switch, or a radio dot."""

    CHECKBOX = "checkbox"
    TOGGLE = "toggle"
    RADIO = "radio"


@dataclass(frozen=True, slots=True)
class CheckboxOptions:
    label: str = ""
    checked: bool = False
    focused: bool = False
    color: Color | None = None
    variant: "CheckboxVariant | str" = CheckboxVariant.CHECKBOX


def draw_checkbox(surface: Surface, options: CheckboxOptions) -> int:
    """Returns the width drawn."""
    if surface.empty:
        return 0
    theme = surface.theme
    color = options.color
    if color is None:
        color = theme.success if options.checked else theme.muted

    if options.variant == CheckboxVariant.TOGGLE:
        glyph = "[▮ ]" if options.checked else "[ ▮]"
    elif options.variant == CheckboxVariant.RADIO:
        glyph = "(●)" if options.checked else "( )"
    else:
        glyph = "[✓]" if options.checked else "[ ]"

    attrs = Attrs.BOLD if options.focused else 0
    x = surface.text(0, 0, glyph, TextOptions(fg=color, attrs=attrs))
    if options.label:
        x += surface.text(
            x, 0, f" {options.label}",
            TextOptions(
                fg=theme.foreground if options.focused else theme.muted, attrs=attrs
            ),
        )
    return x


@dataclass(frozen=True, slots=True)
class SelectOptions:
    value: str = ""
    focused: bool = False
    open: bool = False
    options: Sequence[str] = ()
    selected_index: int = 0
    width: int | None = None
    color: Color | None = None


def draw_select(surface: Surface, options: SelectOptions) -> None:
    """A closed dropdown, or an open one with its option list underneath."""
    if surface.empty:
        return
    theme = surface.theme
    width = min(options.width if options.width is not None else surface.width, surface.width)
    color = options.color
    if color is None:
        color = theme.border_focused if options.focused else theme.border
    field_bg = elevate(theme, 0.05)
    label = " " + truncate(options.value, max(0, width - 4))
    surface.text(
        0, 0, fit(label, max(0, width - 2), Align.LEFT),
        TextOptions(
            fg=theme.foreground, bg=field_bg, attrs=Attrs.BOLD if options.focused else 0
        ),
    )
    surface.text(
        width - 2, 0, " ▴" if options.open else " ▾", TextOptions(fg=color, bg=field_bg)
    )

    if options.open and options.options:
        height = min(len(options.options), max(0, surface.height - 1))
        list_bg = elevate(theme, 0.08)
        for i in range(height):
            selected = i == options.selected_index
            surface.text(
                0, i + 1,
                fit(" " + truncate(options.options[i], max(0, width - 2)), width, Align.LEFT),
                TextOptions(
                    fg=theme.selection_text if selected else theme.foreground,
                    bg=theme.selection if selected else list_bg,
                ),
            )


@dataclass(frozen=True, slots=True)
class TextInputOptions:
    value: str = ""
    placeholder: str = ""
    focused: bool = False
    cursor: int | None = None
    """Caret index; None means the end of the value."""
    width: int | None = None
    label: str = ""
    password: bool = False
    color: Color | None = None


def draw_text_input(surface: Surface, options: TextInputOptions) -> None:
    if surface.empty:
        return
    theme = surface.theme
    width = min(options.width if options.width is not None else surface.width, surface.width)
    label_width = string_width(options.label) + 1 if options.label else 0
    if options.label:
        surface.text(0, 0, options.label, TextOptions(fg=theme.muted))
    field_width = max(0, width - label_width)
    bg = elevate(theme, 0.1 if options.focused else 0.05)
    surface.fill_rect(label_width, 0, field_width, 1, Style(bg=bg))

    # The reference counts UTF-16 units for the password mask and the default
    # caret; counting codepoints is the same for every value a person types and
    # is what a Python caller would expect.
    shown = "•" * len(options.value) if options.password else options.value
    empty = shown == ""
    text = options.placeholder if empty else shown
    surface.text(
        label_width + 1, 0, truncate(text, max(0, field_width - 2)),
        TextOptions(fg=theme.muted if empty else theme.foreground, bg=bg),
    )

    if options.focused:
        caret = options.cursor if options.cursor is not None else string_width(shown)
        cursor_x = min(label_width + 1 + caret, label_width + max(0, field_width - 1))
        surface.style_rect(
            cursor_x, 0, 1, 1,
            Style(
                fg=theme.background,
                bg=options.color if options.color is not None else theme.cursor,
            ),
        )


class TabVariant(str, Enum):
    FILLED = "filled"
    UNDERLINE = "underline"
    """Underline the active tab instead of filling it."""


@dataclass(frozen=True, slots=True)
class TabsOptions:
    tabs: Sequence[str] = ()
    active: int = 0
    color: Color | None = None
    align: "Align | str" = Align.LEFT
    variant: "TabVariant | str" = TabVariant.FILLED


def draw_tabs(surface: Surface, options: TabsOptions) -> None:
    if surface.empty:
        return
    theme = surface.theme
    color = options.color if options.color is not None else theme.accent
    total = sum(string_width(t) + 4 for t in options.tabs)
    if options.align == Align.CENTER:
        x = max(0, (surface.width - total) // 2)
    elif options.align == Align.RIGHT:
        x = max(0, surface.width - total)
    else:
        x = 0

    for i, tab in enumerate(options.tabs):
        label = f"  {tab}  "
        if i == options.active:
            if options.variant == TabVariant.UNDERLINE:
                style = Style(fg=color, attrs=Attrs.BOLD | Attrs.UNDERLINE)
            else:
                style = Style(
                    fg=theme.background if theme.dark else theme.surface,
                    bg=color, attrs=Attrs.BOLD,
                )
        else:
            style = Style(fg=theme.muted)
        x += surface.text(
            x, 0, label, TextOptions(fg=style.fg, bg=style.bg, attrs=style.attrs)
        )


@dataclass(frozen=True, slots=True)
class ModalButton:
    label: str = ""
    variant: "ButtonVariant | str" = ButtonVariant.PRIMARY
    focused: bool = False


@dataclass(frozen=True, slots=True)
class ModalOptions:
    title: str = ""
    message: str = ""
    width: int | None = None
    height: int | None = None
    backdrop: bool = True
    """Dim the screen behind the dialog."""
    buttons: Sequence[ModalButton] = ()
    color: Color | None = None
    align: "Align | str" = Align.CENTER


def draw_modal(root: Surface, options: ModalOptions) -> Surface:
    """Centres a dialog over the whole surface and returns its interior, so
    callers can draw custom content instead of ``message`` if they want to."""
    theme = root.theme
    if options.backdrop:
        # Dim rather than blank: the dashboard stays legible behind the dialog.
        root.style_rect(
            0, 0, root.width, root.height,
            Style(fg=theme.foreground.mix(theme.background, 0.72)),
        )

    width = min(options.width if options.width is not None else 48, max(0, root.width - 2))
    message_lines = len(wrap(options.message, max(0, width - 4))) if options.message else 0
    default_height = message_lines + (5 if options.buttons else 4)
    height = min(
        options.height if options.height is not None else default_height,
        max(0, root.height - 2),
    )
    x = max(0, (root.width - width) // 2)
    y = max(0, (root.height - height) // 2)

    surface = root.sub(x, y, width, height)
    inner = surface.box(
        BoxOptions(
            title=options.title, title_align=options.align, border=BorderStyle.ROUNDED,
            border_color=options.color if options.color is not None else theme.border_focused,
            bg=elevate(theme, 0.08),
        )
    )

    if options.message:
        for i, line in enumerate(wrap(options.message, max(0, inner.width - 2))):
            if i + 1 >= inner.height:
                break
            inner.text(
                1, i + 1, fit(line, max(0, inner.width - 2), options.align),
                TextOptions(fg=theme.foreground),
            )

    if options.buttons:
        widths = [string_width(b.label) + 4 for b in options.buttons]
        total = sum(w + 2 for w in widths) - 2
        bx = max(0, (inner.width - total) // 2)
        by = inner.height - 2
        for i, button in enumerate(options.buttons):
            draw_button(
                inner.sub(bx, by, widths[i], 1),
                ButtonOptions(
                    label=button.label, variant=button.variant,
                    focused=button.focused, width=widths[i],
                ),
            )
            bx += widths[i] + 2

    return inner


@dataclass(frozen=True, slots=True)
class PaletteItem:
    label: str = ""
    hint: str = ""


@dataclass(frozen=True, slots=True)
class CommandPaletteOptions:
    query: str = ""
    items: Sequence[PaletteItem] = ()
    selected: int = 0
    width: int | None = None
    height: int | None = None
    placeholder: str = ""


def draw_command_palette(root: Surface, options: CommandPaletteOptions) -> None:
    """Ctrl+K style palette: a query line above a filtered list."""
    theme = root.theme
    width = min(options.width if options.width is not None else 60, max(0, root.width - 2))
    default_height = min(len(options.items) + 4, 14)
    height = min(
        options.height if options.height is not None else default_height,
        max(0, root.height - 2),
    )
    x = max(0, (root.width - width) // 2)
    y = max(1, root.height // 5)

    root.style_rect(
        0, 0, root.width, root.height,
        Style(fg=theme.foreground.mix(theme.background, 0.7)),
    )
    surface = root.sub(x, y, width, height)
    inner = surface.box(
        BoxOptions(
            border=BorderStyle.ROUNDED, border_color=theme.border_focused,
            bg=elevate(theme, 0.1), title="Command Palette",
        )
    )

    inner.text(0, 0, "› ", TextOptions(fg=theme.accent, attrs=Attrs.BOLD))
    query = options.query or options.placeholder or "Type a command…"
    inner.text(
        2, 0, query,
        TextOptions(fg=theme.foreground if options.query else theme.muted),
    )
    inner.hline(0, 1, inner.width, "─", Style(fg=theme.border))

    for i in range(max(0, inner.height - 2)):
        if i >= len(options.items):
            break
        item = options.items[i]
        selected = i == options.selected
        yy = i + 2
        if selected:
            inner.fill_rect(0, yy, inner.width, 1, Style(bg=theme.selection))
        inner.text(
            1, yy, truncate(item.label, max(0, inner.width - 2)),
            TextOptions(
                fg=theme.selection_text if selected else theme.foreground,
                bg=theme.selection if selected else None,
                attrs=Attrs.BOLD if selected else 0,
            ),
        )
        if item.hint:
            hw = string_width(item.hint)
            if hw + 3 < inner.width:
                inner.text(
                    inner.width - hw - 1, yy, item.hint,
                    TextOptions(
                        fg=theme.muted, bg=theme.selection if selected else None
                    ),
                )


@dataclass(frozen=True, slots=True)
class TooltipOptions:
    text: str = ""
    x: int = 0
    y: int = 0
    color: Color | None = None


def draw_tooltip(root: Surface, options: TooltipOptions) -> None:
    theme = root.theme
    width = min(string_width(options.text) + 4, root.width)
    x = max(0, min(options.x, root.width - width))
    y = max(0, min(options.y, root.height - 3))
    surface = root.sub(x, y, width, 3)
    inner = surface.box(
        BoxOptions(
            border=BorderStyle.ROUNDED,
            border_color=options.color if options.color is not None else theme.border_focused,
            bg=elevate(theme, 0.12),
        )
    )
    inner.text(0, 0, truncate(options.text, inner.width), TextOptions(fg=theme.foreground))
