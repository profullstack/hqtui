"""Emoji for terminals: ``emoji("fire")`` is 🔥 where the terminal draws emoji
and ``[fire]`` where it cannot.

The built-in pack is OpenEmoji (https://logicsrc.com/openemoji), on by default,
generated into ``emoji_data.py`` from the same set as the TypeScript reference.
A name can be the shortcode with or without ``oe_`` and colons, the CLDR name,
a common alias (``thumbsup``, ``+1``, ``heart``) or the emoji itself. Which you
get: ``set_emoji_mode`` if the app chose; ``HQTUI_EMOJI=emoji|text``; otherwise
emoji where the terminal draws Unicode and is not the Linux console, and text
elsewhere. Text is an emoticon where one fits (``:)`` ``<3`` ``:D``) and the
name in brackets elsewhere. ``string_width`` counts every emoji here as two
columns.
"""
from __future__ import annotations

import os
import re
import sys
from collections.abc import Mapping
from typing import Literal, NamedTuple

from .capabilities import _detect_unicode
from .emoji_data import (
    OPENEMOJI_ALIASES,
    OPENEMOJI_EMOTICONS,
    OPENEMOJI_GROUPS,
    OPENEMOJI_ROWS,
    OPENEMOJI_TONED,
    OPENEMOJI_UNICODE,
    OPENEMOJI_VERSION,
)

EmojiMode = Literal["emoji", "text"]
_MODES = ("emoji", "text")
_TONES = ("1f3fb", "1f3fc", "1f3fd", "1f3fe", "1f3ff")
_TONE_NAMES = ("light", "medium-light", "medium", "medium-dark", "dark")
_SLUG = re.compile(r"[^a-z0-9]+")
_EMOJIFY = re.compile(r":([a-z0-9_+-]+):", re.IGNORECASE)


class EmojiInfo(NamedTuple):
    """Everything the built-in pack knows about one emoji."""

    key: str
    char: str
    name: str
    shortcode: str
    group: str
    keywords: tuple[str, ...]
    base: str = ""


def emoji_slug(name: str) -> str:
    """The shortcode a name reduces to; rows store theirs only when it differs."""
    return _SLUG.sub("_", name.lower()).strip("_")


def _char(key: str) -> str:
    return "".join(chr(int(h, 16)) for h in key.split("-"))


_table: tuple[dict[str, EmojiInfo], dict[str, str], dict[str, str]] | None = None


def _load() -> tuple[dict[str, EmojiInfo], dict[str, str], dict[str, str]]:
    """Built on first use, so importing hqtui costs nothing until someone asks."""
    global _table
    if _table is not None:
        return _table
    by_key: dict[str, EmojiInfo] = {}
    for key, short, name, group, keywords in OPENEMOJI_ROWS:
        by_key[key] = EmojiInfo(
            key,
            _char(key),
            name,
            "oe_" + (short or emoji_slug(name)),
            OPENEMOJI_GROUPS[group] if group < len(OPENEMOJI_GROUPS) else "",
            tuple(keywords.split()) if keywords else (),
        )
    for key, base_key in OPENEMOJI_TONED:
        base = by_key.get(base_key)
        if base is None:
            continue
        tones = [_TONES.index(cp) for cp in key.split("-") if cp in _TONES]
        names = ", ".join(f"{_TONE_NAMES[t]} skin tone" for t in tones)
        sep = ", " if ":" in base.name else ": "
        by_key[key] = EmojiInfo(
            key,
            _char(key),
            f"{base.name}{sep}{names}",
            base.shortcode + "_" + "_".join(f"t{t + 1}" for t in tones),
            base.group,
            base.keywords,
            base_key,
        )
    by_name: dict[str, str] = {}
    by_char: dict[str, str] = {}
    for key in sorted(by_key):
        e = by_key[key]
        by_name[e.shortcode] = key
        by_name[e.shortcode[3:]] = key
        by_name[e.name.lower()] = key
        by_char[e.char] = key
        by_char[e.char.replace("️", "")] = key
    for alias, key in OPENEMOJI_ALIASES.items():
        by_name.setdefault(alias, key)
    _table = (by_key, by_name, by_char)
    return _table


