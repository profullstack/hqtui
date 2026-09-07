"""The application: owns the terminal, both framebuffers, the scheduler and the
event loop.

Everything else in the package is reachable from here.

::

    app = App()
    app.render(lambda f: f.ui.panel(Panel(title="Hello"),
                                    lambda p: p.text("Hello, terminal.")))
    app.start()

Python keeps the reference implementation's shape — a render callback and event
handlers that close over your own state — because closures capture by reference
and the runtime has a garbage collector. The Rust port has to invert this;
Python does not.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, NamedTuple, Sequence

from . import ansi
from .buffer import FrameBuffer
from .capabilities import Capabilities, ColorDepth
from .color import DEFAULT_COLOR
from .diff import Encoder
from .input import InputEvent, KeyEvent, MouseAction, MouseEvent, match_key
from .layout import Direction
from .surface import Surface
from .terminal import Terminal, TerminalOptions, TerminalSize
from .theme import Theme, resolve_theme
from .ui import Container, HitRegion, RenderContext

__all__ = ["App", "AppOptions", "FrameStats", "RenderArgs"]


@dataclass(slots=True)
class AppOptions:
    terminal: TerminalOptions = field(default_factory=TerminalOptions)
    theme: "Theme | str | None" = None
    """Theme object or built-in name. Defaults to the dark theme."""
    fps: int = 30
    """Cap on frames per second."""
    remote_fps: int = 15
    """Frame cap when an SSH session is detected."""
    always_render: bool = False
    """Redraw every tick instead of only when invalidated."""
    quit_keys: Sequence[str] = ("ctrl+c", "q")
    """Pass an empty tuple to handle quitting yourself."""
    focus_navigation: bool = True
    """Tab/Shift+Tab move focus."""
    paint_background: bool = True
    """Paint the theme background across the whole screen."""
    collapse_borders: bool = False
    """Merge the borders of adjacent panels into shared lines, the way CSS
    collapses table borders. Off by default, because it changes every layout
    with two panels side by side; turn it on once, for the whole screen."""
    monochrome: bool | None = None
    """Drain color, for accessibility or NO_COLOR."""


class FrameStats(NamedTuple):
    frame: int
    render: float
    """Seconds spent building, diffing and writing."""
    changed_cells: int
    dirty_rows: int
    bytes: int


@dataclass(slots=True)
class RenderArgs:
    """What a render callback is handed."""

    ui: Container
    theme: Theme
    capabilities: Capabilities
    width: int
    height: int
    frame: int
    elapsed: float
    focus: int
    """Index of the focused control, in registration order."""
    app: "App"


class App:
    def __init__(self, options: AppOptions | None = None) -> None:
        self.options = options or AppOptions()
        self.terminal = Terminal(self.options.terminal)
        self.capabilities = self.terminal.capabilities
        self.theme = resolve_theme(self.options.theme)

        size = self.terminal.size()
        self._current = FrameBuffer(size.columns, size.rows)
        self._previous = FrameBuffer(size.columns, size.rows)
        monochrome = self.options.monochrome
        if monochrome is None:
            monochrome = self.capabilities.colors == ColorDepth.NONE
        self._encoder = Encoder(self.capabilities.colors, monochrome)

        self._render_fn: Callable[[RenderArgs], None] = lambda args: None
        self._running = False
        self._terminal_active = False
        self._dirty = True
        self._force_repaint = True
        self._started_at = 0.0
        self._frame_count = 0
        self._last_stats = FrameStats(0, 0.0, 0, 0, 0)

        self._focus_index = 0
        self._focus_count = 0
        self._focus_actions: list = []
        self._hits: list[HitRegion] = []

        self._handlers: dict[str, list[Callable]] = {
            "key": [], "mouse": [], "paste": [], "focus": [],
            "resize": [], "frame": [], "exit": [],
        }

    # ------------------------------------------------------------ properties

    @property
    def width(self) -> int:
        return self._current.width

    @property
    def height(self) -> int:
        return self._current.height

    @property
    def stats(self) -> FrameStats:
        return self._last_stats

    @property
    def running(self) -> bool:
        return self._running

    # --------------------------------------------------------------- wiring

    def render(self, fn: Callable[[RenderArgs], None]) -> "App":
        """Register the view. It is called on every frame; keep it cheap."""
        self._render_fn = fn
        self._dirty = True
        return self

    def on(self, event: str, handler: Callable) -> Callable[[], None]:
        """Subscribe to ``key``, ``mouse``, ``paste``, ``focus``, ``resize``,
        ``frame`` or ``exit``. Returns an unsubscribe callable."""
        self._handlers[event].append(handler)
        return lambda: self._handlers[event].remove(handler)

    def _emit(self, event: str, value=None) -> None:
        for handler in list(self._handlers[event]):
            handler(value) if value is not None else handler()

    def invalidate(self) -> None:
        """Ask for a redraw. Repeated calls coalesce into one frame."""
        self._dirty = True

    def redraw(self) -> None:
        """Force a full repaint, e.g. after another process wrote to the
        terminal."""
        self._force_repaint = True
        self._dirty = True

    def set_theme(self, theme: "Theme | str") -> "App":
        self.theme = resolve_theme(theme)
        self.redraw()
        return self

    def focus_next(self, delta: int = 1) -> None:
        """Move keyboard focus. Wraps around."""
        if self._focus_count == 0:
            return
        self._focus_index = (self._focus_index + delta) % self._focus_count
        self._dirty = True

    def activate_focused(self) -> None:
        """Activate the focused control, as Enter does."""
        if self._focus_index < len(self._focus_actions):
            action = self._focus_actions[self._focus_index]
            if action:
                action()
        self._dirty = True

    # ----------------------------------------------------------------- loop

    def _target_fps(self) -> int:
        base = self.options.fps or 30
        if self.capabilities.ssh:
            return min(base, self.options.remote_fps or 15)
        return base

    def start(self) -> None:
        """Run the loop. Returns when the app exits."""
        if self._running:
            return
        self._running = True
        self._started_at = time.monotonic()
        self._terminal_active = True
        try:
            self.terminal.enter()
            interval = max(0.008, 1 / self._target_fps())
            self.frame()
            while self._running:
                if self.terminal.termination_signal():
                    break
                if self.terminal.take_resize():
                    size = self.terminal.size()
                    self._current.resize(size.columns, size.rows)
                    self._previous.resize(size.columns, size.rows)
                    self._force_repaint = True
                    self._dirty = True
                    self._emit("resize", size)

                for event in self.terminal.poll_input(interval):
                    self._handle_input(event)
                if self.options.always_render or self._dirty:
                    self.frame()
        finally:
            self.stop()

    def stop(self) -> None:
        """Stop the loop and restore the terminal."""
        if not self._running and not self._terminal_active:
            return
        self._running = False
        self.terminal.restore()
        self._terminal_active = False
        self._emit("exit")

    def quit(self) -> None:
        """Alias for :meth:`stop`, matching what users type in key handlers."""
        self._running = False

    def _handle_input(self, event) -> None:
        if isinstance(event, KeyEvent):
            if any(match_key(event, k) for k in self.options.quit_keys):
                self._emit("key", event)
                self._running = False
                return
            if self.options.focus_navigation:
                if event.name == "tab":
                    self.focus_next(-1 if event.shift else 1)
                elif event.name in ("enter", "space"):
                    self.activate_focused()
            self._emit("key", event)
            self._dirty = True
        elif isinstance(event, MouseEvent):
            self._dispatch_mouse(event)
            self._emit("mouse", event)
        elif event.type == "paste":
            self._emit("paste", event)
            self._dirty = True
        else:
            self._emit("focus", event)

    def _dispatch_mouse(self, event: MouseEvent) -> None:
        # Later regions are drawn on top, so hit-test in reverse.
        for hit in reversed(self._hits):
            if not hit.rect.contains(event.x, event.y):
                continue
            lx, ly = event.x - hit.rect.x, event.y - hit.rect.y
            if event.action == MouseAction.SCROLL and hit.on_scroll:
                hit.on_scroll(event.scroll)
            elif event.action == MouseAction.PRESS and hit.on_click:
                hit.on_click(lx, ly, event.button.value)
            elif event.action == MouseAction.MOVE and hit.on_hover:
                hit.on_hover(lx, ly)
            self._dirty = True
            return

    def frame(self) -> FrameStats:
        """Build one frame and push the difference to the terminal."""
        started = time.monotonic()
        self._dirty = False

        size = self.terminal.size()
        if size.columns != self._current.width or size.rows != self._current.height:
            self._current.resize(size.columns, size.rows)
            self._previous.resize(size.columns, size.rows)
            self._force_repaint = True

        background = self.theme.background if self.options.paint_background else DEFAULT_COLOR
        self._current.clear(background, self.theme.foreground)

        ctx = RenderContext(
            theme=self.theme,
            capabilities=self.capabilities,
            width=self._current.width,
            height=self._current.height,
            frame=self._frame_count,
            elapsed=time.monotonic() - self._started_at,
            focus_index=self._focus_index,
            collapse_borders=self.options.collapse_borders,
            invalidate=self.invalidate,
        )

        root = Surface.root(self._current, self.theme)
        container = Container(root, ctx, Direction.COLUMN)
        self._render_fn(
            RenderArgs(
                ui=container, theme=self.theme, capabilities=self.capabilities,
                width=self._current.width, height=self._current.height,
                frame=self._frame_count, elapsed=ctx.elapsed,
                focus=self._focus_index, app=self,
            )
        )
        container.flush()
        for overlay in ctx.overlays:
            overlay(root)

        self._hits = ctx.hits
        self._focus_actions = ctx.focus_actions
        self._focus_count = ctx.focus_cursor
        if self._focus_count > 0 and self._focus_index >= self._focus_count:
            self._focus_index = 0

        result = self._encoder.encode(self._previous, self._current, self._force_repaint)
        self._force_repaint = False

        output = result.output
        if output:
            if self.capabilities.synchronized_output:
                output = ansi.BEGIN_SYNC + output + ansi.END_SYNC
            self.terminal.write(output)
        self._previous.copy_from(self._current)

        stats = FrameStats(
            frame=self._frame_count,
            render=time.monotonic() - started,
            changed_cells=result.changed_cells,
            dirty_rows=result.dirty_rows,
            bytes=len(output),
        )
        self._frame_count += 1
        self._last_stats = stats
        self._emit("frame", stats)
        return stats
