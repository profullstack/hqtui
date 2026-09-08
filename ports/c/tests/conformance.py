"""Replay shared TypeScript fixtures against the compiled C library.

Python/ctypes are test tooling only; neither the library nor consumers need them.
No new expected cells are derived from the implementation under test.
"""
import ctypes as C
import json
from pathlib import Path
import sys
import unittest

LIB = C.CDLL(sys.argv.pop(1))
FIXTURES = Path(__file__).resolve().parents[2] / "conformance" / "fixtures"
U = C.c_uint32
I = C.c_int
Z = C.c_size_t
D = C.c_double
P = C.c_void_p
S = C.c_char_p

class Style(C.Structure):
    _fields_ = [("fg", U), ("bg", U), ("attrs", C.c_uint16), ("mask", C.c_uint16)]

class Cell(C.Structure):
    _fields_ = [("value", U), ("fg", U), ("bg", U), ("attrs", C.c_uint16)]

class Rect(C.Structure):
    _fields_ = [(k, I) for k in ("x", "y", "width", "height")]

class Constraint(C.Structure):
    _fields_ = [("kind", I), ("value", D), ("min", I), ("max", I), ("intrinsic", I)]

class Encoded(C.Structure):
    _fields_ = [("data", P), ("length", Z), ("changed_cells", Z), ("dirty_rows", Z)]

THEME_COLORS = ("background surface foreground muted primary secondary accent success warning danger info "
                "border borderFocused title selection selectionText cursor").split()

class Theme(C.Structure):
    _fields_ = [("name", S), ("dark", I)] + [(k, U) for k in THEME_COLORS] + [
        ("graph", U * 8), ("heat", U * 8), ("graph_count", Z), ("heat_count", Z)]

class Surface(C.Structure):
    _fields_ = [("buffer", P), ("theme", C.POINTER(Theme)), ("rect", Rect), ("clip", Rect)]

class Box(C.Structure):
    # Mirrors hq_box_options field for field. ctypes passes this by value, so a
    # field missing here shifts every one after it and the C side reads whatever
    # happens to be next on the stack.
    _fields_ = [("border", I), ("title_align", I), ("no_fill", I), ("sides", I), ("collapse", I)] + [
        (k, Style) for k in ("border_style", "title_style", "subtitle_style", "footer_style")] + [
        ("background", U), ("has_background", I), ("title", S), ("subtitle", S), ("footer", S)]

def bind(name, result, *args):
    fn = getattr(LIB, "hq_" + name)
    fn.restype, fn.argtypes = result, args
    return fn

rgb = bind("rgb", U, I, I, I)
hex_color = bind("hex", U, S)
indexed = bind("indexed", U, I)
from256 = bind("from256", U, I)
to256 = bind("to256", I, U)
to16 = bind("to16", I, U)
mix = bind("mix", U, U, U, D)
gray = bind("grayscale", U, U)
luminance = bind("luminance", D, U)
contrast = bind("contrast", D, U, U)
gradient = bind("gradient", U, C.POINTER(U), Z, D)
char_width = bind("char_width", I, U)
text_width = bind("text_width_n", Z, S, Z)
create = bind("buffer_create", P, I, I)
destroy = bind("buffer_destroy", None, P)
clear = bind("buffer_clear", None, P, U, U)
write = bind("buffer_write_n", Z, P, I, I, S, Z, Style, Z)
set_cell = bind("buffer_set", I, P, I, I, U, Style)
fill = bind("buffer_fill", None, P, Rect, U, Style)
restyle = bind("buffer_style", None, P, Rect, Style)
cell = bind("buffer_cell", I, P, I, I, C.POINTER(Cell))
cell_text = bind("buffer_cell_text", S, P, I, I, P)
row = bind("buffer_row", Z, P, I, P, Z)
copy = bind("buffer_copy", I, P, P)
resize = bind("buffer_resize", I, P, I, I)
solve = bind("solve", I, I, C.POINTER(Constraint), Z, I, C.POINTER(I))
stack = bind("stack", I, Rect, C.POINTER(Constraint), Z, I, I, C.POINTER(Rect))
encoder = bind("encoder_create", P, I, I)
encoder_destroy = bind("encoder_destroy", None, P)
encode = bind("encode", I, P, P, P, I, C.POINTER(Encoded))
theme_at = bind("theme_at", C.POINTER(Theme), Z)
theme_count = bind("theme_count", Z)
surface_root = bind("surface_root", Surface, P, C.POINTER(Theme))
surface_box = bind("surface_box", Surface, Surface, Box)

def fixture(name):
    return json.loads((FIXTURES / (name + ".json")).read_text())

def style(op):
    return Style(op.get("fg", 0), op.get("bg", 0), op.get("attrs", 0),
                 sum(bit for bit, k in ((1, "fg"), (2, "bg"), (4, "attrs")) if k in op))