def emoji_info(name: str) -> EmojiInfo | None:
    """Everything known about an emoji, by any name it answers to, or ``None``."""
    by_key, by_name, by_char = _load()
    trimmed = name.strip()
    bare = trimmed.strip(":").lower()
    key = (
        by_name.get(bare)
        or by_name.get(re.sub(r"[\s-]+", "_", bare))
        or by_char.get(trimmed)
        or by_char.get(trimmed.replace("️", ""))
        or (bare if bare in by_key else None)
    )
    return by_key.get(key) if key else None


_chosen: EmojiMode | None = None


def set_emoji_mode(mode: EmojiMode | None) -> None:
    """Pin emoji or text for the whole app, or ``None`` to detect again."""
    global _chosen
    if mode is not None and mode not in _MODES:
        raise ValueError(f"emoji mode must be one of {_MODES}, got {mode!r}")
    _chosen = mode


def emoji_mode(env: Mapping[str, str] | None = None) -> EmojiMode:
    """What an environment gets, in the order in this module's docstring."""
    if _chosen is not None:
        return _chosen
    env = os.environ if env is None else env
    named = env.get("HQTUI_EMOJI", "")
    if named in _MODES:
        return named  # type: ignore[return-value]
    # The Linux virtual console speaks UTF-8 but its font has no emoji.
    if env.get("TERM") == "linux":
        return "text"
    return "emoji" if _detect_unicode(env, sys.platform == "win32") else "text"


def emoji_text(name: str) -> str:
    """An emoji as text: an emoticon, or its name in brackets."""
    e = emoji_info(name)
    if e is None:
        return ""
    return OPENEMOJI_EMOTICONS.get(e.key) or OPENEMOJI_EMOTICONS.get(e.base, "") or f"[{e.name}]"


def emoji(name: str, mode: EmojiMode | None = None) -> str:
    """The emoji, or its text where the terminal cannot draw it. Unknown names give ``""``."""
    e = emoji_info(name)
    if e is None:
        return ""
    return e.char if (mode or emoji_mode()) == "emoji" else emoji_text(e.key)


def emojify(text: str, mode: EmojiMode | None = None) -> str:
    """Replace every ``:name:``; anything between colons that is not an emoji stays."""
    return _EMOJIFY.sub(lambda m: emoji(m.group(1), mode) or m.group(0), text)


def emoji_search(query: str, limit: int = 20) -> list[EmojiInfo]:
    """Emoji matching every word of the query, best first."""
    by_key, _, _ = _load()
    q = query.strip().strip(":").lower()
    if not q:
        return []
    words = [w for w in re.split(r"[\s_]+", q) if w]
    exact = emoji_info(q)
    hits: list[tuple[int, int, EmojiInfo]] = []
    for key in sorted(by_key):
        e = by_key[key]
        if e.base:
            continue
        hay = f"{e.name} {e.shortcode} {' '.join(e.keywords)}".lower()
        if not all(w in hay for w in words):
            continue
        name = e.name.lower()
        if exact is not None and e.key == exact.key:
            score = 0
        elif q in _SLUG.split(name):
            score = 1
        elif name.startswith(q):
            score = 2
        elif q in name:
            score = 3
        else:
            score = 4
        hits.append((score, len(e.name), e))
    hits.sort(key=lambda h: (h[0], h[1]))
    return [h[2] for h in hits[:limit]]


def emoji_names() -> list[str]:
    """Every shortcode in the built-in pack, sorted."""
    by_key, _, _ = _load()
    return sorted(e.shortcode for e in by_key.values())


OPEN_EMOJI = {"name": "OpenEmoji", "version": OPENEMOJI_VERSION, "unicode": OPENEMOJI_UNICODE}
