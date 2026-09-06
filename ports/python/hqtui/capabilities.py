"""What the terminal can actually do.

Detection is deliberately conservative: we degrade colors and glyphs rather than
print mojibake on someone's console.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from enum import Enum
from typing import Mapping

__all__ = ["ColorDepth", "Capabilities", "CapabilityOverrides", "detect_capabilities"]


class ColorDepth(str, Enum):
    TRUECOLOR = "truecolor"
    ANSI256 = "ansi256"
    ANSI16 = "ansi16"
    NONE = "none"


@dataclass(frozen=True, slots=True)
class Capabilities:
    tty: bool
    """stdout is a real TTY, not a pipe or a file."""
    colors: ColorDepth
    true_color: bool
    unicode: bool
    braille: bool
    mouse: bool
    synchronized_output: bool
    """DEC 2026 atomic frame updates."""
    bracketed_paste: bool
    focus_events: bool
    tmux: bool
    screen: bool
    ssh: bool
    windows: bool
    program: str
    """Best guess at the emulator: kitty, wezterm, ghostty, iterm, alacritty,
    vscode, windows-terminal, xterm, unknown."""


@dataclass(frozen=True, slots=True)
class CapabilityOverrides:
    """Force a capability rather than detecting it.

    Used by tests and by apps that know better than the environment does.
    """

    colors: ColorDepth | None = None
    unicode: bool | None = None
    braille: bool | None = None
    mouse: bool | None = None
    synchronized_output: bool | None = None
    tty: bool | None = None


_TRUECOLOR_PROGRAMS = frozenset(
    {"kitty", "wezterm", "ghostty", "iterm", "vscode", "windows-terminal", "konsole"}
)
_SYNC_PROGRAMS = frozenset(
    {"kitty", "wezterm", "ghostty", "iterm", "windows-terminal", "konsole", "alacritty"}
)


def detect_program(env: Mapping[str, str]) -> str:
    term = env.get("TERM", "")
    program = env.get("TERM_PROGRAM", "")
    if env.get("KITTY_WINDOW_ID") or term == "xterm-kitty":
        return "kitty"
    if env.get("WEZTERM_EXECUTABLE") or program == "WezTerm":
        return "wezterm"
    if env.get("GHOSTTY_RESOURCES_DIR") or term == "xterm-ghostty":
        return "ghostty"
    if program == "iTerm.app":
        return "iterm"
    if env.get("ALACRITTY_WINDOW_ID") or term == "alacritty":
        return "alacritty"
    if program == "vscode":
        return "vscode"
    if env.get("WT_SESSION"):
        return "windows-terminal"
    if program == "Apple_Terminal":
        return "apple-terminal"
    if env.get("KONSOLE_VERSION"):
        return "konsole"
    if term.startswith("xterm"):
        return "xterm"
    return "unknown"


def _detect_colors(env: Mapping[str, str], tty: bool) -> ColorDepth:
    if env.get("NO_COLOR"):
        return ColorDepth.NONE
    force = env.get("FORCE_COLOR")
    if force in ("0", "false"):
        return ColorDepth.NONE
    if force == "1":
        return ColorDepth.ANSI16
    if force == "2":
        return ColorDepth.ANSI256
    if force == "3":
        return ColorDepth.TRUECOLOR
    # Any other non-empty value — FORCE_COLOR=true is the common one — asserts
    # that color works. It is a floor, not a ceiling: returning a level here
    # would cap a truecolor terminal at 16 colors. It only waives the tty check.
    if not tty and not force:
        return ColorDepth.NONE
    term = env.get("TERM", "")
    if term == "dumb":
        return ColorDepth.NONE
    if env.get("COLORTERM", "").lower() in ("truecolor", "24bit"):
        return ColorDepth.TRUECOLOR
    if detect_program(env) in _TRUECOLOR_PROGRAMS:
        return ColorDepth.TRUECOLOR
    if "256" in term:
        return ColorDepth.ANSI256
    return ColorDepth.ANSI16


def _detect_unicode(env: Mapping[str, str], windows: bool) -> bool:
    # A dumb terminal has no glyph repertoire to speak of. The Linux console is
    # not in that category — its default font draws box and block elements
    # perfectly well — so only Braille is withheld from it, below.
    if env.get("TERM") == "dumb":
        return False
    locale = env.get("LC_ALL") or env.get("LC_CTYPE") or env.get("LANG") or ""
    upper = locale.upper()
    if "UTF8" in upper or "UTF-8" in upper:
        return True
    # Windows Terminal and modern emulators are UTF-8 regardless of locale vars.
    if env.get("WT_SESSION") or env.get("TERM_PROGRAM") or env.get("KITTY_WINDOW_ID"):
        return True
    if windows:
        return bool(env.get("WT_SESSION"))
    return locale == ""


def _is_tty() -> bool:
    try:
        return bool(sys.stdout.isatty())
    except (AttributeError, ValueError):
        return False


def detect_capabilities(
    overrides: CapabilityOverrides | None = None,
    env: Mapping[str, str] | None = None,
    is_tty: bool | None = None,
) -> Capabilities:
    o = overrides or CapabilityOverrides()
    env = os.environ if env is None else env
    windows = sys.platform.startswith("win")

    tty = o.tty if o.tty is not None else (_is_tty() if is_tty is None else is_tty)
    term = env.get("TERM", "")
    program = detect_program(env)
    tmux = bool(env.get("TMUX")) or term.startswith("tmux") or term.startswith("screen")
    screen = term.startswith("screen") and not env.get("TMUX")
    ssh = bool(env.get("SSH_CLIENT") or env.get("SSH_TTY") or env.get("SSH_CONNECTION"))

    colors = o.colors if o.colors is not None else _detect_colors(env, tty)
    unicode_ok = o.unicode if o.unicode is not None else _detect_unicode(env, windows)
    # The Linux console draws box and block elements but has no Braille in its
    # default font, which is the one glyph class it genuinely lacks.
    braille = (
        o.braille
        if o.braille is not None
        else (unicode_ok and program != "apple-terminal" and term != "linux")
    )
    mouse = o.mouse if o.mouse is not None else (tty and term not in ("dumb", "linux"))
    sync = (
        o.synchronized_output
        if o.synchronized_output is not None
        else (tty and (program in _SYNC_PROGRAMS or tmux))
    )

    return Capabilities(
        tty=tty,
        colors=colors,
        true_color=colors == ColorDepth.TRUECOLOR,
        unicode=unicode_ok,
        braille=braille,
        mouse=mouse,
        synchronized_output=sync,
        bracketed_paste=tty and term != "dumb",
        focus_events=tty and term != "dumb" and not screen,
        tmux=tmux,
        screen=screen,
        ssh=ssh,
        windows=windows,
        program=program,
    )
