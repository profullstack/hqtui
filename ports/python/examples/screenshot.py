"""Renders a dashboard headlessly and prints it, so the whole stack can be
exercised without a TTY: ``python examples/screenshot.py``.

Add ``--ansi`` for the colored form, or ``--html`` for a standalone page.
"""

from __future__ import annotations

import math
import sys

import hqtui.widgets as w
from hqtui import Cell, GridSpec, Layout, Panel, render_to_html, render_to_screen
from hqtui.graphics import PlotOptions, Series


def main() -> None:
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    cpu = [math.sin(i / 9) * 35 + 55 for i in range(120)]
    net = [math.cos(i / 5) * 25 + 40 for i in range(120)]

    def view(root) -> None:
        def header(r) -> None:
            r.heading("hqtui — python port")
            r.spacer("fill")
            r.badge(w.BadgeOptions(text="LIVE"))

        def throughput(p) -> None:
            p.graph(
                w.GraphOptions(
                    series=[
                        Series(values=cpu, label="cpu"),
                        Series(values=net, label="net"),
                    ],
                    axis=True,
                    legend=True,
                    plot=PlotOptions(fill=True),
                )
            )

        def cores(p) -> None:
            p.meters(
                w.MetersOptions(
                    items=[w.MeterItem(f"c{i}", 0.15 + i * 0.11) for i in range(8)]
                )
            )

        def processes(p) -> None:
            p.table(
                w.TableOptions(
                    rows=[
                        w.TableRow(("1", "systemd", "0.1", "12M")),
                        w.TableRow(("412", "hqtui", "12.5", "48M")),
                        w.TableRow(("1201", "ruff", "41.8", "1.2G")),
                    ],
                    columns=[
                        w.TableColumn("PID", align="right"),
                        w.TableColumn("NAME"),
                        w.TableColumn("CPU%", align="right"),
                        w.TableColumn("MEM", align="right"),
                    ],
                    selected=1,
                    zebra=True,
                )
            )

        def grid(g) -> None:
            g.panel(Panel(title="Throughput", subtitle="60s"), Cell(), throughput)
            g.panel(Panel(title="Cores"), Cell(), cores)
            g.panel(Panel(title="Processes"), Cell(col_span=2), processes)

        root.row(Layout(size=1), header)
        root.grid(GridSpec(columns=["2fr", "1fr"], rows=[11, "1fr"], gap=1), grid)
        root.status_bar(
            w.StatusBarOptions(
                items=[w.StatusItem("quit", "q"), w.StatusItem("select", "↑↓")],
                right=[w.StatusItem("30fps")],
            )
        )

    screen = render_to_screen(84, 22, "dark", view)
    if arg == "--ansi":
        print(screen.ansi())
    elif arg == "--html":
        print(render_to_html(screen))
    else:
        print(screen.text())


if __name__ == "__main__":
    main()
