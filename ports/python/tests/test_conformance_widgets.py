"""Every widget, drawn with the same arguments the fixture generator used, and
compared cell for cell against what the TypeScript reference produced.

The scenes are matched by name rather than driven by data: the arguments are
typed structs here and object literals there, and spelling them out in both is
what makes a drifted default visible instead of silently shared.
"""

from __future__ import annotations

import math
import unittest

import hqtui.widgets as w
from hqtui.graphics import (
    BarOptions,
    BarStyle,
    DonutOptions,
    DonutSegment,
    FillMode,
    GaugeOptions,
    PlotOptions,
    Series,
    SparklineOptions,
    bar,
    donut,
    gauge,
    plot,
    sparkline,
)
from hqtui.surface import Surface

from .support import assert_buffer, fixture, scene

SERIES = [3, 7, 2, 9, 4, 8, 6, 1, 5, 9, 3, 7, 8, 2, 6, 4, 9, 1, 5, 7]


def draw_scene(case, name: str, s: Surface) -> None:
    if name == "text-plain":
        w.draw_text(s, "hello terminal")
    elif name == "text-wrapped":
        w.draw_text(s, "the quick brown fox jumps", w.TextStyle(wrap=True))
    elif name == "text-aligned":
        w.draw_text(s.sub(0, 0, 20, 1), "left", w.TextStyle(align="left"))
        w.draw_text(s.sub(0, 1, 20, 1), "center", w.TextStyle(align="center"))
        w.draw_text(s.sub(0, 2, 20, 1), "right", w.TextStyle(align="right"))
    elif name == "badge":
        w.draw_badge(s, w.BadgeOptions(text="LIVE"))
    elif name == "badge-outline":
        w.draw_badge(s, w.BadgeOptions(text="IDLE", variant="outline"))
    elif name == "badge-subtle":
        w.draw_badge(s, w.BadgeOptions(text="WARN", variant="subtle"))
    elif name == "keyvalues":
        w.draw_key_values(
            s,
            w.KeyValueOptions(
                rows=[
                    w.KeyValueRow("Host", "seed1"),
                    w.KeyValueRow("Uptime", "12d 4h"),
                    w.KeyValueRow("Load", "0.42"),
                ]
            ),
        )
    elif name == "divider":
        w.draw_divider(s, w.DividerOptions(label="Section"))
    elif name == "meter":
        w.draw_meter(s, w.MeterOptions(value=0.72, label="CPU"))
    elif name == "meter-segmented":
        w.draw_meter(s, w.MeterOptions(value=0.33, label="MEM", style=BarStyle.SEGMENTED))
    elif name == "meter-ascii":
        w.draw_meter(s, w.MeterOptions(value=0.9, label="IO", style=BarStyle.ASCII))
    elif name == "meter-nan":
        w.draw_meter(s, w.MeterOptions(value=math.nan, label="BAD"))
    elif name == "meters-grid":
        w.draw_meters(
            s,
            w.MetersOptions(
                items=[
                    w.MeterItem("c0", 0.2), w.MeterItem("c1", 0.5), w.MeterItem("c2", 0.8),
                    w.MeterItem("c3", 1), w.MeterItem("c4", 0), w.MeterItem("c5", 0.65),
                ],
                columns=2,
            ),
        )
    elif name == "progress":
        w.draw_progress(
            s, w.ProgressOptions(value=37, max=120, label="Sync", show_count=True)
        )
    elif name == "heat-bar":
        w.draw_heat_bar(s, w.HeatBarOptions(value=0.6))
    elif name == "columns":
        w.draw_columns(s, w.ColumnsOptions(values=SERIES))
    elif name == "bar-smooth":
        bar(s, BarOptions(value=0.63))
    elif name == "bar-segmented":
        bar(s, BarOptions(value=0.63, style=BarStyle.SEGMENTED))
    elif name == "bar-ascii":
        bar(s, BarOptions(value=0.63, style=BarStyle.ASCII))
    elif name == "sparkline":
        sparkline(s, SERIES)
    elif name == "plot-braille":
        plot(s, [Series(values=SERIES)])
    elif name == "plot-block":
        plot(s, [Series(values=SERIES)], PlotOptions(mode=FillMode.BLOCK))
    elif name == "plot-ascii":
        plot(s, [Series(values=SERIES)], PlotOptions(mode=FillMode.ASCII))
    elif name == "plot-fill":
        plot(s, [Series(values=SERIES, fill=True)])
    elif name == "plot-grid":
        plot(s, [Series(values=SERIES)], PlotOptions(grid=True))
    elif name == "plot-multi":
        plot(s, [Series(values=SERIES), Series(values=[10 - v for v in SERIES])])
    elif name == "gauge":
        gauge(s, GaugeOptions(value=0.7, label="70%"))
    elif name == "donut":
        donut(
            s,
            DonutOptions(
                segments=[DonutSegment(value=3), DonutSegment(value=5), DonutSegment(value=2)]
            ),
        )
    elif name == "graph-axis":
        w.draw_graph(s, w.GraphOptions(values=SERIES, axis=True))
    elif name == "graph-legend":
        w.draw_graph(
            s,
            w.GraphOptions(
                series=[
                    Series(values=SERIES, label="rx"),
                    Series(values=[v / 2 for v in SERIES], label="tx"),
                ],
                legend=True,
            ),
        )
    elif name == "graph-timeaxis":
        w.draw_graph(s, w.GraphOptions(values=SERIES, time_axis=["60s", "30s", "0s"]))
    # Both axes together. Each was covered alone, which is how the y-axis
    # minimum came to be drawn onto the time-axis row with no fixture noticing.
    elif name == "graph-axis-timeaxis":
        w.draw_graph(
            s,
            w.GraphOptions(
                values=SERIES,
                axis=True,
                plot=PlotOptions(min=0, max=100),
                time_axis=["60s", "30s", "0s"],
            ),
        )
    elif name == "sparkline-widget":
        w.draw_sparkline(
            s, w.SparklineWidgetOptions(values=SERIES, label="net", text="1.2M")
        )
    elif name == "table":
        w.draw_table(
            s,
            w.TableOptions(
                rows=[
                    w.TableRow(("1", "systemd", "0.1")),
                    w.TableRow(("420", "node", "12.5")),
                    w.TableRow(("900", "hqtui-demo", "3.2")),
                ],
                columns=[
                    w.TableColumn("PID", align="right"),
                    w.TableColumn("NAME"),
                    w.TableColumn("CPU%", align="right"),
                ],
                selected=1,
                zebra=True,
            ),
        )
    elif name == "table-scrollbar":
        w.draw_table(
            s,
            w.TableOptions(
                rows=[w.TableRow((str(i), f"row {i}")) for i in range(20)],
                columns=[w.TableColumn("#", align="right"), w.TableColumn("VALUE")],
                selected=12,
                follow_selection=True,
                scrollbar=True,
            ),
        )
    elif name == "list":
        w.draw_list(
            s,
            w.ListOptions(
                items=["alpha", "beta", "gamma", "delta"], selected=2, bullet="•"
            ),
        )
    elif name == "tree":
        w.draw_tree(
            s,
            w.TreeOptions(
                nodes=[
                    w.TreeNode(
                        label="root",
                        children=[
                            w.TreeNode(label="child-a", children=[w.TreeNode(label="leaf")]),
                            w.TreeNode(label="child-b"),
                        ],
                    ),
                    w.TreeNode(label="second"),
                ],
                selected=1,
            ),
        )
    elif name == "log":
        w.draw_log(
            s,
            w.LogOptions(
                entries=[
                    w.LogEntry(message="started", time="10:00:00", level="INFO"),
                    w.LogEntry(
                        message="slow query", time="10:00:01", level="WARN", meta="412ms"
                    ),
                    w.LogEntry(message="connection reset", time="10:00:02", level="ERROR"),
                ]
            ),
        )
    elif name == "scrollbar":
        w.draw_scrollbar(s, 1, 0, 8, 40, 12)
    elif name == "button":
        w.draw_button(s, w.ButtonOptions(label="OK"))
    elif name == "button-focused":
        w.draw_button(s, w.ButtonOptions(label="Run", focused=True))
    elif name == "button-variants":
        w.draw_button(s.sub(0, 0, 10, 1), w.ButtonOptions(label="ok", variant="success"))
        w.draw_button(s.sub(10, 0, 10, 1), w.ButtonOptions(label="hm", variant="warning"))
        w.draw_button(s.sub(20, 0, 10, 1), w.ButtonOptions(label="no", variant="danger"))
        w.draw_button(s.sub(30, 0, 10, 1), w.ButtonOptions(label="gh", variant="ghost"))
    elif name == "checkbox":
        w.draw_checkbox(s.sub(0, 0, 24, 1), w.CheckboxOptions(label="on", checked=True))
        w.draw_checkbox(
            s.sub(0, 1, 24, 1),
            w.CheckboxOptions(label="toggle", checked=False, variant="toggle"),
        )
        w.draw_checkbox(
            s.sub(0, 2, 24, 1),
            w.CheckboxOptions(label="radio", checked=True, variant="radio"),
        )
    elif name == "select-closed":
        w.draw_select(s, w.SelectOptions(value="dark"))
    elif name == "select-open":
        w.draw_select(
            s,
            w.SelectOptions(
                value="dark", open=True, options=["dark", "nord", "light"], selected_index=1
            ),
        )
    elif name == "text-input":
        w.draw_text_input(s, w.TextInputOptions(value="seed", label="host", focused=True))
    elif name == "text-input-password":
        w.draw_text_input(s, w.TextInputOptions(value="hunter2", password=True))
    elif name == "text-input-placeholder":
        w.draw_text_input(s, w.TextInputOptions(value="", placeholder="search…"))
    elif name == "tabs":
        w.draw_tabs(s, w.TabsOptions(tabs=["cpu", "mem", "net"], active=1))
    elif name == "tabs-underline":
        w.draw_tabs(s, w.TabsOptions(tabs=["a", "b"], active=0, variant="underline"))
    elif name == "status-bar":
        w.draw_status_bar(
            s,
            w.StatusBarOptions(
                items=[w.StatusItem("Help", "F1"), w.StatusItem("Quit", "F10")],
                right=[w.StatusItem("30fps")],
            ),
        )
    elif name == "modal":
        w.draw_modal(
            s,
            w.ModalOptions(
                title="Confirm", message="Restart the service?",
                buttons=[w.ModalButton("Yes", focused=True), w.ModalButton("No")],
            ),
        )
    elif name == "command-palette":
        w.draw_command_palette(
            s,
            w.CommandPaletteOptions(
                query="th",
                items=[w.PaletteItem("theme: dark", "T"), w.PaletteItem("theme: nord")],
                selected=0,
            ),
        )
    elif name == "tooltip":
        w.draw_tooltip(s, w.TooltipOptions(text="hint", x=4, y=2))
    else:  # pragma: no cover
        case.fail(f"no Python scene for widget fixture {name!r}")


class TestWidgets(unittest.TestCase):
    def test_matches_reference(self):
        cases = fixture("widgets")
        self.assertTrue(cases, "no widget fixtures loaded")
        cells = 0
        for case in cases:
            name = case["name"]
            cells += case["width"] * case["height"]
            buffer, surface = scene(case["width"], case["height"])
            draw_scene(self, name, surface)
            assert_buffer(self, buffer, case["result"], name)
        print(f"\n  {len(cases)} widget scenes, {cells} cells compared")


if __name__ == "__main__":
    unittest.main()
