"""A live dashboard: ``python examples/dashboard.py``.

Shows the shape a real Python app takes: the view and the handlers both close
over the same state, which is exactly how the TypeScript reference reads.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import hqtui.widgets as w
from hqtui import App, Cell, GridSpec, Layout, Panel, ScrollHandlers
from hqtui.graphics import PlotOptions, Series

TABS = ["cpu", "net", "procs"]


@dataclass
class State:
    cpu: list[float] = field(default_factory=list)
    net: list[float] = field(default_factory=list)
    selected: int = 0
    tab: int = 0
    started: float = field(default_factory=time.monotonic)
    procs: list[tuple[int, str, float]] = field(
        default_factory=lambda: [
            (1, "systemd", 0.1),
            (412, "hqtui-demo", 12.5),
            (900, "python", 3.2),
            (1201, "ruff", 41.8),
            (1888, "ssh", 0.4),
        ]
    )

    def tick(self) -> None:
        """Something that looks like a machine under load, with no data source."""
        t = time.monotonic() - self.started
        _push(self.cpu, math.sin(t * 1.7) * 0.3 + math.cos(t * 0.4) * 0.2 + 0.5)
        _push(self.net, (math.sin(t * 0.9) * 0.5 + 0.5) * 90)


def _push(values: list[float], value: float) -> None:
    values.append(value)
    if len(values) > 400:
        del values[0]


def main() -> None:
    state = State()
    app = App()

    # Handlers close over the same object the view reads. No plumbing.
    def on_key(event) -> None:
        if event.name == "down":
            state.selected = min(state.selected + 1, len(state.procs) - 1)
        elif event.name == "up":
            state.selected = max(state.selected - 1, 0)
        elif event.name == "left":
            state.tab = max(state.tab - 1, 0)
        elif event.name == "right":
            state.tab = min(state.tab + 1, len(TABS) - 1)

    app.on("key", on_key)

    def view(f) -> None:
        state.tick()
        cpu_now = state.cpu[-1] if state.cpu else 0.0
        net_now = state.net[-1] if state.net else 0.0

        def header(r) -> None:
            r.heading("hqtui — python")
            r.spacer("fill")
            r.badge(w.BadgeOptions(text="LIVE"))

        def load(p) -> None:
            p.meter(w.MeterOptions(value=cpu_now, label="cpu"))
            p.sparkline(
                w.SparklineWidgetOptions(
                    values=state.net, label="net", text=f"{net_now:.0f}M"
                )
            )
            p.graph(
                w.GraphOptions(
                    series=[
                        Series(values=[v * 100 for v in state.cpu], label="cpu"),
                        Series(values=state.net, label="net"),
                    ],
                    axis=True,
                    legend=True,
                    plot=PlotOptions(fill=True),
                )
            )

        def procs(p) -> None:
            rows = [
                w.TableRow((str(pid), name, f"{cpu:.1f}"))
                for pid, name, cpu in state.procs
            ]
            p.table(
                w.TableOptions(
                    rows=rows,
                    columns=[
                        w.TableColumn("PID", align="right"),
                        w.TableColumn("NAME"),
                        w.TableColumn("CPU%", align="right"),
                    ],
                    selected=state.selected,
                    follow_selection=True,
                    zebra=True,
                    scrollbar=True,
                ),
                # The wheel and a click both act on whatever is under the
                # pointer, which is what the hit region is for.
                ScrollHandlers(
                    on_scroll=lambda d: setattr(
                        state, "selected",
                        max(0, min(state.selected + d, len(state.procs) - 1)),
                    ),
                    on_select_row=lambda row: setattr(
                        state, "selected", max(0, min(row, len(state.procs) - 1))
                    ),
                ),
            )

        def grid(g) -> None:
            g.panel(Panel(title="Load"), Cell(), load)
            g.panel(Panel(title="Processes"), Cell(), procs)

        f.ui.row(Layout(size=1), header)
        f.ui.tabs(
            w.TabsOptions(tabs=TABS, active=state.tab),
            lambda i: setattr(state, "tab", i),
        )
        f.ui.grid(GridSpec(columns=["1fr", "1fr"], rows=["1fr"], gap=1), grid)
        f.ui.status_bar(
            w.StatusBarOptions(
                items=[
                    w.StatusItem("quit", "q"),
                    w.StatusItem("select", "↑↓"),
                    w.StatusItem("tab", "←→"),
                ],
                right=[w.StatusItem(f"{f.width}x{f.height}")],
            )
        )

    # The graphs are animated, so redraw every tick rather than only on input.
    app.options.always_render = True
    app.render(view)
    app.start()


if __name__ == "__main__":
    main()
