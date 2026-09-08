"""Every widget HQTUI ships, one function each, in Python.

``python -m examples.widgets`` renders all of them headlessly and prints the
result, so the file is a program rather than a snippet dump. The
``@widget`` / ``@end`` markers are what hqtui.com/widgets slices to show the
code for one widget, which is why a snippet on the site is always a region of
something that runs.

Keep each function self-contained: it takes a container and nothing else.
"""

from __future__ import annotations

import sys

import hqtui.graphics.chart as g
import hqtui.widgets as w
from hqtui.graphics import BarStyle, DonutOptions, DonutSegment, GaugeOptions, PlotOptions, Series
from hqtui.testing import render_to_text
from hqtui.ui import Container, Layout

CPU_HISTORY = [12, 18, 26, 22, 31, 44, 38, 52, 61, 48, 39, 44, 57, 66, 72, 64, 51, 43, 37, 41]
NET_HISTORY = [4, 9, 6, 14, 22, 18, 31, 27, 19, 12, 8, 15, 24, 33, 29, 21]


# ------------------------------------------------------------------- text

# @widget text
def text(ui: Container) -> None:
    ui.text("Plain text. It fills the width it is given.")
    ui.text("Bold, in the theme's primary color.", w.TextStyle(bold=True))
    ui.text("Right aligned.", w.TextStyle(align="right"))
    ui.text(
        "Long copy wraps when you ask it to, instead of being cut at the edge.",
        w.TextStyle(wrap=True),
    )
# @end


# @widget label
def label(ui: Container) -> None:
    # `label` is `text` in the theme's muted color: secondary copy, captions,
    # the line under a number that says what the number is.
    ui.label("cpu · 8 cores · 3.4 GHz")
    ui.text("42.1%", w.TextStyle(bold=True))
    ui.label("15 minute average")
# @end


# @widget heading
def heading(ui: Container) -> None:
    # `heading` is `text` in the theme's title color, bold.
    ui.heading("Storage")
    ui.label("Four volumes, one degraded")
    ui.spacer(1)
    ui.heading("Network")
# @end


# @widget badge
def badge(ui: Container) -> None:
    def row(r: Container) -> None:
        r.badge(w.BadgeOptions(text="active"))
        r.badge(w.BadgeOptions(text="idle", variant="subtle"))
        r.badge(w.BadgeOptions(text="failed", variant="outline"))
        r.spacer("fill")

    ui.row(Layout(size=1, gap=1), row)
# @end


# @widget divider
def divider(ui: Container) -> None:
    ui.text("Above the line")
    ui.divider()
    ui.text("Below it")
    ui.divider(w.DividerOptions(label="status", align="center"))
    ui.text("A labelled divider titles a section without spending a panel on it")
# @end


# @widget keyValues
def key_values(ui: Container) -> None:
    # The backbone of every "System" panel: labels left, values right.
    ui.key_values(
        w.KeyValueOptions(
            rows=[
                w.KeyValueRow("Host", "web-01.iad"),
                w.KeyValueRow("Uptime", "18d 04:12"),
                w.KeyValueRow("Load", "0.42  0.51  0.60"),
                w.KeyValueRow("Established", "1,284"),
            ]
        )
    )
# @end


# @widget statusBar
def status_bar(ui: Container) -> None:
    # Usually the last thing drawn, pinned to the bottom row.
    ui.status_bar(
        w.StatusBarOptions(
            items=[
                w.StatusItem(label="Help", key="F1"),
                w.StatusItem(label="Theme", key="F2"),
                w.StatusItem(label="Filter", key="F3", active=True),
                w.StatusItem(label="Palette", key="^K"),
                w.StatusItem(label="Quit", key="q"),
            ],
            right=[w.StatusItem(label="0.41ms  184 cells")],
        )
    )
# @end


# ------------------------------------------------------------------- data

# @widget table
def table(ui: Container) -> None:
    ui.table(
        w.TableOptions(
            rows=[
                w.TableRow(("src", "4.2 KB", "dir", "2m ago")),
                w.TableRow(("test", "1.1 KB", "dir", "5m ago")),
                w.TableRow(("package.json", "1.2 KB", "file", "10m ago")),
                w.TableRow(("README.md", "3.4 KB", "file", "1h ago")),
            ],
            columns=[
                w.TableColumn("Name"),
                w.TableColumn("Size", align="right"),
                w.TableColumn("Type"),
                w.TableColumn("Modified", align="right"),
            ],
            selected=1,
            zebra=True,
        )
    )
# @end


# @widget list
def list_(ui: Container) -> None:
    ui.list(
        w.ListOptions(
            items=["apps/demo", "packages/hqtui", "apps/web", "docs"],
            selected=0,
            bullet="▸",
            scrollbar=True,
        )
    )
# @end


