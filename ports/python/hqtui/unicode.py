"""Terminal text is a grid of columns, not a string.

Getting width wrong corrupts every cell to the right of the mistake, so width
lives behind this one module.

One difference from the TypeScript reference is worth stating plainly: a Python
``str`` holds codepoints, not UTF-16 units, so the unpaired-surrogate handling
the reference needs cannot arise from ordinary input. Everything else — the
width tables, the cluster rules, the unsafe-codepoint policy — is identical, and
the conformance suite checks it.
"""

from __future__ import annotations

import threading
from bisect import bisect_right
from enum import Enum
from typing import NamedTuple

__all__ = [
    "Align",
    "CLUSTER_BASE",
    "CONTINUATION",
    "REPLACEMENT",
    "Grapheme",
    "cell_text",
    "cell_width",
    "char_width",
    "fit",
    "graphemes",
    "intern_cluster",
    "is_bidi_control",
    "is_control",
    "is_unsafe_codepoint",
    "string_width",
    "strip_unsafe",
    "truncate",
    "wrap",
]

CLUSTER_BASE = 0x110000
"""Values at or above this are indices into the cluster table, not codepoints."""

CONTINUATION = 0xFFFFFFFF
"""Written into the cell after a double-width character. Never drawn."""

REPLACEMENT = 0xFFFD
"""What an unrepresentable codepoint is shown as: one column, cannot fuse."""


def is_control(cp: int) -> bool:
    """C0, DEL and C1.

    A cell holding one of these would be written straight back out by the
    encoder, so untrusted text could steer the terminal instead of filling a
    cell.
    """
    return cp < 0x20 or 0x7F <= cp <= 0x9F


def is_bidi_control(cp: int) -> bool:
    """Bidi overrides, embeddings and isolates: the Trojan Source set
    (CVE-2021-42574).

    They emit no glyph but reorder everything around them, so ``user<RLO>nimda``
    reads as ``user admin`` in a log pane. Directional *marks* (LRM/RLM) and real
    RTL script are left alone — those render honestly.
    """
    return 0x202A <= cp <= 0x202E or 0x2066 <= cp <= 0x2069


def is_unsafe_codepoint(cp: int) -> bool:
    """Anything that must never occupy a cell, because it steers rather than draws.

    This runs per cell on the write path and per codepoint on the measure path,
    so it is one small branch ladder rather than two calls. Printable ASCII —
    overwhelmingly the common case — exits on the second comparison.
    """
    if cp < 0x20:
        return True
    if cp < 0x7F:
        return False
    if cp <= 0x9F:
        return True
    if cp < 0x202A or cp > 0x2069:
        return False
    return cp <= 0x202E or cp >= 0x2066


def strip_unsafe(text: str) -> str:
    """Strip everything that steers the terminal rather than drawing."""
    return "".join(c for c in text if not is_unsafe_codepoint(ord(c)))


_MAX_CLUSTER_CODEPOINTS = 16
"""A cell may hold at most this many codepoints.

Real ZWJ emoji top out around ten; anything longer is a byte-amplification bomb,
because the cell still claims one column while painting hundreds.
"""

_MAX_CLUSTERS = 32768
"""How many distinct clusters may be interned.

Clusters are interned for the life of the process — a cell holds an index into
this table, so entries can never be evicted while a framebuffer might still
reference them. Untrusted text must therefore not be able to grow it without
bound. Past this many, ``intern_cluster`` degrades to the base codepoint: the
combining marks or emoji joins are dropped, but the cell keeps the correct
width, so the grid stays in step with the screen.
"""

_cluster_texts: list[str] = []
_cluster_ids: dict[str, int] = {}
_cluster_lock = threading.Lock()


def intern_cluster(text: str) -> int:
    """Fold a multi-codepoint grapheme (emoji, combining sequence) into one cell.

    Unsafe codepoints are stripped here as well as in :func:`graphemes`, so no
    caller can smuggle one into a cell.
    """
    safe = strip_unsafe(text) or " "
    # The GIL makes the read safe without the lock; the write still needs it.
    existing = _cluster_ids.get(safe)
    if existing is not None:
        return existing
    with _cluster_lock:
        existing = _cluster_ids.get(safe)
        if existing is not None:
            return existing
        if len(_cluster_texts) >= _MAX_CLUSTERS:
            # Degrade to the base character rather than grow the table for ever.
            first = ord(safe[0])
            return first if char_width(first) > 0 else 32
        value = CLUSTER_BASE + len(_cluster_texts)
        _cluster_texts.append(safe)
        _cluster_ids[safe] = value
        return value


