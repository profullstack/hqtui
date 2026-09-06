"""Fixture loading for the conformance suite.

The package has no dependencies and the tests keep it that way, so this is the
standard library's ``json`` and ``unittest`` and nothing else.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Iterable

from hqtui.buffer import FrameBuffer, Style
from hqtui.color import Color
from hqtui.layout import Rect
from hqtui.surface import Surface
from hqtui.theme import resolve_theme
from hqtui.unicode import CLUSTER_BASE, CONTINUATION, cell_text

FIXTURES = Path(__file__).resolve().parents[2] / "conformance" / "fixtures"


def fixture(name: str) -> Any:
    path = FIXTURES / f"{name}.json"
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def color_of(v: Any) -> Color:
    return Color(int(v))


def opt_color(d: dict, key: str) -> Color | None:
    v = d.get(key)
    return None if v is None else Color(int(v))


def rect_of(d: dict) -> Rect:
    return Rect(d["x"], d["y"], d["width"], d["height"])


def style_of(op: dict) -> Style:
    return Style(
        fg=opt_color(op, "fg"),
        bg=opt_color(op, "bg"),
        attrs=op.get("attrs"),
    )


def apply_ops(buffer: FrameBuffer, ops: Iterable[dict]) -> None:
    for op in ops:
        style = style_of(op)
        kind = op["op"]
        if kind == "write":
            buffer.write(
                op["x"], op["y"], op["text"], style, op.get("maxWidth", 1 << 30)
            )
        elif kind == "setCell":
            buffer.set_cell(op["x"], op["y"], op["value"], style)
        elif kind == "fillRect":
            buffer.fill_rect(op["x"], op["y"], op["w"], op["h"], op["ch"], style)
        elif kind == "styleRect":
            buffer.style_rect(op["x"], op["y"], op["w"], op["h"], style)
        elif kind == "clear":
            buffer.clear(Color(op.get("bg") or 0), Color(op.get("fg") or 0))
        else:  # pragma: no cover - a fixture would have to be malformed
            raise AssertionError(f"unknown buffer op {kind!r}")


def scene(width: int, height: int, theme_name: str = "dark") -> tuple[FrameBuffer, Surface]:
    """A framebuffer plus a root surface over it, cleared to the theme the way
    the renderer does before any widget draws."""
    theme = resolve_theme(theme_name)
    buffer = FrameBuffer(width, height)
    buffer.clear(theme.background, theme.foreground)
    return buffer, Surface.root(buffer, theme)


def decode_rle(plane: list) -> list[int]:
    """Expand a run-length encoded plane, ``[[count, value], …]``."""
    out: list[int] = []
    for count, value in plane:
        out.extend([value] * count)
    return out


def assert_buffer(case, buffer: FrameBuffer, want: dict, what: str) -> None:
    """Compare a rendered buffer against a fixture's run-length encoded planes."""
    case.assertEqual((buffer.width, buffer.height), (want["width"], want["height"]), f"{what}: size")

    n = buffer.width * buffer.height
    chars = decode_rle(want["chars"])
    fg = decode_rle(want["fg"])
    bg = decode_rle(want["bg"])
    attrs = decode_rle(want["attrs"])
    case.assertEqual(len(chars), n, f"{what}: fixture cell count")

    # Text first: when a port drifts, the row text says *what* is wrong in one
    # line, where a cell index only says where.
    for y, want_row in enumerate(want["text"]):
        case.assertEqual(buffer.row_text(y), want_row, f"{what}: row {y}")

    # A cluster's cell value indexes the interning process's own table, so the
    # fixture renumbers them by first appearance. Rebuild the same numbering
    # here, and check the cluster texts line up too.
    local: list[int] = []

    def renumber(value: int) -> int:
        if value < CLUSTER_BASE or value == CONTINUATION:
            return value
        if value not in local:
            local.append(value)
        return CLUSTER_BASE + local.index(value)

    for i in range(n):
        x, y = i % buffer.width, i // buffer.width
        case.assertEqual(renumber(buffer.chars[i]), chars[i], f"{what}: char at {x},{y}")
        case.assertEqual(buffer.fg[i], fg[i], f"{what}: fg at {x},{y}")
        case.assertEqual(buffer.bg[i], bg[i], f"{what}: bg at {x},{y}")
        case.assertEqual(buffer.attrs[i], attrs[i], f"{what}: attrs at {x},{y}")

    want_clusters = want["clusters"]
    case.assertEqual(len(local), len(want_clusters), f"{what}: cluster count")
    for i, value in enumerate(local):
        case.assertEqual(cell_text(value), want_clusters[i], f"{what}: cluster {i}")


def approx(case, got: float, want: float, what: str) -> None:
    if math.isnan(got) and math.isnan(want):
        return
    case.assertAlmostEqual(got, want, places=9, msg=what)