# @widget tree
def tree(ui: Container) -> None:
    ui.tree(
        w.TreeOptions(
            nodes=[
                w.TreeNode(
                    label="systemd",
                    children=[
                        w.TreeNode(label="bash"),
                        w.TreeNode(label="bun", children=[w.TreeNode(label="bun:worker")]),
                        w.TreeNode(label="postgres"),
                    ],
                )
            ],
            selected=2,
        )
    )
# @end


# @widget log
def log(ui: Container) -> None:
    ui.log(
        w.LogOptions(
            entries=[
                w.LogEntry(message="listening on :8080", time="12:45:02", level="INFO"),
                w.LogEntry(
                    message="slow query 412ms", time="12:45:09", level="WARN", meta="table=users"
                ),
                w.LogEntry(message="upstream timeout", time="12:45:11", level="ERROR"),
                w.LogEntry(message="retry succeeded", time="12:45:14", level="INFO"),
            ],
            scrollbar=True,
        )
    )
# @end


# ----------------------------------------------------------------- meters

# @widget scrollbar
def scrollbar(ui: Container) -> None:
    # The bar is over state you own, so it works beside anything that scrolls:
    # wrapped prose, a canvas, a ``draw`` of your own.
    def row(r: Container) -> None:
        r.text(
            "A scrollbar you drive yourself. It has no idea what is beside it, only how much there is, how much fits, and where you are.",
            w.TextStyle(wrap=True),
        )
        r.scrollbar(w.ScrollbarOptions(total=40, viewport=5, offset=12))

    ui.row(Layout(gap=1), row)
# @end


# @widget chart
def chart(ui: Container) -> None:
    # Points carry their own x, so a sparse series and a dense one line up.
    ui.chart(w.ChartOptions(
        series=[
            g.ChartSeries(points=[(0, 1), (2, 6), (5, 3), (8, 9), (10, 4)], label="load"),
            g.ChartSeries(points=[(0, 8), (10, 2)], label="limit"),
        ],
        axis=True,
        legend=True,
        plot=g.ChartPlotOptions(
            x=g.AxisOptions(min=0, max=10, ticks=3),
            y=g.AxisOptions(min=0, max=10),
        ),
    ))
# @end


# @widget calendar
def calendar(ui: Container) -> None:
    # The dates are arithmetic, not a host calendar: every port has a different
    # date type and none of them is consulted.
    ui.calendar(w.CalendarOptions(
        year=2026, month=9, selected=8,
        marks=[w.CalendarMark(day=15), w.CalendarMark(day=22, bold=True)],
    ))
# @end


# @widget meter
def meter(ui: Container) -> None:
    ui.meter(w.MeterOptions(value=0.62, label="CPU"))
    ui.meter(w.MeterOptions(value=0.31, label="MEM", style=BarStyle.SEGMENTED))
    ui.meter(w.MeterOptions(value=0.87, label="SWP"))
# @end


# @widget meters
def meters(ui: Container) -> None:
    # One call for a whole bank. `columns` lays them out side by side.
    ui.meters(
        w.MetersOptions(
            items=[
                w.MeterItem("P0", 0.12), w.MeterItem("P1", 0.44),
                w.MeterItem("P2", 0.71), w.MeterItem("P3", 0.09),
                w.MeterItem("P4", 0.38), w.MeterItem("P5", 0.55),
                w.MeterItem("P6", 0.22), w.MeterItem("P7", 0.66),
            ],
            columns=2,
            style=BarStyle.SEGMENTED,
        )
    )
# @end


# @widget progress
def progress(ui: Container) -> None:
    ui.progress(w.ProgressOptions(value=37, max=120, label="Indexing", show_count=True))
    ui.progress(w.ProgressOptions(value=0.82, label="Upload"))
# @end


# @widget graph
def graph(ui: Container) -> None:
    # Braille line chart. `fill` shades the area under the curve.
    ui.graph(
        w.GraphOptions(
            series=[Series(values=CPU_HISTORY, label="cpu", fill=True)],
            plot=PlotOptions(min=0, max=100),
        )
    )
# @end


# @widget sparkline
def sparkline(ui: Container) -> None:
    ui.sparkline(w.SparklineWidgetOptions(values=CPU_HISTORY, label="CPU ", text="44%"))
    ui.sparkline(w.SparklineWidgetOptions(values=NET_HISTORY, label="Net ", text="2.4 MB/s"))
# @end


# @widget histogram
def histogram(ui: Container) -> None:
    # Block columns. Cheaper than Braille and easier to read when short.
    ui.histogram(w.ColumnsOptions(values=CPU_HISTORY))
# @end