def cluster_text(value: int) -> str:
    i = value - CLUSTER_BASE
    if 0 <= i < len(_cluster_texts):
        return _cluster_texts[i]
    return " "


def cell_text(value: int) -> str:
    """Render a cell value back to the text the terminal should receive."""
    if value >= CLUSTER_BASE and value != CONTINUATION:
        return cluster_text(value)
    if value == 0 or value == CONTINUATION:
        return " "
    return chr(value)


# Zero-width: combining marks, variation selectors, ZWJ, most format controls.
_ZERO_WIDTH = (
    (0x0300, 0x036F), (0x0483, 0x0489), (0x0591, 0x05BD), (0x0610, 0x061A),
    (0x064B, 0x065F), (0x0670, 0x0670), (0x06D6, 0x06DC), (0x0730, 0x074A),
    (0x07A6, 0x07B0), (0x0816, 0x0819), (0x08E3, 0x0903), (0x093A, 0x093C),
    (0x0951, 0x0957), (0x0E31, 0x0E31), (0x0E34, 0x0E3A), (0x0EB1, 0x0EB1),
    (0x1AB0, 0x1AFF), (0x1DC0, 0x1DFF), (0x200B, 0x200F), (0x2028, 0x202E),
    (0x2060, 0x2064), (0x2066, 0x2069), (0x20D0, 0x20F0), (0xFE00, 0xFE0F),
    (0xFE20, 0xFE2F),
    (0xFEFF, 0xFEFF), (0xE0100, 0xE01EF),
)

# Double-width: East Asian Wide/Fullwidth plus the emoji blocks terminals widen.
_WIDE = (
    (0x1100, 0x115F), (0x2E80, 0x303E), (0x3041, 0x33FF), (0x3400, 0x4DBF),
    (0x4E00, 0x9FFF), (0xA000, 0xA4CF), (0xA960, 0xA97F), (0xAC00, 0xD7A3),
    (0xF900, 0xFAFF), (0xFE10, 0xFE19), (0xFE30, 0xFE6F), (0xFF00, 0xFF60),
    (0xFFE0, 0xFFE6), (0x1F004, 0x1F004), (0x1F0CF, 0x1F0CF), (0x1F18E, 0x1F18E),
    (0x1F191, 0x1F19A), (0x1F200, 0x1F320), (0x1F32D, 0x1F335), (0x1F337, 0x1F37C),
    (0x1F37E, 0x1F393), (0x1F3A0, 0x1F3CA), (0x1F3CF, 0x1F3D3), (0x1F3E0, 0x1F3F0),
    (0x1F3F4, 0x1F3F4), (0x1F3F8, 0x1F43E), (0x1F440, 0x1F440), (0x1F442, 0x1F4FC),
    (0x1F4FF, 0x1F53D), (0x1F54B, 0x1F54E), (0x1F550, 0x1F567), (0x1F57A, 0x1F57A),
    (0x1F595, 0x1F596), (0x1F5A4, 0x1F5A4), (0x1F5FB, 0x1F64F), (0x1F680, 0x1F6C5),
    (0x1F6CC, 0x1F6CC), (0x1F6D0, 0x1F6D2), (0x1F6EB, 0x1F6EC), (0x1F910, 0x1F9FF),
    (0x20000, 0x2FFFD), (0x30000, 0x3FFFD),
)

# Extended_Pictographic, approximated to the ranges terminals actually join.
# ZWJ only glues emoji together; joining it to arbitrary text is how one cell
# ends up painting hundreds of columns.
_PICTOGRAPHIC = (
    (0x00A9, 0x00A9), (0x00AE, 0x00AE), (0x203C, 0x203C), (0x2049, 0x2049),
    (0x2122, 0x2122), (0x2139, 0x2139), (0x2194, 0x21AA), (0x231A, 0x23FA),
    (0x24C2, 0x24C2), (0x25AA, 0x25FE), (0x2600, 0x27BF), (0x2934, 0x2935),
    (0x2B00, 0x2BFF), (0x3030, 0x3030), (0x303D, 0x303D), (0x3297, 0x3299),
    (0x1F000, 0x1FAFF), (0x1FC00, 0x1FFFD),
)


