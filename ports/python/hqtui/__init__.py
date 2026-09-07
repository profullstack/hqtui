"""HQTUI — High Quality Terminal UI.

    from hqtui import App, Panel

    app = App()
    app.render(lambda f: f.ui.panel(Panel(title="Hello"),
                                    lambda p: p.text("Hello, terminal.")))
    app.start()

Dark theme, mouse, truecolor, resize handling and terminal restoration are all
on by default. https://hqtui.com

This is the Python port of the TypeScript reference implementation. Behaviour is
pinned to it by a shared conformance suite: the same widget arguments produce
the same cells, the same colors and the same escape sequences in both. Where the
two differ, it is called out in the module that differs.
"""

from .app import App, AppOptions, FrameStats, RenderArgs
from .buffer import Attrs, FrameBuffer, Style
from .capabilities import Capabilities, CapabilityOverrides, ColorDepth, detect_capabilities
from .color import Color, DEFAULT_COLOR, Gradient, from_256
from .diff import EncodeResult, Encoder, encode_full
from .graphics import BrailleCanvas, FillMode
from .input import InputParser, KeyEvent, MouseAction, MouseEvent, match_key
from .layout import Constraint, Direction, Rect, solve, stack
from .surface import BorderStyle, BoxOptions, Surface, TextOptions
from .terminal import Terminal, TerminalOptions, TerminalSize, emergency_restore
from .testing import render_to_ansi, render_to_html, render_to_screen, render_to_text
from .theme import THEMES, Theme, define_theme, resolve_theme
from .ui import Cell, Container, Grid, GridSpec, Layout, Panel, ScrollHandlers
from .unicode import Align, fit, string_width, truncate, wrap

__version__ = "0.1.12"

REFERENCE_VERSION = "0.1.12"
"""The version of the TypeScript reference implementation this port tracks."""

__all__ = [
    "Align", "App", "AppOptions", "Attrs", "BorderStyle", "BoxOptions", "BrailleCanvas",
    "Capabilities", "CapabilityOverrides", "Color", "ColorDepth", "Constraint",
    "DEFAULT_COLOR", "Direction", "EncodeResult", "Encoder", "FillMode",
    "FrameBuffer", "Gradient", "Rect", "Style", "Surface", "THEMES", "Theme",
    "TextOptions", "define_theme", "detect_capabilities", "encode_full", "fit",
    "from_256", "resolve_theme", "solve", "stack", "string_width", "truncate",
    "wrap",
    "Cell", "Container", "FrameStats", "Grid", "GridSpec", "InputParser",
    "KeyEvent", "Layout", "MouseEvent", "MouseAction", "Panel", "RenderArgs",
    "ScrollHandlers", "Terminal", "TerminalOptions", "TerminalSize",
    "emergency_restore", "match_key", "render_to_ansi", "render_to_html",
    "render_to_screen", "render_to_text", "widgets",
]

from . import widgets  # noqa: E402  (re-exported for `hqtui.widgets.*`)