def apply(buffer, ops):
    for op in ops:
        kind = op["op"]
        s = style(op)
        x, y = op.get("x", 0), op.get("y", 0)
        if kind == "write":
            data = op["text"].encode()
            write(buffer, x, y, data, len(data), s, op.get("maxWidth", 2**32))
        elif kind == "setCell":
            set_cell(buffer, x, y, op["value"], s)
        elif kind == "clear":
            clear(buffer, op.get("bg", 0), op.get("fg", 0))
        elif kind in ("fillRect", "styleRect"):
            r = Rect(x, y, op["w"], op["h"])
            if kind == "fillRect":
                fill(buffer, r, op.get("ch", 32), s)
            else:
                restyle(buffer, r, s)
        else:
            raise AssertionError("unhandled fixture operation: " + kind)

def constraint(item):
    value = item.get("size", "auto")
    kind, n = 0, 0
    if isinstance(value, (int, float)):
        n = value
    elif value in ("auto", "fill"):
        kind = 3 if value == "auto" else 4
    elif value.endswith("fr"):
        kind, n = 2, float(value[:-2])
    elif value.endswith("%"):
        kind, n = 1, float(value[:-1])
    else:
        n = float(value)
    return Constraint(kind, n, item.get("min", 0), item.get("max", -1), item.get("intrinsic", 0))

