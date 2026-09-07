"""Collapsed borders in Python: ``python -m examples.collapse``.

The same scene as examples/collapse.ts in the TypeScript reference and the Rust
and Go examples, so the four outputs can be diffed. They are expected to be
byte for byte the same, which is what keeps the ports honest.
"""

import hqtui.widgets as w
from hqtui.testing import render_to_text
from hqtui.ui import Container, Layout, Panel


def view(ui: Container) -> None:
    def top(row: Container) -> None:
        row.panel(Panel(title="CPU"), lambda p: p.meter(w.MeterOptions(value=0.62, label="all")))
        row.panel(Panel(title="Memory"), lambda p: p.meter(w.MeterOptions(value=0.31, label="used")))
        row.panel(Panel(title="Disk"), lambda p: p.meter(w.MeterOptions(value=0.87, label="root")))

    def bottom(row: Container) -> None:
        row.panel(
            Panel(title="Network"),
            lambda p: p.sparkline(
                w.SparklineWidgetOptions(values=[3, 7, 2, 9, 4, 8, 6], label="rx ")
            ),
        )
        row.panel(Panel(title="Errors"), lambda p: p.text("none"))

    ui.row(Layout(size=5), top)
    ui.row(Layout(size=4), bottom)


for collapse in (False, True):
    print("--- collapsed ---" if collapse else "--- default ---")
    print(render_to_text(60, 9, "dark", view, collapse_borders=collapse))