def _index(ranges: tuple[tuple[int, int], ...]) -> tuple[list[int], list[int]]:
    """Split a range table into parallel lists, so ``bisect`` can search it."""
    return [lo for lo, _ in ranges], [hi for _, hi in ranges]


_ZERO_LO, _ZERO_HI = _index(_ZERO_WIDTH)
_WIDE_LO, _WIDE_HI = _index(_WIDE)
_PICT_LO, _PICT_HI = _index(_PICTOGRAPHIC)


def _in_ranges(cp: int, lows: list[int], highs: list[int]) -> bool:
    i = bisect_right(lows, cp) - 1
    return i >= 0 and cp <= highs[i]


def char_width(cp: int) -> int:
    """Columns a single codepoint occupies: 0, 1, or 2."""
    if cp == 0:
        return 0
    if cp < 32 or 0x7F <= cp < 0xA0:
        return 0
    if cp < 0x300:
        return 1
    if _in_ranges(cp, _ZERO_LO, _ZERO_HI):
        return 0
    if _in_ranges(cp, _WIDE_LO, _WIDE_HI):
        return 2
    return 1


def cell_width(value: int) -> int:
    """Columns a cell value occupies, handling interned clusters."""
    if value == CONTINUATION:
        return 0
    if value >= CLUSTER_BASE:
        text = cluster_text(value)
        return 2 if char_width(ord(text[0])) == 2 else 1
    return char_width(value)


_ZWJ = 0x200D


class Grapheme(NamedTuple):
    """One terminal cell's worth of text."""

    value: int
    """A bare codepoint, or an interned cluster id."""
    width: int


def graphemes(text: str) -> list[Grapheme]:
    """Split text into terminal cells.

    Combining marks, variation selectors and ZWJ sequences attach to the base
    character instead of stealing a column.
    """
    out: list[Grapheme] = []
    i = 0
    n = len(text)
    while i < n:
        cp = ord(text[i])
        size = 1
        width = char_width(cp)

        # An unsafe codepoint never reaches a cell: it would otherwise be
        # absorbed into the previous grapheme exactly like a combining mark and
        # re-emitted verbatim — escape injection. Every unsafe codepoint is
        # zero-width, so testing the width first means printable text never pays
        # for this check.
        if width == 0 and is_unsafe_codepoint(cp):
            i += 1
            continue

        # A cell paints one column but may hold several codepoints; cap how
        # many, so no input makes a single cell emit an unbounded run of glyphs.
        cluster_end = -1
        parts = 1
        while parts < _MAX_CLUSTER_CODEPOINTS:
            if i + size >= n:
                break
            nxt = ord(text[i + size])
            if nxt == _ZWJ:
                if i + size + 1 >= n:
                    break
                after = ord(text[i + size + 1])
                # ZWJ joins emoji, and nothing else. Joining it to arbitrary
                # text lets one cell claim a single column while painting
                # hundreds of them.
                if not _in_ranges(cp, _PICT_LO, _PICT_HI) or not _in_ranges(
                    after, _PICT_LO, _PICT_HI
                ):
                    break
                size += 2
                cluster_end = i + size
                parts += 2
                continue
            if char_width(nxt) != 0:
                break
            # Leave anything unsafe to the outer loop, which drops it.
            if is_unsafe_codepoint(nxt):
                break
            size += 1
            cluster_end = i + size
            parts += 1

        if width == 0:
            # A zero-width base: a combining mark with nothing to combine with,
            # or a stray ZWJ. It paints no column, so handing it one would walk
            # the cursor ahead of the screen. Drop it, and what it absorbed.
            pass
        elif cluster_end >= 0:
            out.append(Grapheme(intern_cluster(text[i:cluster_end]), width))
        else:
            out.append(Grapheme(cp, width))
        i += size
    return out


def string_width(text: str) -> int:
    """Display width of a string in terminal columns."""
    return sum(g.width for g in graphemes(text))