class Conformance(unittest.TestCase):
    def test_color(self):
        data = fixture("color")
        calls = {
            "hex": lambda r: hex_color(r["input"].encode()),
            "hexNumber": lambda r: 0x1000000 | r["input"],
            "rgb": lambda r: rgb(r["r"], r["g"], r["b"]),
            "ansi256": lambda r: indexed(r["index"]),
            "mix": lambda r: mix(r["a"], r["b"], r["t"]),
            "mixDefault": lambda r: mix(r["a"], r["b"], r["t"]),
            "alpha": lambda r: mix(r["bg"], r["fg"], r["a"]),
            "lighten": lambda r: mix(r["c"], rgb(255, 255, 255), r["amount"]),
            "darken": lambda r: mix(r["c"], rgb(0, 0, 0), r["amount"]),
            "luminance": lambda r: luminance(r["c"]),
            "contrast": lambda r: contrast(r["a"], r["b"]),
            "grayscale": lambda r: gray(r["c"]),
            "to256": lambda r: to256(r["c"]),
            "to16": lambda r: to16(r["c"]),
            "from256": lambda r: from256(r["index"]),
        }
        for group, fn in calls.items():
            for r in data[group]:
                with self.subTest(group=group, case=r):
                    self.assertAlmostEqual(fn(r), r.get("out", r.get("color")), places=12)
        self.assertEqual(gray(0), data["grayscaleDefault"])
        g = data["gradient"]
        stops = (U * len(g["stops"]))(*g["stops"])
        for r in g["samples"]:
            self.assertEqual(gradient(stops, len(stops), r["t"]), r["out"])

    def test_theme_palettes(self):
        data = fixture("theme")["themes"]
        self.assertEqual(theme_count(), len(data))
        for i, entry in enumerate(data):
            actual, expected = theme_at(i).contents, entry["theme"]
            self.assertEqual(actual.name.decode(), expected["name"])
            self.assertEqual(actual.dark, expected["dark"])
            for k in THEME_COLORS:
                self.assertEqual(getattr(actual, k), expected[k], (expected["name"], k))
            self.assertEqual(list(actual.graph)[:actual.graph_count], expected["graph"])
            self.assertEqual(list(actual.heat)[:actual.heat_count], expected["heat"])

    def test_surface_boxes(self):
        borders = ["rounded", "single", "double", "thick", "dashed", "ascii", "none"]
        for r in fixture("surface"):
            with self.subTest(case=r["name"]):
                b = create(r["width"], r["height"])
                try:
                    theme = theme_at(0)
                    clear(b, theme.contents.background, theme.contents.foreground)
                    options = Box()
                    options.border = borders.index(r["box"].get("border", "rounded"))
                    options.title_align = ["left", "center", "right"].index(r["box"].get("titleAlign", "left"))
                    for k in ("title", "subtitle", "footer"):
                        if k in r["box"]:
                            setattr(options, k, r["box"][k].encode())
                    inner = surface_box(surface_root(b, theme), options)
                    self.assertEqual({k: getattr(inner.rect, k) for k, _ in Rect._fields_}, r["innerRect"])
                    expected = r["result"]
                    planes = {k: [v for n, v in expected[k] for _ in range(n)] for k in ("chars", "fg", "bg", "attrs")}
                    for y in range(r["height"]):
                        for x in range(r["width"]):
                            actual = Cell()
                            self.assertTrue(cell(b, x, y, C.byref(actual)))
                            i = y*r["width"]+x
                            for k in planes:
                                self.assertEqual(getattr(actual, "value" if k == "chars" else k), planes[k][i], (x,y,k))
                finally:
                    destroy(b)

    def test_unicode_widths(self):
        data = fixture("unicode")
        for r in data["charWidth"]:
            self.assertEqual(char_width(r["cp"]), r["width"], r)
        for r in data["stringWidth"]:
            s = r["s"].encode()
            self.assertEqual(text_width(s, len(s)), r["width"], r)

    def test_layout(self):
        data = fixture("layout")
        for r in data["solve"]:
            items = (Constraint * len(r["items"]))(*map(constraint, r["items"]))
            out = (I * len(items))()
            self.assertTrue(solve(r["total"], items, len(items), r["gap"], out))
            self.assertEqual(list(out), r["out"], r)
        for r in data["stack"]:
            items = (Constraint * len(r["items"]))(*map(constraint, r["items"]))
            out = (Rect * len(items))()
            self.assertTrue(stack(Rect(**r["rect"]), items, len(items), r["direction"] == "row", r["gap"], out))
            self.assertEqual([{k: getattr(o, k) for k, _ in Rect._fields_} for o in out], r["out"])

    def test_buffer(self):
        for r in fixture("buffer"):
            with self.subTest(case=r["name"]):
                b = create(r["width"], r["height"])
                self.assertTrue(b)
                try:
                    apply(b, r["ops"])
                    expected = r["result"]
                    expanded = {k: [v for n, v in expected[k] for _ in range(n)] for k in ("chars", "fg", "bg", "attrs")}
                    for y in range(r["height"]):
                        output = C.create_string_buffer(16384)
                        row(b, y, output, len(output))
                        self.assertEqual(output.value.decode(), expected["text"][y])
                        for x in range(r["width"]):
                            actual = Cell()
                            self.assertTrue(cell(b, x, y, C.byref(actual)))
                            i = y * r["width"] + x
                            # Cluster IDs are local to buffers, unlike the TS global pool.
                            if expanded["chars"][i] < 0x110000 or expanded["chars"][i] == 0xffffffff:
                                self.assertEqual(actual.value, expanded["chars"][i])
                            for k in ("fg", "bg", "attrs"):
                                self.assertEqual(getattr(actual, k), expanded[k][i], (x, y, k))
                finally:
                    destroy(b)

    def test_diff(self):
        for r in fixture("diff"):
            with self.subTest(case=r["name"]):
                a, b = create(r["width"], r["height"]), create(r["width"], r["height"])
                colors = {"truecolor": 16777216, "ansi256": 256, "ansi16": 16, "none": 0}[str(r["colors"])]
                e = encoder(colors, r.get("monochrome", False))
                try:
                    apply(a, r["before"])
                    apply(b, r["after"])
                    out = Encoded()
                    self.assertTrue(encode(e, a, b, r["full"], C.byref(out)))
                    self.assertEqual(C.string_at(out.data, out.length).decode(), r["result"]["output"])
                    self.assertEqual(out.changed_cells, r["result"]["changedCells"])
                    self.assertEqual(out.dirty_rows, r["result"]["dirtyRows"])
                finally:
                    encoder_destroy(e)
                    destroy(a)
                    destroy(b)

    def test_invalid_text_cannot_emit_controls(self):
        b = create(20, 2)
        try:
            for raw in (b"\x9b31m", b"\xc0\x9b", b"\xf0", b"\xed\xa0\x80", b"\xff\xcc\x81"):
                clear(b, 0, 0)
                write(b, 0, 0, raw, len(raw), Style(), 20)
                output = C.create_string_buffer(256)
                row(b, 0, output, len(output))
                safe = output.value.decode("utf-8", errors="strict")
                self.assertFalse(any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in safe))
        finally:
            destroy(b)

    def test_resize_copy_and_cross_pool_diff(self):
        a, b, e = create(20, 2), create(20, 2), encoder(16777216, False)
        try:
            for buffer, s in ((a, "á"), (b, "ź"), (b, "á")):
                clear(buffer, 0, 0)
                raw = s.encode()
                write(buffer, 0, 0, raw, len(raw), Style(), 20)
            out = Encoded()
            self.assertTrue(encode(e, a, b, False, C.byref(out)))
            self.assertEqual(out.length, 0)
            self.assertFalse(resize(a, -1, 10))
            self.assertFalse(resize(a, 32769, 10))
            self.assertTrue(copy(b, a))
            self.assertTrue(resize(a, 0, 0))
            self.assertTrue(copy(b, a))
        finally:
            destroy(a)
            destroy(b)
            encoder_destroy(e)

if __name__ == "__main__":
    unittest.main()
