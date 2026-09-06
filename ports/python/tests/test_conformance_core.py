"""Replays the shared conformance fixtures, which are generated from the
TypeScript reference implementation.

A failure here means this port and the reference disagree about something
observable — which is a bug in one of them, never an acceptable difference.

Regenerate the fixtures with ``bun ports/conformance/generate.ts``.
"""

from __future__ import annotations

import unittest

from hqtui import ansi
from hqtui.buffer import FrameBuffer
from hqtui.capabilities import ColorDepth
from hqtui.color import Color, Gradient, from_256
from hqtui.diff import Encoder
from hqtui.layout import Constraint, Direction, Rect, solve, stack
from hqtui.theme import THEMES, elevate, heat_color, resolve_theme, series_color
from hqtui.unicode import (
    CLUSTER_BASE,
    CONTINUATION,
    cell_text,
    char_width,
    fit,
    graphemes,
    string_width,
    strip_unsafe,
    truncate,
    wrap,
)

from .support import (
    apply_ops,
    approx,
    assert_buffer,
    color_of,
    fixture,
    rect_of,
)


class TestColor(unittest.TestCase):
    def test_matches_reference(self):
        f = fixture("color")

        for c in f["hex"]:
            self.assertEqual(Color.hex(c["input"]), c["color"], f"hex({c['input']!r})")
        for c in f["hexNumber"]:
            self.assertEqual(Color.hex(c["input"]), c["color"])
        for c in f["rgb"]:
            self.assertEqual(Color.rgb(c["r"], c["g"], c["b"]), c["color"])
        for c in f["ansi256"]:
            self.assertEqual(Color.ansi256(c["index"]), c["color"])
        self.assertEqual(Color(0), f["defaultColor"])

        for c in [*f["mix"], *f["mixDefault"]]:
            got = color_of(c["a"]).mix(color_of(c["b"]), c["t"])
            self.assertEqual(got, c["out"], f"mix({c['a']}, {c['b']}, {c['t']})")
        for c in f["alpha"]:
            self.assertEqual(color_of(c["fg"]).alpha(color_of(c["bg"]), c["a"]), c["out"])
        for c in f["lighten"]:
            self.assertEqual(color_of(c["c"]).lighten(c["amount"]), c["out"])
        for c in f["darken"]:
            self.assertEqual(color_of(c["c"]).darken(c["amount"]), c["out"])
        for c in f["luminance"]:
            approx(self, color_of(c["c"]).luminance(), c["out"], "luminance")
        for c in f["contrast"]:
            approx(self, color_of(c["a"]).contrast(color_of(c["b"])), c["out"], "contrast")
        for c in f["grayscale"]:
            self.assertEqual(color_of(c["c"]).grayscale(), c["out"])
        self.assertEqual(Color(0).grayscale(), f["grayscaleDefault"])

        for c in f["to256"]:
            self.assertEqual(color_of(c["c"]).to_256(), c["out"], f"to256({c['c']})")
        for c in f["to16"]:
            self.assertEqual(color_of(c["c"]).to_16(), c["out"], f"to16({c['c']})")
        for c in f["from256"]:
            self.assertEqual(from_256(c["index"]), c["out"], f"from256({c['index']})")

        g = f["gradient"]
        gradient = Gradient([color_of(s) for s in g["stops"]])
        for s in g["samples"]:
            self.assertEqual(gradient.sample(s["t"]), s["out"], f"gradient({s['t']})")
        for i, want in enumerate(g["steps"]):
            self.assertEqual(gradient.steps(len(g["steps"]))[i], want, f"step {i}")
        self.assertEqual(Gradient([Color.hex(0xFF0000)]).sample(0.5), g["single"])
        self.assertEqual(Gradient([]).sample(0.5), g["empty"])


class TestUnicode(unittest.TestCase):
    def test_matches_reference(self):
        f = fixture("unicode")

        for c in f["charWidth"]:
            self.assertEqual(char_width(c["cp"]), c["width"], f"charWidth(U+{c['cp']:04X})")
        for c in f["stringWidth"]:
            self.assertEqual(string_width(c["s"]), c["width"], f"stringWidth({c['s']!r})")
        for c in f["truncate"]:
            self.assertEqual(
                truncate(c["s"], c["max"]), c["out"], f"truncate({c['s']!r}, {c['max']})"
            )
        for c in f["truncateCustomEllipsis"]:
            self.assertEqual(truncate(c["s"], c["max"], c["ellipsis"]), c["out"])
        for c in f["fit"]:
            self.assertEqual(
                fit(c["s"], c["w"], c["align"]),
                c["out"],
                f"fit({c['s']!r}, {c['w']}, {c['align']})",
            )
        for c in f["wrap"]:
            self.assertEqual(
                wrap(c["s"], c["width"]), c["out"], f"wrap({c['s']!r}, {c['width']})"
            )
        for c in f["stripUnsafe"]:
            self.assertEqual(strip_unsafe(c["s"]), c["out"])
        for c in f["graphemes"]:
            cells = graphemes(c["s"])
            self.assertEqual(len(cells), len(c["cells"]), f"graphemes({c['s']!r}) count")
            for i, w in enumerate(c["cells"]):
                self.assertEqual(cells[i].width, w["width"], f"grapheme {i} width")
                self.assertEqual(
                    cells[i].value >= CLUSTER_BASE, w["cluster"], f"grapheme {i} clustered"
                )
                self.assertEqual(cell_text(cells[i].value), w["text"], f"grapheme {i} text")

        self.assertEqual(CLUSTER_BASE, f["constants"]["clusterBase"])
        self.assertEqual(CONTINUATION, f["constants"]["continuation"])


