"""The builder.

Every container collects its children first, then solves the layout once and
draws — which is why ``"1fr"`` works without a retained tree.

Python keeps the reference implementation's callback shape, because Python
closures capture by reference and the runtime has a garbage collector:
``on_press=lambda: state.bump()`` is exactly as natural here as in TypeScript.
The Rust port has to invert this; Python does not.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Callable, Mapping, Sequence

from . import widgets as w
from .buffer import Style
from .capabilities import Capabilities
from .color import Color
from .graphics import BrailleCanvas
from .layout import Constraint, Direction, Rect, solve, stack
from .surface import BorderStyle, BoxOptions, Surface
from .theme import Theme
from .unicode import Align, string_width, wrap

__all__ = [
    "Container",
    "Grid",
    "HitRegion",
    "Panel",
    "RenderContext",
    "ScrollHandlers",
]


@dataclass(slots=True)
class HitRegion:
    """A rectangle the mouse can reach."""

    rect: Rect
    on_click: Callable[[int, int, str], None] | None = None
    """Receives coordinates local to the region, and the button name."""
    on_scroll: Callable[[int], None] | None = None
    """Receives -1 for up and 1 for down."""
    on_hover: Callable[[int, int], None] | None = None


@dataclass(slots=True)
class ScrollHandlers:
    """Mouse behaviour shared by every scrollable widget.

    Supplying any of these turns a widget into its own scroll region, so the
    wheel acts on whatever is under the pointer rather than on one list per
    screen.
    """

    on_scroll: Callable[[int], None] | None = None
    on_select_row: Callable[[int], None] | None = None
    """A click on a visible row, counted from the first body row — so a table's
    header does not shift every index by one."""
    on_focus: Callable[[], None] | None = None


@dataclass(slots=True)
class RenderContext:
    """Per-frame state every container in the tree shares.

    This is what lets a nested panel register a hit region or claim a focus slot.
    """

    theme: Theme
    capabilities: Capabilities
    width: int
    height: int
    frame: int = 0
    elapsed: float = 0.0
    """Seconds since the app started."""
    focus_index: int = 0
    collapse_borders: bool = False
    """Merge the borders of adjacent panels into shared lines, the way CSS
    collapses table borders. Off unless the app asks for it, because it changes
    every layout that has two panels side by side."""

    focus_cursor: int = 0
    focus_actions: list = field(default_factory=list)
    hits: list[HitRegion] = field(default_factory=list)
    overlays: list = field(default_factory=list)
    invalidate: Callable[[], None] = lambda: None

    def register_focus(self, action: Callable[[], None] | None = None) -> bool:
        """Claim the next focus slot. Returns whether this control has focus."""
        index = self.focus_cursor
        self.focus_cursor += 1
        while len(self.focus_actions) <= index:
            self.focus_actions.append(None)
        if action is not None:
            self.focus_actions[index] = action
        return index == self.focus_index

    def hit(self, region: HitRegion) -> None:
        self.hits.append(region)

    def overlay(self, draw: Callable[[Surface], None]) -> None:
        self.overlays.append(draw)


@dataclass(slots=True)
class Layout:
    """Sizing and padding every container and widget shares."""

    size: "int | str | None" = None
    """Size along the parent's main axis."""
    min: int | None = None
    max: int | None = None
    gap: int = 0
    padding: "int | tuple | None" = None
    background: Color | None = None


@dataclass(slots=True)
class Panel(Layout):
    """A bordered panel. The callback receives its interior as a column."""

    title: str = ""
    title_align: "Align | str" = Align.LEFT
    title_color: Color | None = None
    subtitle: str = ""
    subtitle_color: Color | None = None
    footer: str = ""
    border: "BorderStyle | str" = BorderStyle.ROUNDED
    border_color: Color | None = None
    focusable: bool = False
    """Draws the focused border color and joins the Tab order."""
    focused: bool | None = None
    inner_padding: "int | tuple | None" = None
    """Defaults to one column either side, as panels do."""


@dataclass(slots=True)
class GridSpec(Layout):
    """A CSS-ish grid."""

    columns: "Sequence[int | str] | int | None" = None
    rows: "Sequence[int | str] | int | None" = None


@dataclass(slots=True)
class Cell:
    """Grid placement for one cell."""

    col_span: int = 1
    row_span: int = 1