def drop_columns(text: str, columns: int) -> str:
    """``text`` with its first ``columns`` display columns removed.

    For scrolling a line sideways. Slicing by code points would cut inside a
    grapheme and corrupt it, and a scroll that lands in the middle of a wide
    character cannot draw half of it — what is left of that character is a
    space, which is what a terminal shows when a double-width cell is clipped.
    """
    if columns <= 0:
        return text
    out: list[str] = []
    skipped = 0
    for g in graphemes(text):
        if skipped >= columns:
            out.append(cell_text(g.value))
            continue
        skipped += g.width
        # A wide character straddling the cut leaves its trailing half behind.
        if skipped > columns:
            out.append(" " * (skipped - columns))
    return "".join(out)


def truncate(text: str, max_width: int, ellipsis: str = "…") -> str:
    """Truncate to ``max_width`` columns, appending an ellipsis when it does not fit."""
    if max_width <= 0:
        return ""
    if string_width(text) <= max_width:
        return text
    limit = max(0, max_width - string_width(ellipsis))
    parts: list[str] = []
    w = 0
    for g in graphemes(text):
        if w + g.width > limit:
            break
        parts.append(cell_text(g.value))
        w += g.width
    return "".join(parts) + ellipsis


class Align(str, Enum):
    """Horizontal placement within a fixed width.

    A ``str`` enum so the reference's own spelling — ``"left"``, ``"center"``,
    ``"right"`` — works anywhere an ``Align`` is expected.
    """

    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"


def fit(text: str, width: int, align: "Align | str" = Align.LEFT) -> str:
    """Pad or truncate to exactly ``width`` columns."""
    t = truncate(text, width)
    pad = width - string_width(t)
    if pad <= 0:
        return t
    if align == Align.RIGHT:
        return " " * pad + t
    if align == Align.CENTER:
        left = pad // 2
        return " " * left + t + " " * (pad - left)
    return t + " " * pad


# JavaScript's `\s`, which is not quite Python's str.isspace(): it excludes
# U+0085 and includes U+FEFF. Spelled by codepoint so the set survives being
# read, copied and diffed.
_JS_SPACE = frozenset(
    chr(cp)
    for cp in (
        0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0,
        0x1680,
        0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
        0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
        0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
    )
)


def _trim_end(s: str) -> str:
    """``String.prototype.trimEnd``, over the same whitespace set."""
    i = len(s)
    while i > 0 and s[i - 1] in _JS_SPACE:
        i -= 1
    return s[:i]


def _split_keeping_whitespace(text: str) -> list[str]:
    """``split(/(\\s+)/)``: separators are kept as their own entries, which is
    what makes the wrap below preserve interior spacing."""
    if not text:
        return [""]
    out: list[str] = []
    start = 0
    in_space: bool | None = None
    for i, ch in enumerate(text):
        space = ch in _JS_SPACE
        if in_space is None:
            in_space = space
        elif in_space != space:
            out.append(text[start:i])
            start = i
            in_space = space
    out.append(text[start:])
    return out


def wrap(text: str, width: int) -> list[str]:
    """Greedy word wrap at ``width`` columns."""
    if width <= 0:
        return []
    lines: list[str] = []
    for paragraph in text.split("\n"):
        line: list[str] = []
        line_w = 0
        for word in _split_keeping_whitespace(paragraph):
            if word == "":
                continue
            w = string_width(word)
            if line_w + w > width and line_w > 0:
                lines.append(_trim_end("".join(line)))
                line, line_w = [], 0
                if all(c in _JS_SPACE for c in word):
                    continue
            if w > width:
                # A single word longer than the line: hard-split it.
                for g in graphemes(word):
                    if line_w + g.width > width:
                        lines.append("".join(line))
                        line, line_w = [], 0
                    line.append(cell_text(g.value))
                    line_w += g.width
                continue
            line.append(word)
            line_w += w
        lines.append(_trim_end("".join(line)))
    return lines


def utf16_length(s: str) -> int:
    """Count UTF-16 code units, which is what the reference's ``String.length``
    means. It only matters in one place — whether a key name is long enough to
    carry a shift modifier — but matching it exactly costs nothing."""
    return sum(2 if ord(c) > 0xFFFF else 1 for c in s)
