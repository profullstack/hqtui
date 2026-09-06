"""End to end: the builder driving whole screens, compared against what the
TypeScript reference's builder produced for the same layout.

This is the test that would catch a layout solver that is subtly off, or a panel
whose interior padding drifted — neither of which shows up when a widget is
drawn onto a surface someone else sized.
"""

from __future__ import annotations

import unittest

import hqtui.widgets as w
from hqtui.graphics import Series
from hqtui.testing import render_to_screen
from hqtui.ui import Cell, Container, GridSpec, Layout, Panel

from .support import assert_buffer, fixture

SERIES = [12, 40, 33, 71, 25, 60, 48, 19, 55, 80, 35, 62, 44, 28, 70, 51]


def build(case, name: str, ui: Container) -> None:
    if name == "hello":
        ui.panel(Panel(title="Hello"), lambda p: p.text("Hello, terminal."))
    elif name == "rows-and-columns":
        def row(r: Container) -> None:
            r.panel(Panel(title="L"), lambda p: p.text("left"))
            r.panel(Panel(title="R", size="1fr"), lambda p: p.text("right"))

        ui.row(Layout(gap=1), row)
    elif name == "grid":
        def grid(g) -> None:
            g.panel(
                Panel(title="CPU"), Cell(),
                lambda p: p.meter(w.MeterOptions(value=0.62, label="all")),
            )
            g.panel(
                Panel(title="MEM"), Cell(),
                lambda p: p.meter(w.MeterOptions(value=0.31, label="used")),
            )
            g.panel(
                Panel(title="NET"), Cell(col_span=2),
                lambda p: p.graph(w.GraphOptions(values=SERIES)),
            )

        ui.grid(GridSpec(columns=["2fr", "1fr"], rows=[6, "1fr"], gap=1), grid)
    elif name == "grid-span-overflow":
        def grid(g) -> None:
            g.panel(Panel(title="wide"), Cell(col_span=2), lambda p: p.text("spans"))
            g.panel(Panel(title="next"), Cell(), lambda p: p.text("after"))

        ui.grid(GridSpec(columns=1, rows=2), grid)
    elif name == "dashboard":
        def header(r: Container) -> None:
            r.heading("hqtui")
            r.spacer("fill")
            r.badge(w.BadgeOptions(text="LIVE"))

        def load(p: Container) -> None:
            p.meters(
                w.MetersOptions(items=[w.MeterItem("c0", 0.2), w.MeterItem("c1", 0.7)])
            )
            p.graph(w.GraphOptions(values=SERIES, axis=True))

        def procs(p: Container) -> None:
            p.table(
                w.TableOptions(
                    rows=[w.TableRow(("1", "init")), w.TableRow(("42", "node"))],
                    columns=[w.TableColumn("PID", align="right"), w.TableColumn("CMD")],
                    selected=0,
                )
            )

        def grid(g) -> None:
            g.panel(Panel(title="Load"), Cell(), load)
            g.panel(Panel(title="Procs"), Cell(), procs)

        ui.row(Layout(size=1), header)
        ui.grid(GridSpec(columns=["1fr", "1fr"], rows=["1fr"], gap=1), grid)
        ui.status_bar(w.StatusBarOptions(items=[w.StatusItem("quit", "q")]))
    elif name in ("themed-nord", "themed-light"):
        title = "Nord" if name == "themed-nord" else "Light"
        ui.panel(
            Panel(title=title), lambda p: p.meter(w.MeterOptions(value=0.5, label="x"))
        )
    elif name == "responsive-narrow":
        ui.responsive(
            {60: lambda u: u.text("wide"), 0: lambda u: u.text("narrow")}
        )
    elif name == "overlays":
        ui.panel(Panel(title="Behind"), lambda p: p.text("content"))
        ui.modal(
            w.ModalOptions(
                title="Modal", message="Are you sure?",
                buttons=[w.ModalButton("OK", focused=True)],
            )
        )
    elif name == "unicode-content":
        def body(p: Container) -> None:
            p.text("こんにちは 世界")
            p.text("🚀 emoji ok")

        ui.panel(Panel(title="日本語"), body)
    else:  # pragma: no cover
        case.fail(f"no Python scene for screen fixture {name!r}")


class TestScreens(unittest.TestCase):
    def test_matches_reference(self):
        cases = fixture("screen")
        self.assertTrue(cases, "no screen fixtures loaded")
        cells = 0
        for case in cases:
            name = case["name"]
            cells += case["width"] * case["height"]
            screen = render_to_screen(
                case["width"], case["height"], case["theme"],
                lambda ui, n=name: build(self, n, ui),
            )
            assert_buffer(self, screen.buffer, case["result"], name)
        print(f"\n  {len(cases)} screen scenes, {cells} cells compared")


if __name__ == "__main__":
    unittest.main()