class Container:
    __slots__ = ("surface", "ctx", "direction", "_gap", "_inner", "_children")

    def __init__(
        self,
        surface: Surface,
        ctx: RenderContext,
        direction: "Direction | str" = Direction.COLUMN,
        layout: Layout | None = None,
    ) -> None:
        l = layout or Layout()
        self.surface = surface
        self.ctx = ctx
        self.direction = direction
        self._gap = l.gap
        self._inner = surface.inset(l.padding) if l.padding is not None else surface
        self._children: list[tuple[Constraint, Callable[[Surface], None]]] = []
        if l.background is not None:
            surface.fill(Style(bg=l.background))

    @property
    def theme(self) -> Theme:
        return self.surface.theme

    @property
    def capabilities(self) -> Capabilities:
        return self.ctx.capabilities

    @property
    def width(self) -> int:
        return self._inner.width

    @property
    def height(self) -> int:
        return self._inner.height

    @property
    def _cross_width(self) -> int:
        """Width available to a child laid out along the main axis."""
        return self._inner.width if self.direction == Direction.COLUMN else self._inner.height

    def _add(
        self,
        constraint: Constraint,
        draw: Callable[[Surface], None],
        bordered: bool = False,
    ) -> "Container":
        """Queue a child.

        ``bordered`` says whether it draws a border of its own. Only bordered
        siblings collapse into each other: a table pressed against a panel edge
        should not grow junctions out of its rows.
        """
        self._children.append((constraint, draw, bordered))
        return self

    def _seams(self) -> "int | list[int]":
        """The gap at each seam.

        Ordinarily one number repeated, but where collapsing is on and two
        bordered siblings meet with no gap between them, the seam is minus one
        so their borders land in the same column and merge.
        """
        if not self.ctx.collapse_borders or self._gap != 0 or len(self._children) < 2:
            return self._gap
        return [
            -1 if self._children[i][2] and self._children[i + 1][2] else self._gap
            for i in range(len(self._children) - 1)
        ]

    def _constraint(
        self, l: Layout, fallback: "int | str", intrinsic: int | None = None
    ) -> Constraint:
        if l.size is not None:
            size = l.size
        elif self.direction == Direction.ROW:
            # Intrinsic sizes describe height. Along a row, a widget takes the
            # space it is given.
            size = "fill"
        else:
            size = fallback
        return Constraint(size=size, min=l.min, max=l.max, intrinsic=intrinsic)

    def _leaf(self, l: Layout, intrinsic: int) -> Constraint:
        """A widget's constraint: its natural height down a column, the whole
        track across a row."""
        return self._constraint(l, "auto", intrinsic)

    def _filling(self, l: Layout) -> Constraint:
        return self._constraint(l, "fill")

    def flush(self) -> None:
        """Solve and draw. The app calls this for you; parents call it for
        children."""
        if not self._children or self._inner.rect.is_empty:
            return
        rects = stack(
            self._inner.rect,
            [c for c, _, _ in self._children],
            self.direction,
            self._seams(),
        )
        children, self._children = self._children, []
        for (_, draw, _), rect in zip(children, rects):
            if rect.is_empty:
                continue
            draw(self._inner.region(rect))

    # ------------------------------------------------------------- layout

    def row(self, layout: Layout | None = None, build: Callable[["Container"], None] | None = None):
        """A horizontal container. Children default to equal shares."""
        l = layout or Layout()

        def draw(s: Surface) -> None:
            container = Container(s, self.ctx, Direction.ROW, l)
            if build:
                build(container)
            container.flush()

        return self._add(self._constraint(l, "fill"), draw)

    def column(self, layout: Layout | None = None, build: Callable[["Container"], None] | None = None):
        """A vertical container."""
        l = layout or Layout()

        def draw(s: Surface) -> None:
            container = Container(s, self.ctx, Direction.COLUMN, l)
            if build:
                build(container)
            container.flush()

        return self._add(self._constraint(l, "fill"), draw)

    def panel(self, options: Panel | None = None, build: Callable[["Container"], None] | None = None):
        """A bordered panel."""
        o = options or Panel()
        focused = self.ctx.register_focus() if o.focusable else False
        if o.focused is not None:
            focused = o.focused

        def draw(s: Surface) -> None:
            border_color = o.border_color
            if border_color is None:
                border_color = s.theme.border_focused if focused else s.theme.border
            interior = s.box(
                BoxOptions(
                    title=o.title, title_align=o.title_align, title_color=o.title_color,
                    subtitle=o.subtitle, subtitle_color=o.subtitle_color, footer=o.footer,
                    border=o.border, border_color=border_color, bg=o.background,
                    collapse=self.ctx.collapse_borders,
                )
            )
            padding = o.inner_padding if o.inner_padding is not None else (0, 1)
            container = Container(
                interior, self.ctx, Direction.COLUMN, Layout(gap=o.gap, padding=padding)
            )
            if build:
                build(container)
            container.flush()

        bordered = str(getattr(o.border, "value", o.border)) != "none"
        return self._add(self._constraint(o, "fill"), draw, bordered)

    def box(self, options: Panel | None = None, build: Callable[["Container"], None] | None = None):
        """A panel without a border — a grouping box that costs no rows."""
        o = replace(options or Panel(), border=BorderStyle.NONE)
        return self.panel(o, build)

    def grid(self, options: GridSpec | None = None, build: Callable[["Grid"], None] | None = None):
        """A CSS-ish grid, filled row-major with optional spans."""
        o = options or GridSpec()

        def draw(s: Surface) -> None:
            grid = Grid(s, self.ctx, o)
            if build:
                build(grid)
            grid.flush()

        return self._add(self._constraint(o, "fill"), draw)

    def spacer(self, size: "int | str" = "fill"):
        """Blank space."""
        return self._add(Constraint(size=size), lambda s: None)

    def divider(self, options: w.DividerOptions | None = None, layout: Layout | None = None):
        """A horizontal rule, optionally labelled."""
        o = options or w.DividerOptions()
        return self._add(self._leaf(layout or Layout(), 1), lambda s: w.draw_divider(s, o))

    # --------------------------------------------------------------- text

    def text(self, content: str, style: w.TextStyle | None = None, layout: Layout | None = None):
        o = style or w.TextStyle()
        lines = len(wrap(content, self._cross_width)) if o.wrap else content.count("\n") + 1
        return self._add(
            self._leaf(layout or Layout(), lines), lambda s: w.draw_text(s, content, o)
        )

    def label(self, content: str, layout: Layout | None = None):
        """Muted secondary text."""
        return self.text(content, w.TextStyle(fg=self.theme.muted), layout)

    def heading(self, content: str, layout: Layout | None = None):
        """Bold heading in the theme's title color."""
        return self.text(content, w.TextStyle(fg=self.theme.title, bold=True), layout)

    def badge(self, options: w.BadgeOptions, layout: Layout | None = None):
        return self._add(self._leaf(layout or Layout(), 1), lambda s: w.draw_badge(s, options))

    def key_values(self, options: w.KeyValueOptions, layout: Layout | None = None):
        """Aligned label/value pairs."""
        return self._add(
            self._leaf(layout or Layout(), len(options.rows)),
            lambda s: w.draw_key_values(s, options),
        )

    # --------------------------------------------------------------- data

    def _attach_scroll(self, s: Surface, h: ScrollHandlers, header_rows: int = 0) -> None:
        """Register the widget's rect so the wheel and clicks reach it."""
        if h.on_scroll is None and h.on_select_row is None and h.on_focus is None:
            return

        def on_click(x: int, y: int, button: str) -> None:
            if h.on_focus:
                h.on_focus()
            # Row 0 is the header when there is one; clicks there only focus.
            if h.on_select_row and y >= header_rows:
                h.on_select_row(y - header_rows)

        self.ctx.hit(HitRegion(rect=s.hit_rect(), on_scroll=h.on_scroll, on_click=on_click))

    def table(
        self, options: w.TableOptions, handlers: ScrollHandlers | None = None,
        layout: Layout | None = None,
    ):
        h = handlers or ScrollHandlers()
        header_rows = 1 if options.header else 0
        intrinsic = len(options.rows) + header_rows

        def draw(s: Surface) -> None:
            w.draw_table(s, options)
            self._attach_scroll(s, h, header_rows)

        return self._add(self._constraint(layout or Layout(), "fill", intrinsic), draw)

    def list(
        self, options: w.ListOptions, handlers: ScrollHandlers | None = None,
        layout: Layout | None = None,
    ):
        h = handlers or ScrollHandlers()

        def draw(s: Surface) -> None:
            w.draw_list(s, options)
            self._attach_scroll(s, h)

        return self._add(self._constraint(layout or Layout(), "fill", len(options.items)), draw)

    def scrollbar(
        self, options: w.ScrollbarOptions, handlers: ScrollHandlers | None = None,
        layout: Layout | None = None,
    ):
        """A scrollbar over state you own, for anything that scrolls and is not
        a table: wrapped prose, a canvas, a ``draw`` of your own. A vertical bar
        fills the space it is given; a horizontal one is a single row."""
        h = handlers or ScrollHandlers()

        def draw(s: Surface) -> None:
            w.draw_scrollbar_widget(s, options)
            self._attach_scroll(s, h)

        fallback = "fill" if w.is_vertical(options.orientation) else 1
        return self._add(self._constraint(layout or Layout(), fallback), draw)

    def tree(
        self, options: w.TreeOptions, handlers: ScrollHandlers | None = None,
        layout: Layout | None = None,
    ):
        h = handlers or ScrollHandlers()

        def draw(s: Surface) -> None:
            w.draw_tree(s, options)
            self._attach_scroll(s, h)

        return self._add(self._filling(layout or Layout()), draw)

    def log(
        self, options: w.LogOptions, handlers: ScrollHandlers | None = None,
        layout: Layout | None = None,
    ):
        h = handlers or ScrollHandlers()

        def draw(s: Surface) -> None:
            w.draw_log(s, options)
            self._attach_scroll(s, h)

        return self._add(self._constraint(layout or Layout(), "fill", len(options.entries)), draw)

    # ------------------------------------------------------------ metrics

    def meter(self, options: w.MeterOptions, layout: Layout | None = None):
        """``label ████████░░░ 42%``"""
        return self._add(self._leaf(layout or Layout(), 1), lambda s: w.draw_meter(s, options))

    def meters(self, options: w.MetersOptions, layout: Layout | None = None):
        """A stack or grid of meters."""
        columns = max(1, options.columns)
        rows = -(-len(options.items) // columns)
        return self._add(self._leaf(layout or Layout(), rows), lambda s: w.draw_meters(s, options))

    def progress(self, options: w.ProgressOptions, layout: Layout | None = None):
        return self._add(self._leaf(layout or Layout(), 1), lambda s: w.draw_progress(s, options))

    def graph(self, options: w.GraphOptions, layout: Layout | None = None):
        """Braille line/area graph. Fills the space it is given."""
        return self._add(self._filling(layout or Layout()), lambda s: w.draw_graph(s, options))

    def chart(self, options: w.ChartOptions, layout: Layout | None = None):
        """A chart of arbitrary (x, y) data, with a domain on both axes.

        ``graph`` plots a history buffer, one sample per column. Use this when
        the data has its own x values: two series of different lengths then line
        up, and a point lands where its x says it does.
        """
        return self._add(
            self._constraint(layout or Layout(), "fill"),
            lambda s: w.draw_chart(s, options),
        )

    def sparkline(self, options: w.SparklineWidgetOptions, layout: Layout | None = None):
        return self._add(self._leaf(layout or Layout(), 1), lambda s: w.draw_sparkline(s, options))

    def histogram(self, options: w.ColumnsOptions, layout: Layout | None = None):
        return self._add(self._filling(layout or Layout()), lambda s: w.draw_columns(s, options))

    def gauge(self, options: w.GaugeOptions, layout: Layout | None = None):
        """A semicircular dial. Wants at least 9x5."""
        return self._add(self._filling(layout or Layout()), lambda s: w.draw_gauge(s, options))

    def donut(self, options: w.DonutOptions, layout: Layout | None = None):
        return self._add(self._filling(layout or Layout()), lambda s: w.draw_donut(s, options))

    def heat_bar(self, options: w.HeatBarOptions, layout: Layout | None = None):
        """Segmented temperature-style bar."""
        return self._add(self._leaf(layout or Layout(), 1), lambda s: w.draw_heat_bar(s, options))

    # ------------------------------------------------------------- inputs

    def button(
        self, options: w.ButtonOptions, on_press: Callable[[], None] | None = None,
        layout: Layout | None = None,
    ):
        """A button. Pass ``on_press`` and it joins the Tab order automatically."""
        focused = self.ctx.register_focus(on_press)

        def draw(s: Surface) -> None:
            w.draw_button(s, replace(options, focused=options.focused or focused))
            if on_press:
                self.ctx.hit(
                    HitRegion(rect=s.hit_rect(), on_click=lambda x, y, b: on_press())
                )

        return self._add(self._leaf(layout or Layout(), 1), draw)

    def checkbox(
        self, options: w.CheckboxOptions, on_toggle: Callable[[], None] | None = None,
        layout: Layout | None = None,
    ):
        focused = self.ctx.register_focus(on_toggle)

        def draw(s: Surface) -> None:
            w.draw_checkbox(s, replace(options, focused=options.focused or focused))
            if on_toggle:
                self.ctx.hit(
                    HitRegion(rect=s.hit_rect(), on_click=lambda x, y, b: on_toggle())
                )

        return self._add(self._leaf(layout or Layout(), 1), draw)

    def select(
        self, options: w.SelectOptions, on_open: Callable[[], None] | None = None,
        layout: Layout | None = None,
    ):
        focused = self.ctx.register_focus(on_open)
        intrinsic = len(options.options) + 1 if options.open else 1

        def draw(s: Surface) -> None:
            w.draw_select(s, replace(options, focused=options.focused or focused))
            if on_open:
                self.ctx.hit(HitRegion(rect=s.hit_rect(), on_click=lambda x, y, b: on_open()))

        return self._add(self._leaf(layout or Layout(), intrinsic), draw)

    def text_input(self, options: w.TextInputOptions, layout: Layout | None = None):
        focused = self.ctx.register_focus()
        return self._add(
            self._leaf(layout or Layout(), 1),
            lambda s: w.draw_text_input(s, replace(options, focused=options.focused or focused)),
        )

    def tabs(
        self, options: w.TabsOptions, on_select: Callable[[int], None] | None = None,
        layout: Layout | None = None,
    ):
        def draw(s: Surface) -> None:
            w.draw_tabs(s, options)
            if on_select:
                r = s.hit_rect()
                x = 0
                for i, tab in enumerate(options.tabs):
                    width = string_width(tab) + 4
                    self.ctx.hit(
                        HitRegion(
                            rect=Rect(r.x + x, r.y, width, 1),
                            on_click=(lambda index: lambda cx, cy, b: on_select(index))(i),
                        )
                    )
                    x += width

        return self._add(self._leaf(layout or Layout(), 1), draw)

    def status_bar(self, options: w.StatusBarOptions, layout: Layout | None = None):
        return self._add(
            self._leaf(layout or Layout(), 1), lambda s: w.draw_status_bar(s, options)
        )

    # ----------------------------------------------------------- overlays

    def modal(self, options: w.ModalOptions, build: Callable[["Container"], None] | None = None):
        """A centred dialog drawn above everything else this frame."""

        def draw(root: Surface) -> None:
            inner = w.draw_modal(root, options)
            if build:
                container = Container(inner, self.ctx, Direction.COLUMN, Layout(padding=1))
                build(container)
                container.flush()

        self.ctx.overlay(draw)
        return self

    def command_palette(self, options: w.CommandPaletteOptions):
        self.ctx.overlay(lambda root: w.draw_command_palette(root, options))
        return self

    def tooltip(self, options: w.TooltipOptions):
        self.ctx.overlay(lambda root: w.draw_tooltip(root, options))
        return self

    # ---------------------------------------------------- escape hatches

    def draw(self, fn: Callable[[Surface], None], layout: Layout | None = None):
        """Draw straight onto the framebuffer region. Nothing is off limits."""
        return self._add(self._filling(layout or Layout()), fn)

    def canvas(
        self, fn: Callable[[BrailleCanvas, Surface], None],
        color: Color | None = None, layout: Layout | None = None,
    ):
        """A Braille pixel canvas sized to the region, blitted when you are done."""

        def draw(s: Surface) -> None:
            canvas = BrailleCanvas(s.width, s.height)
            fn(canvas, s)
            fg = color if color is not None else s.theme.accent
            for row in range(canvas.rows):
                for col in range(canvas.cols):
                    value = canvas.cell(col, row)
                    if value:
                        s.char(col, row, value, Style(fg=fg))

        return self._add(self._filling(layout or Layout()), draw)

    def responsive(self, breakpoints: Mapping[int, Callable[["Container"], None]]):
        """Pick a layout by available width.

        ``ui.responsive({120: wide, 80: medium, 0: compact})``
        """
        widths = sorted(breakpoints, reverse=True)
        if not widths:
            return self
        chosen = next((w_ for w_ in widths if self.width >= w_), widths[-1])
        fn = breakpoints.get(chosen)
        if fn:
            fn(self)
        return self

    def when(self, condition: bool, build: Callable[["Container"], None]):
        """Run ``build`` only when the condition holds."""
        if condition:
            build(self)
        return self


class Grid:
    """Grid placement with spans. Cells are filled row-major."""

    __slots__ = ("surface", "ctx", "options", "_cells")

    def __init__(self, surface: Surface, ctx: RenderContext, options: GridSpec) -> None:
        self.surface = surface.inset(options.padding) if options.padding is not None else surface
        self.ctx = ctx
        self.options = options
        self._cells: list[tuple[Cell, Callable[[Surface], None]]] = []

    @property
    def theme(self) -> Theme:
        return self.surface.theme

    @staticmethod
    def _track(spec, fallback: int) -> list:
        if isinstance(spec, (list, tuple)):
            return list(spec)
        count = spec if isinstance(spec, int) else fallback
        return ["1fr"] * max(1, count)

    def _push(self, cell: Cell, draw: Callable[[Surface], None]) -> "Grid":
        self._cells.append((cell, draw))
        return self

    def panel(
        self, options: Panel | None = None, cell: Cell | None = None,
        build: Callable[[Container], None] | None = None,
    ) -> "Grid":
        """A panel occupying the next free cell, or several with a span."""
        o = options or Panel()

        def draw(s: Surface) -> None:
            container = Container(s, self.ctx, Direction.COLUMN)
            container.panel(o, build)
            container.flush()

        return self._push(cell or Cell(), draw)

    def cell(
        self, cell: Cell | None = None, layout: Layout | None = None,
        build: Callable[[Container], None] | None = None,
    ) -> "Grid":
        def draw(s: Surface) -> None:
            container = Container(s, self.ctx, Direction.COLUMN, layout)
            if build:
                build(container)
            container.flush()

        return self._push(cell or Cell(), draw)

    def row(
        self, cell: Cell | None = None, layout: Layout | None = None,
        build: Callable[[Container], None] | None = None,
    ) -> "Grid":
        def draw(s: Surface) -> None:
            container = Container(s, self.ctx, Direction.ROW, layout)
            if build:
                build(container)
            container.flush()

        return self._push(cell or Cell(), draw)

    def flush(self) -> None:
        if not self._cells or self.surface.rect.is_empty:
            return
        gap = self.options.gap
        column_spec = Grid._track(self.options.columns, min(len(self._cells), 3))
        if isinstance(self.options.rows, (list, tuple)):
            row_count = len(self.options.rows)
        elif isinstance(self.options.rows, int):
            row_count = self.options.rows
        else:
            row_count = -(-len(self._cells) // len(column_spec))
        row_spec = Grid._track(self.options.rows, row_count)

        col_widths = solve(
            self.surface.width, [Constraint(size=s) for s in column_spec], gap
        )
        row_heights = solve(
            self.surface.height, [Constraint(size=s) for s in row_spec], gap
        )

        occupied: set[tuple[int, int]] = set()
        cursor = 0

        for cell, draw in self._cells:
            # Clamp to the grid. A span wider than the track count can never
            # satisfy `col + col_span <= len(col_widths)`, so the placement loop
            # below used to burn the shared cursor to exhaustion — dropping this
            # cell and every one after it. A responsive layout collapsing to one
            # column made a full-width span blank the whole grid.
            col_span = min(max(1, cell.col_span), len(col_widths))
            row_span = min(max(1, cell.row_span), len(row_heights))

            # The cursor is shared across cells, so a cell that cannot be placed
            # must hand it back — otherwise it burns the cursor to exhaustion and
            # every later cell disappears too.
            search_from = cursor
            placed = False
            while cursor < len(col_widths) * len(row_heights) + len(col_widths):
                col = cursor % len(col_widths)
                row = cursor // len(col_widths)
                if row >= len(row_heights):
                    break
                free = col + col_span <= len(col_widths)
                if free:
                    free = not any(
                        (c, r) in occupied
                        for r in range(row, row + row_span)
                        for c in range(col, col + col_span)
                    )
                if not free:
                    cursor += 1
                    continue
                for r in range(row, row + row_span):
                    for c in range(col, col + col_span):
                        occupied.add((c, r))

                x = self.surface.rect.x + sum(col_widths[c] + gap for c in range(col))
                y = self.surface.rect.y + sum(row_heights[r] + gap for r in range(row))
                width = sum(
                    col_widths[c] + gap
                    for c in range(col, min(col + col_span, len(col_widths)))
                )
                height = sum(
                    row_heights[r] + gap
                    for r in range(row, min(row + row_span, len(row_heights)))
                )

                rect = Rect(x, y, max(0, width - gap), max(0, height - gap))
                if not rect.is_empty:
                    draw(self.surface.region(rect))
                placed = True
                cursor += 1
                break
            if not placed:
                cursor = search_from
        self._cells = []
