"""Dense data widgets: tables, lists, trees, tailing logs and the scrollbar
they share.

The reference implementation is generic over a row type and reads cells with a
key or a ``render`` callback. Python takes the cells already stringified —
``TableRow(("1", "systemd", "0.1"))`` — which keeps the widget out of the
business of formatting someone else's objects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping, Sequence

from ..buffer import Attrs, Style
from ..color import Color, round_half_up
from ..layout import Constraint, solve
from ..surface import Surface, TextOptions
from ..theme import elevate
from ..unicode import Align, fit, string_width, truncate

__all__ = [
    "ListItem",
    "ListOptions",
    "LogEntry",
    "LogOptions",
    "TableColumn",
    "TableOptions",
    "TableRow",
    "TreeNode",
    "TreeOptions",
    "TreeValue",
    "draw_list",
    "draw_log",
    "draw_scrollbar",
    "draw_table",
    "draw_tree",
    "resolve_offset",
]


@dataclass(frozen=True, slots=True)
class TableColumn:
    title: str = ""
    width: "int | str | None" = None
    min: int | None = None
    max: int | None = None
    align: "Align | str" = Align.LEFT
    color: Color | None = None


@dataclass(frozen=True, slots=True)
class TableRow:
    cells: Sequence[str] = ()
    color: Color | None = None
    """Colors the whole row, unless the column or the cell says otherwise."""
    cell_colors: Sequence[Color | None] = ()
    """Per-cell colors, standing in for the reference's per-column color
    function. Where an entry exists for a column it wins outright, including
    when it is ``None`` — which is what that callback returning ``undefined``
    does there."""


@dataclass(frozen=True, slots=True)
class TableOptions:
    rows: Sequence[TableRow] = ()
    columns: Sequence[TableColumn] = ()
    header: bool = True
    header_color: Color | None = None
    selected: int | None = None
    """Index of the highlighted row."""
    offset: int | None = None
    """First visible row; combine with ``selected`` for scrolling lists."""
    follow_selection: bool = False
    """Scroll so ``selected`` stays visible. Only the table knows how many rows
    fit, so working the offset out here saves every caller from tracking
    heights."""
    zebra: bool = False
    gap: int = 1
    background: Color | None = None
    scrollbar: bool = False
    """Show a scrollbar in the last column when rows overflow."""


def resolve_offset(
    offset: int | None, selected: int | None, capacity: int, total: int, follow: bool = False
) -> int:
    """Where the visible window should start: the caller's offset, nudged just
    far enough to keep the selected row on screen, and clamped to the list."""
    max_offset = max(0, total - capacity)
    start = max(0, min(offset or 0, max_offset))
    if follow and selected is not None and capacity > 0:
        if selected < start:
            start = selected
        elif selected >= start + capacity:
            start = selected - capacity + 1
    return max(0, min(start, max_offset))


def draw_table(surface: Surface, options: TableOptions) -> None:
    """A dense, column-aligned table with optional selection and scrollbar."""
    if surface.empty:
        return
    theme = surface.theme
    gap = options.gap
    header_rows = 1 if options.header else 0
    body_width = surface.width - (1 if options.scrollbar else 0)

    constraints: list[Constraint] = []
    for ci, c in enumerate(options.columns):
        intrinsic = 0
        if c.width is None:
            # The reference samples the first 200 rows, which is what keeps an
            # auto column cheap on a long table.
            widest = max(
                (
                    string_width(r.cells[ci]) if ci < len(r.cells) else 0
                    for r in options.rows[:200]
                ),
                default=0,
            )
            intrinsic = max(string_width(c.title), widest)
        constraints.append(
            Constraint(
                size=c.width if c.width is not None else "auto",
                min=c.min if c.min is not None else 1,
                max=c.max,
                intrinsic=intrinsic,
            )
        )
    widths = solve(body_width, constraints, gap)

    if options.header:
        header_color = (
            options.header_color if options.header_color is not None else theme.muted
        )
        x = 0
        for i, column in enumerate(options.columns):
            w = widths[i]
            if w <= 0:
                continue
            surface.text(
                x, 0, fit(truncate(column.title, w), w, column.align),
                TextOptions(fg=header_color, bg=options.background, attrs=Attrs.BOLD),
            )
            x += w + gap

    capacity = max(0, surface.height - header_rows)
    offset = resolve_offset(
        options.offset, options.selected, capacity, len(options.rows), options.follow_selection
    )
    zebra_bg = elevate(theme, 0.04) if options.zebra else None

    for i in range(capacity):
        row_index = offset + i
        if row_index >= len(options.rows):
            break
        row = options.rows[row_index]
        y = i + header_rows
        selected = options.selected == row_index

        if selected:
            row_bg = theme.selection
        elif options.zebra and row_index % 2 == 1:
            row_bg = zebra_bg
        else:
            row_bg = options.background
        if row_bg is not None:
            surface.fill_rect(0, y, body_width, 1, Style(bg=row_bg))

        x = 0
        for ci, column in enumerate(options.columns):
            w = widths[ci]
            if w <= 0:
                continue
            text = row.cells[ci] if ci < len(row.cells) else ""
            if selected:
                fg = theme.selection_text
            elif ci < len(row.cell_colors):
                fg = row.cell_colors[ci]
            elif column.color is not None:
                fg = column.color
            else:
                fg = row.color
            surface.text(
                x, y, fit(truncate(text, w), w, column.align),
                TextOptions(
                    fg=fg if fg is not None else theme.foreground,
                    bg=row_bg,
                    attrs=Attrs.BOLD if selected else 0,
                ),
            )
            x += w + gap

    if options.scrollbar and len(options.rows) > capacity and capacity > 0:
        draw_scrollbar(
            surface, surface.width - 1, header_rows, capacity, len(options.rows), offset
        )


def draw_scrollbar(
    surface: Surface, x: int, y: int, height: int, total: int, offset: int
) -> None:
    """A one-column scrollbar. Thumb size reflects the visible fraction."""
    theme = surface.theme
    track = theme.background.mix(theme.border, 0.7)
    thumb_size = max(1, int(round_half_up(height / total * height)))
    max_offset = max(1, total - height)
    thumb_pos = int(round_half_up(offset / max_offset * (height - thumb_size)))
    for i in range(height):
        in_thumb = thumb_pos <= i < thumb_pos + thumb_size
        surface.char(
            x, y + i, "█" if in_thumb else "│",
            Style(fg=theme.accent if in_thumb else track),
        )


@dataclass(frozen=True, slots=True)
class ListItem:
    label: str = ""
    color: Color | None = None
    badge: str = ""


@dataclass(frozen=True, slots=True)
class ListOptions:
    items: Sequence["ListItem | str"] = ()
    selected: int | None = None
    offset: int | None = None
    follow_selection: bool = False
    background: Color | None = None
    bullet: str = ""
    scrollbar: bool = False


def draw_list(surface: Surface, options: ListOptions) -> None:
    if surface.empty:
        return
    theme = surface.theme
    width = surface.width - (1 if options.scrollbar else 0)
    offset = resolve_offset(
        options.offset, options.selected, surface.height, len(options.items),
        options.follow_selection,
    )
    for i in range(surface.height):
        index = offset + i
        if index >= len(options.items):
            break
        raw = options.items[index]
        item = ListItem(label=raw) if isinstance(raw, str) else raw
        selected = options.selected == index
        bullet = f"{options.bullet} " if options.bullet else ""
        if selected:
            surface.fill_rect(0, i, width, 1, Style(bg=theme.selection))
        surface.text(
            0, i, fit(truncate(bullet + item.label, width), width, Align.LEFT),
            TextOptions(
                fg=theme.selection_text if selected else (item.color or theme.foreground),
                bg=theme.selection if selected else options.background,
                attrs=Attrs.BOLD if selected else 0,
            ),
        )
    if options.scrollbar and len(options.items) > surface.height:
        draw_scrollbar(
            surface, surface.width - 1, 0, surface.height, len(options.items), offset
        )


@dataclass(frozen=True, slots=True)
class TreeValue:
    text: str = ""
    width: int = 0
    color: Color | None = None
    align: "Align | str" = Align.RIGHT


@dataclass(frozen=True, slots=True)
class TreeNode:
    label: str = ""
    color: Color | None = None
    values: Sequence[TreeValue] = ()
    """Right-aligned columns, e.g. CPU% and MEM% in a process tree."""
    children: Sequence["TreeNode"] = ()
    expanded: bool = True


@dataclass(frozen=True, slots=True)
class TreeOptions:
    nodes: Sequence[TreeNode] = ()
    selected: int | None = None
    offset: int | None = None
    follow_selection: bool = False
    background: Color | None = None
    guides: bool = True
    """Draw the ├─ └─ connectors."""
    guide_color: Color | None = None


def _flatten(
    nodes: Sequence[TreeNode], depth: int, trail: list[bool], out: list
) -> None:
    for i, node in enumerate(nodes):
        last = i == len(nodes) - 1
        here = [*trail, last]
        out.append((node, depth, here))
        if node.children and node.expanded:
            _flatten(node.children, depth + 1, here, out)


def draw_tree(surface: Surface, options: TreeOptions) -> None:
    """An indented tree with box-drawing connectors, like ``pstree``."""
    if surface.empty:
        return
    theme = surface.theme
    flat: list = []
    _flatten(options.nodes, 0, [], flat)

    offset = resolve_offset(
        options.offset, options.selected, surface.height, len(flat), options.follow_selection
    )
    guide_color = (
        options.guide_color
        if options.guide_color is not None
        else theme.border.mix(theme.foreground, 0.15)
    )

    for i in range(surface.height):
        index = offset + i
        if index >= len(flat):
            break
        node, depth, last = flat[index]
        selected = options.selected == index
        bg = theme.selection if selected else options.background
        if selected:
            surface.fill_rect(0, i, surface.width, 1, Style(bg=theme.selection))

        if options.guides:
            prefix = "".join("   " if last[d] else "│  " for d in range(depth))
            prefix += "└─ " if last[depth] else "├─ "
        else:
            prefix = "  " * depth

        values_width = sum(v.width + 1 for v in node.values)
        label_width = max(0, surface.width - values_width)
        surface.text(
            0, i, truncate(prefix, label_width), TextOptions(fg=guide_color, bg=bg)
        )
        px = min(string_width(prefix), label_width)
        surface.text(
            px, i, truncate(node.label, max(0, label_width - px)),
            TextOptions(
                fg=theme.selection_text if selected else (node.color or theme.foreground),
                bg=bg,
                attrs=Attrs.BOLD if selected else 0,
            ),
        )

        vx = label_width
        for value in node.values:
            surface.text(
                vx, i, fit(truncate(value.text, value.width), value.width, value.align),
                TextOptions(
                    fg=theme.selection_text if selected else (value.color or theme.foreground),
                    bg=bg,
                ),
            )
            vx += value.width + 1


@dataclass(frozen=True, slots=True)
class LogEntry:
    message: str = ""
    time: str = ""
    level: str = ""
    meta: str = ""
    color: Color | None = None


@dataclass(frozen=True, slots=True)
class LogOptions:
    entries: Sequence[LogEntry] = ()
    follow: bool = True
    """Pin to the newest entry. Set False to scroll with ``offset``."""
    offset: int | None = None
    from_end: int = 0
    """Lines to scroll back from the newest entry. The natural control for a
    tailing log: only the widget knows how many rows fit, so an absolute offset
    makes small scrolls near the bottom clamp to nothing."""
    scrollbar: bool = False
    background: Color | None = None
    level_colors: Mapping[str, Color] = field(default_factory=dict)
    time_color: Color | None = None
    meta_color: Color | None = None


def draw_log(surface: Surface, options: LogOptions) -> None:
    """A tailing log view with colored levels. Newest at the bottom."""
    if surface.empty:
        return
    theme = surface.theme
    defaults = {
        "ERROR": theme.danger,
        "WARN": theme.warning,
        "INFO": theme.success,
        "DEBUG": theme.muted,
        "TRACE": theme.muted,
        "FATAL": theme.danger,
    }
    levels = {**defaults, **options.level_colors}

    entries = options.entries
    width = surface.width - (1 if options.scrollbar else 0)
    from_end = max(0, options.from_end)
    max_start = max(0, len(entries) - surface.height)
    if options.follow or from_end > 0:
        start = max(0, min(max_start, len(entries) - surface.height - from_end))
    else:
        start = resolve_offset(options.offset, None, surface.height, len(entries))

    for i in range(surface.height):
        if start + i >= len(entries):
            break
        entry = entries[start + i]
        x = 0
        if entry.time:
            x += surface.text(
                x, i, f"{entry.time} ",
                TextOptions(
                    fg=options.time_color if options.time_color is not None else theme.muted,
                    bg=options.background,
                ),
            )
        if entry.level:
            color = levels.get(entry.level.upper(), theme.foreground)
            x += surface.text(
                x, i, fit(entry.level.upper(), 5, Align.LEFT),
                TextOptions(fg=color, bg=options.background, attrs=Attrs.BOLD),
            )
            x += surface.text(x, i, " ", TextOptions(bg=options.background))
        meta_width = string_width(entry.meta) + 1 if entry.meta else 0
        msg_width = max(0, width - x - meta_width)
        surface.text(
            x, i, truncate(entry.message, msg_width),
            TextOptions(
                fg=entry.color if entry.color is not None else theme.foreground,
                bg=options.background,
            ),
        )
        if entry.meta and meta_width < width:
            surface.text(
                width - meta_width + 1, i, entry.meta,
                TextOptions(
                    fg=options.meta_color if options.meta_color is not None else theme.muted,
                    bg=options.background,
                ),
            )
