"""Conformance for the drawing layer: the Braille canvas, the block-element
ramps, and ``Surface.box``, which every panel in the library goes through."""

from __future__ import annotations

import unittest

from hqtui.graphics import BrailleCanvas, horizontal_glyph, shade_glyph, vertical_glyph
from hqtui.surface import BorderStyle, BoxOptions

from .support import assert_buffer, fixture, rect_of, scene


class TestBraille(unittest.TestCase):
    def test_matches_reference(self):
        for case in fixture("braille"):
            name = case["name"]
            canvas = BrailleCanvas(case["cols"], case["rows"])

            for op in case["ops"]:
                kind = op["op"]
                points = [tuple(p) for p in op.get("points", ())]
                if kind == "pixel":
                    canvas.pixel(op["x"], op["y"])
                elif kind == "unset":
                    canvas.unset(op["x"], op["y"])
                elif kind == "line":
                    canvas.line(op["x0"], op["y0"], op["x1"], op["y1"])
                elif kind == "hline":
                    canvas.hline(op["y"], op["x0"], op["x1"])
                elif kind == "vline":
                    canvas.vline(op["x"], op["y0"], op["y1"])
                elif kind == "rect":
                    canvas.rect(op["x0"], op["y0"], op["x1"], op["y1"])
                elif kind == "fillRect":
                    canvas.fill_rect(op["x0"], op["y0"], op["x1"], op["y1"])
                elif kind == "circle":
                    canvas.circle(op["cx"], op["cy"], op["r"])
                elif kind == "polyline":
                    canvas.polyline(points)
                elif kind == "fillUnder":
                    canvas.fill_under(points, op["baseline"])
                else:  # pragma: no cover
                    self.fail(f"unknown braille op {kind!r}")

            got = [
                canvas.cell(col, row)
                for row in range(canvas.rows)
                for col in range(canvas.cols)
            ]
            self.assertEqual(got, case["cells"], f"{name}: cells")
            self.assertEqual(canvas.to_lines(), case["lines"], f"{name}: lines")


class TestBlocks(unittest.TestCase):
    def test_matches_reference(self):
        f = fixture("blocks")
        for c in f["verticalGlyph"]:
            self.assertEqual(
                vertical_glyph(c["ratio"], c["mode"]), c["out"],
                f"vertical_glyph({c['ratio']}, {c['mode']})",
            )
        for c in f["horizontalGlyph"]:
            self.assertEqual(
                horizontal_glyph(c["ratio"], c["mode"]), c["out"],
                f"horizontal_glyph({c['ratio']}, {c['mode']})",
            )
        for c in f["shadeGlyph"]:
            self.assertEqual(
                shade_glyph(c["ratio"], c["unicode"]), c["out"],
                f"shade_glyph({c['ratio']}, {c['unicode']})",
            )


class TestSurfaceBox(unittest.TestCase):
    def test_matches_reference(self):
        for case in fixture("surface"):
            name = case["name"]
            buffer, surface = scene(case["width"], case["height"], case["theme"])
            spec = case["box"]
            options = BoxOptions(
                title=spec.get("title", ""),
                subtitle=spec.get("subtitle", ""),
                footer=spec.get("footer", ""),
                border=BorderStyle(spec.get("border", "rounded")),
                title_align=spec.get("titleAlign", "left"),
            )
            inner = surface.box(options)
            self.assertEqual(inner.rect, rect_of(case["innerRect"]), f"{name}: inner rect")
            assert_buffer(self, buffer, case["result"], name)


if __name__ == "__main__":
    unittest.main()