class TestAnsi(unittest.TestCase):
    def test_matches_reference(self):
        f = fixture("ansi")
        for c in f["stripAnsi"]:
            self.assertEqual(ansi.strip_ansi(c["s"]), c["out"], f"strip_ansi({c['s']!r})")
        for c in f["moveTo"]:
            self.assertEqual(ansi.move_to(c["x"], c["y"]), c["out"])
        for c in f["setTitle"]:
            self.assertEqual(ansi.set_title(c["title"]), c["out"])


def _constraint(d: dict) -> Constraint:
    return Constraint(
        size=d.get("size"),
        min=d.get("min"),
        max=d.get("max"),
        intrinsic=d.get("intrinsic"),
    )


class TestLayout(unittest.TestCase):
    def test_matches_reference(self):
        f = fixture("layout")

        for c in f["solve"]:
            items = [_constraint(i) for i in c["items"]]
            self.assertEqual(
                solve(c["total"], items, c["gap"]),
                c["out"],
                f"solve(total={c['total']}, gap={c['gap']})",
            )

        for c in f["stack"]:
            items = [_constraint(i) for i in c["items"]]
            direction = Direction.ROW if c["direction"] == "row" else Direction.COLUMN
            got = stack(rect_of(c["rect"]), items, direction, c["gap"])
            self.assertEqual(got, [rect_of(r) for r in c["out"]], f"stack {c['direction']}")

        for c in f["inset"]:
            padding = c["padding"]
            if isinstance(padding, list):
                padding = tuple(padding)
            self.assertEqual(rect_of(c["rect"]).inset(padding), rect_of(c["out"]))

        for c in f["intersect"]:
            self.assertEqual(
                rect_of(c["a"]).intersect(rect_of(c["b"])), rect_of(c["out"])
            )


class TestBuffer(unittest.TestCase):
    def test_matches_reference(self):
        for case in fixture("buffer"):
            buffer = FrameBuffer(case["width"], case["height"])
            apply_ops(buffer, case["ops"])
            assert_buffer(self, buffer, case["result"], case["name"])


class TestDiff(unittest.TestCase):
    def test_matches_reference(self):
        for case in fixture("diff"):
            name = case["name"]
            prev = FrameBuffer(case["width"], case["height"])
            nxt = FrameBuffer(case["width"], case["height"])
            apply_ops(prev, case["before"])
            apply_ops(nxt, case["after"])

            encoder = Encoder(ColorDepth(case["colors"]), case.get("monochrome", False))
            got = encoder.encode(prev, nxt, case["full"])
            want = case["result"]

            self.assertEqual(got.output, want["output"], f"{name}: output")
            self.assertEqual(got.changed_cells, want["changedCells"], f"{name}: changedCells")
            self.assertEqual(got.dirty_rows, want["dirtyRows"], f"{name}: dirtyRows")


class TestTheme(unittest.TestCase):
    def test_matches_reference(self):
        f = fixture("theme")

        for entry in f["themes"]:
            key, want = entry["key"], entry["theme"]
            t = resolve_theme(key)
            self.assertEqual(t.name, want["name"], f"{key}: name")
            self.assertEqual(t.dark, want["dark"], f"{key}: dark")
            for field, got in (
                ("background", t.background), ("surface", t.surface),
                ("foreground", t.foreground), ("muted", t.muted),
                ("primary", t.primary), ("secondary", t.secondary), ("accent", t.accent),
                ("success", t.success), ("warning", t.warning),
                ("danger", t.danger), ("info", t.info),
                ("border", t.border), ("borderFocused", t.border_focused),
                ("title", t.title), ("selection", t.selection),
                ("selectionText", t.selection_text), ("cursor", t.cursor),
            ):
                self.assertEqual(got, want[field], f"{key}: {field}")
            self.assertEqual(list(t.graph), want["graph"], f"{key}: graph")
            self.assertEqual(list(t.heat), want["heat"], f"{key}: heat")

        for c in f["resolve"]:
            self.assertEqual(
                resolve_theme(c["name"]).name, c["resolved"], f"resolve({c['name']!r})"
            )
        for c in f["elevate"]:
            self.assertEqual(
                elevate(resolve_theme(c["theme"]), c["amount"]), c["out"], f"elevate({c['theme']})"
            )
        for c in f["heatColor"]:
            self.assertEqual(
                heat_color(resolve_theme(c["theme"]), c["ratio"]), c["out"],
                f"heat_color({c['theme']})",
            )
        for c in f["seriesColor"]:
            self.assertEqual(
                series_color(resolve_theme(c["theme"]), c["index"]), c["out"],
                f"series_color({c['theme']}, {c['index']})",
            )


if __name__ == "__main__":
    unittest.main()
