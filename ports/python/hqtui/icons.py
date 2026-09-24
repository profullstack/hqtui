"""Icons for terminals: ``icon("mail")`` is the best glyph this terminal can draw.

The built-in pack is OpenIcon (https://logicsrc.com/openicon), on by default,
generated into ``icons_data.py`` from the same set as the TypeScript reference,
so an icon is the same glyph in every port. Which of its three glyphs you get:
``set_icon_mode`` if the app chose; ``OPENICON_GLYPHS`` or ``HQTUI_ICONS``;
``NERD_FONT=1`` for Nerd Font glyphs; otherwise Unicode where the terminal
draws it and ASCII where it does not. A Nerd Font is never assumed: it cannot
be detected from inside the terminal.
"""
from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from typing import Literal, NamedTuple

from .capabilities import _detect_unicode
from .icons_data import OPENICON_ALIASES, OPENICON_GLYPHS, OPENICON_VERSION

IconMode = Literal["nerd", "unicode", "ascii"]
_MODES = ("nerd", "unicode", "ascii")


class IconGlyphs(NamedTuple):
    """The three spellings of one icon; ``nerd`` is empty when Nerd Fonts has none."""

    nerd: str
    unicode: str
    ascii: str


_BY_KEY = {key: IconGlyphs(nerd, uni, asc) for key, nerd, uni, asc in OPENICON_GLYPHS}
_chosen: IconMode | None = None


def set_icon_mode(mode: IconMode | None) -> None:
    """Pin the glyph family for the whole app, or ``None`` to detect again."""
    global _chosen
    if mode is not None and mode not in _MODES:
        raise ValueError(f"icon mode must be one of {_MODES}, got {mode!r}")
    _chosen = mode


def icon_mode(env: Mapping[str, str] | None = None) -> IconMode:
    """The glyph family an environment gets, in the order in this module's docstring."""
    if _chosen is not None:
        return _chosen
    env = os.environ if env is None else env
    named = env.get("OPENICON_GLYPHS") or env.get("HQTUI_ICONS") or ""
    if named in _MODES:
        return named  # type: ignore[return-value]
    if env.get("NERD_FONT") == "1" or env.get("NERD_FONTS") == "1":
        return "nerd"
    return "unicode" if _detect_unicode(env, sys.platform == "win32") else "ascii"


def icon_glyphs(name: str) -> IconGlyphs | None:
    """An icon's glyphs by key or alias, or ``None``."""
    return _BY_KEY.get(name) or _BY_KEY.get(OPENICON_ALIASES.get(name, ""))


def icon(name: str, mode: IconMode | None = None) -> str:
    """The best glyph for an icon. Unknown names return ``""``."""
    glyphs = icon_glyphs(name)
    if glyphs is None:
        return ""
    mode = mode or icon_mode()
    if mode == "nerd":
        return glyphs.nerd or glyphs.unicode
    return glyphs.unicode if mode == "unicode" else glyphs.ascii


def icon_names() -> list[str]:
    """Every key in the built-in pack, sorted."""
    return [row[0] for row in OPENICON_GLYPHS]


__all__ = ["IconGlyphs", "IconMode", "OPENICON_VERSION", "icon", "icon_glyphs", "icon_mode", "icon_names", "set_icon_mode"]