# @widget heatBar
def heat_bar(ui: Container) -> None:
    # Segmented bar colored along the theme's heat ramp, like btop's temperatures.
    ui.heat_bar(w.HeatBarOptions(value=0.28))
    ui.heat_bar(w.HeatBarOptions(value=0.64))
    ui.heat_bar(w.HeatBarOptions(value=0.91))
# @end


# @widget gauge
def gauge(ui: Container) -> None:
    # A semicircular dial. Wants at least nine columns by five rows.
    ui.gauge(GaugeOptions(value=0.62, label="62%"))
# @end


# @widget donut
def donut(ui: Container) -> None:
    ui.donut(
        DonutOptions(
            segments=[
                DonutSegment(value=4.65, label="Used"),
                DonutSegment(value=10.96, label="Free"),
            ]
        )
    )
# @end


# ----------------------------------------------------------------- inputs

# @widget button
def button(ui: Container) -> None:
    # Pass on_press and the button joins the Tab order automatically.
    def row(r: Container) -> None:
        r.button(w.ButtonOptions(label="Primary"), lambda: None)
        r.button(w.ButtonOptions(label="Success", variant="success"))
        r.button(w.ButtonOptions(label="Danger", variant="danger"))
        r.spacer("fill")

    ui.row(Layout(size=1, gap=1), row)
# @end


# @widget checkbox
def checkbox(ui: Container) -> None:
    def row(r: Container) -> None:
        r.checkbox(w.CheckboxOptions(label="Toggle", checked=True, variant="toggle"))
        r.checkbox(w.CheckboxOptions(label="Checkbox", checked=False))
        r.spacer("fill")

    ui.row(Layout(size=1, gap=2), row)
# @end


# @widget select
def select(ui: Container) -> None:
    ui.select(
        w.SelectOptions(
            value="Dracula",
            open=True,
            options=["Dark", "Dracula", "Nord", "Tokyo Night"],
            selected_index=1,
        )
    )
# @end


# @widget textInput
def text_input(ui: Container) -> None:
    ui.text_input(w.TextInputOptions(value="postgres", label="Search"))
    ui.spacer(1)
    ui.text_input(w.TextInputOptions(value="", label="Filter", placeholder="type to filter…"))
# @end


# @widget tabs
def tabs(ui: Container) -> None:
    ui.tabs(w.TabsOptions(tabs=["1 dashboard", "2 traffic", "3 sessions", "4 network"], active=1))
# @end


# ---------------------------------------------------------------- overlays

# @widget modal
def modal(ui: Container) -> None:
    # Overlays draw over everything already on the screen, centered.
    ui.modal(
        w.ModalOptions(
            title="Confirm Action",
            message="Terminate process 4821 (postgres)?\n\nThis cannot be undone.",
            buttons=[
                w.ModalButton(label="Yes", focused=True),
                w.ModalButton(label="No", variant="ghost"),
            ],
        )
    )
# @end


# @widget commandPalette
def command_palette(ui: Container) -> None:
    ui.command_palette(
        w.CommandPaletteOptions(
            query="the",
            items=[
                w.PaletteItem(label="Toggle theme", hint="F2"),
                w.PaletteItem(label="Filter processes", hint="F3"),
                w.PaletteItem(label="Sort by memory", hint="F6"),
            ],
            selected=0,
        )
    )
# @end


# @widget tooltip
def tooltip(ui: Container) -> None:
    ui.text("Tooltips are overlays positioned at a cell, for hover and hints.")
    ui.tooltip(w.TooltipOptions(text="swap is 87% full", x=6, y=3))
# @end


EXAMPLES = [
    ("text", text), ("label", label), ("heading", heading), ("badge", badge),
    ("divider", divider), ("keyValues", key_values), ("statusBar", status_bar),
    ("table", table), ("list", list_), ("tree", tree), ("log", log),
    ("scrollbar", scrollbar), ("chart", chart), ("calendar", calendar),
    ("meter", meter), ("meters", meters), ("progress", progress), ("graph", graph),
    ("sparkline", sparkline), ("histogram", histogram), ("heatBar", heat_bar),
    ("gauge", gauge), ("donut", donut),
    ("button", button), ("checkbox", checkbox), ("select", select),
    ("textInput", text_input), ("tabs", tabs),
    ("modal", modal), ("commandPalette", command_palette), ("tooltip", tooltip),
]


def main() -> int:
    """Renders each widget on its own small screen and prints the lot."""
    blank = 0
    for name, draw in EXAMPLES:
        out = render_to_text(62, 12, "dark", draw)
        if not out.strip():
            print(f"FAIL {name}: rendered an empty screen", file=sys.stderr)
            blank += 1
            continue
        print(f"--- {name}\n{out.rstrip()}")

    print(f"{len(EXAMPLES) - blank}/{len(EXAMPLES)} widget examples rendered", file=sys.stderr)
    return 1 if blank else 0


if __name__ == "__main__":
    raise SystemExit(main())
