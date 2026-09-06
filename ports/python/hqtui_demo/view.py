"""The ten-screen reference application, rendered exclusively with Python hqtui."""
from __future__ import annotations

import math

import hqtui.widgets as w
from hqtui import Cell, GridSpec, Layout, Panel, ScrollHandlers
from hqtui.graphics import GaugeOptions, PlotOptions, Series
from hqtui.ui import HitRegion
from hqtui.widgets.table import resolve_offset

from .model import SCREENS, THEMES, State


def size(value: float) -> str:
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if abs(value) < 1024 or unit == "TiB":
            return f"{value:.1f} {unit}"
        value /= 1024
    return ""


def display(value) -> str:
    if isinstance(value, float): return f"{value:.1f}"
    if isinstance(value, (list, dict)): return str(value)
    return str(value)


def table(ui, state: State, name: str, rows: list, columns: list[tuple[str, str]]) -> None:
    """Offset is calculated against the final surface, including mouse mapping."""
    pane = state.pane(name, len(rows))
    def draw(surface):
        pane.offset = resolve_offset(pane.offset, pane.selected, max(0, surface.height - 1), len(rows), True)
        w.draw_table(surface, w.TableOptions(
            rows=[w.TableRow(tuple(display(row.get(key, "—")) for key, _ in columns)) for row in rows],
            columns=[w.TableColumn(title) for _, title in columns],
            selected=pane.selected if rows else None, offset=pane.offset, zebra=True, scrollbar=True))
        def focus(): state.focused[state.screen] = name
        def scroll(delta): focus(); pane.move(delta)
        def click(x, y, button):
            focus()
            if y > 0: pane.selected = min(max(0, len(rows) - 1), pane.offset + y - 1)
        ui.ctx.hit(HitRegion(rect=surface.hit_rect(), on_scroll=scroll, on_click=click))
        if not rows: surface.text(0, 2, "No data available")
    ui.draw(draw)


def graph(ui, values, label="", second=None):
    series = [Series(values=values, label=label)]
    if second is not None: series.append(Series(values=second, label="out"))
    ui.graph(w.GraphOptions(series=series, axis=True, legend=bool(label), plot=PlotOptions(fill=True)))


def pairs(ui, values):
    for label, value in values:
        ui.text(f"{label:<15} {display(value)}")


def dashboard(ui, s: State):
    data = s.sample
    def cpu(p):
        c = data["cpu"]
        p.label(f'{c["model"]}  {c["frequencyGhz"]:.1f} GHz')
        graph(p, c["history"], "CPU %")
        p.meters(w.MetersOptions(items=[w.MeterItem(label=f"P{i}", value=v) for i, v in enumerate(c["cores"])], columns=2 if p.width > 35 else 1))
        p.label("Load  " + "  ".join(f"{n:.2f}" for n in c["load"]))
    def memory(p):
        m = data["memory"]
        p.meter(w.MeterOptions(value=m["used"], max=max(1, m["total"]), label="RAM"))
        pairs(p, [(name.title(), size(m[name])) for name in ("used", "available", "cached", "buffers", "free")])
        p.meter(w.MeterOptions(value=m["swapUsed"], max=max(1, m["swapTotal"]), label="Swap"))
        graph(p, m["history"])
    def disks(p):
        for d in data["disks"][:2]:
            p.label(d["device"] + "  " + d["mount"])
            p.meter(w.MeterOptions(value=d["used"], max=max(1, d["total"]), text=size(d["used"])))
            p.label(f'Read {size(d["readRate"])}/s  Write {size(d["writeRate"])}/s')
            graph(p, d["readHistory"], "read", d["writeHistory"])
        if not data["disks"]: p.label("No disks reported")
    def system(p):
        pairs(p, [(k.title(), data["system"][k]) for k in ("hostname", "os", "kernel", "shell", "processCount", "threadCount")])
        pairs(p, [("Uptime", f'{data["system"]["uptime"] / 3600:.1f}h'), ("Source", s.source)])
        graph(p, data["cpu"]["history"], "CPU history")
    def procs(p):
        p.label(f"F3 filter: {s.filter or 'all'}   F6 sort: {s.sort}")
        table(p, s, "dashboard.processes", s.processes(), [(k, v) for k,v in (("pid","PID"),("name","Name"),("cpu","CPU%"),("mem","MEM%"),("threads","THR"),("state","S"),("user","User"),("command","Command"))])
    def network(p):
        n = data["network"]
        p.label(f'Down {size(n["downRate"])}/s   Up {size(n["upRate"])}/s')
        graph(p, n["downHistory"], "down", n["upHistory"])
        pairs(p, [("Received", size(n["downTotal"])), ("Sent", size(n["upTotal"]))])
    def temperatures(p):
        for t in data["temperatures"][:12]:
            p.meter(w.MeterOptions(label=t["label"], value=t["value"], max=t.get("max") or 100, text=f'{t["value"]:.0f}°C'))
        if not data["temperatures"]: p.label("No thermal sensors available")
    def sensors(p):
        for sensor in data["sensors"][:14]: p.label(f'{sensor["label"]}: {sensor["value"]}')
        if not data["sensors"]: p.label("No sensor readings available")
    def logs(p): table(p,s,"dashboard.logs", data["logs"], [("time","Time"),("level","Level"),("message","Message")])
    panels = [("CPU Overview",cpu),("Memory & Swap",memory),("Disks",disks),("System",system),("Processes",procs),("Network",network),("Temperatures",temperatures),("Sensors",sensors),("Logs",logs)]
    # Preserve a useful compact dashboard rather than squeezing eight panels
    # into a terminal too small to show their contents.
    if ui.width < 90 or ui.height < 46: panels = [panels[0],panels[4],panels[1],panels[5]]
    grid(ui, panels, 3 if ui.width >= 160 and len(panels)>4 else 2)


def grid(ui, panels, columns=2):
    if ui.width < 45: columns=1
    def build(g):
        for title, draw in panels: g.panel(Panel(title=title), Cell(), draw)
    ui.grid(GridSpec(columns=["1fr"]*columns, rows=["1fr"]*math.ceil(len(panels)/columns), gap=1),build)


def telemetry(ui, s: State):
    t=s.sample["telemetry"]
    def tab(title, key, columns):
        return (title, lambda p: table(p,s,s.screen+"."+key,t[key],columns))
    def trace(title, key): return (title,lambda p: graph(p,t[key],title))
    if s.screen=="sessions":
        panels=[tab("Active Sessions","sessions",[("user","User"),("tty","TTY"),("from","From"),("idle","Idle"),("what","Command")]),
                tab("Login History","logins",[("user","User"),("tty","TTY"),("from","From"),("when","When"),("status","Status")]),
                tab("SSH Authentication","ssh",[("time","Time"),("action","Action"),("user","User"),("from","From")]),trace("Session History","sessionHistory")]
    elif s.screen=="network":
        panels=[tab("Interfaces","interfaces",[("name","Name"),("state","State"),("rxRate","RX B/s"),("txRate","TX B/s"),("errors","Errors"),("drops","Drops")]),
                tab("Connections","connections",[("proto","Proto"),("state","State"),("local","Local"),("remote","Remote"),("process","Process")]),
                tab("Listeners","listeners",[("proto","Proto"),("address","Address"),("port","Port"),("process","Process")]),trace("Connection History","connectionHistory")]
    elif s.screen=="services":
        panels=[tab("Services","services",[("name","Unit"),("active","State"),("description","Description")]),
                tab("Filesystems","filesystems",[("mount","Mount"),("device","Device"),("type","Type"),("used","Used B"),("size","Size B")]),
                ("Kernel",lambda p:pairs(p,[(k,v) for k,v in t["kernel"].items()][:15])),
                tab("Journal","journal",[("time","Time"),("level","Level"),("unit","Unit"),("message","Message")])]
    else:
        def http(p):
            h=t["http"]
            if not h: p.label("HTTP access log unavailable (read-only)"); return
            p.label(f'{h["requestsPerSecond"]:.1f} req/s  {h["total"]} total')
            table(p,s,"traffic.http",h["recent"],[("time","Time"),("method","Method"),("path","Path"),("status","Status"),("client","Client")])
        panels=[tab("Protocols","protocols",[("protocol","Protocol"),("inbound","In"),("outbound","Out"),("total","Total")]),
                ("TCP Segments",lambda p:graph(p,t["netInHistory"],"in",t["netOutHistory"])),trace("Retransmits","retransHistory"),
                ("HTTP",http),tab("Remote Hosts","remotes",[("host","Host"),("connections","Connections"),("protocols","Protocols")]),
                tab("SSH Authentication","ssh",[("time","Time"),("action","Action"),("user","User"),("from","From")])]
    if s.screen=="sessions": panels.append(tab("Failed Logins","failedLogins",[("user","User"),("tty","TTY"),("from","From"),("when","When"),("status","Status")]))
    if s.screen=="traffic" and s.source=="real": ui.label("Protocol/direction: port-based estimates; HTTP rate: estimated from log growth")
    grid(ui,panels,3 if s.screen=="traffic" and ui.width>=120 else 2)


def components(ui,s):
    def controls(p):
        p.label("Click controls; e edits text; Esc finishes editing")
        for variant in ("primary","success","warning","danger","ghost"):
            p.button(w.ButtonOptions(label=variant.title(),variant=variant),lambda:setattr(s,"modal",True))
        p.checkbox(w.CheckboxOptions(label="Notifications",checked=s.checkbox),lambda:setattr(s,"checkbox",not s.checkbox))
        p.checkbox(w.CheckboxOptions(label="Live updates",checked=s.toggle,variant="toggle"),lambda:setattr(s,"toggle",not s.toggle))
        p.select(w.SelectOptions(value=THEMES[s.select_index],options=THEMES,selected_index=s.select_index,open=s.select_open),lambda:setattr(s,"select_open",not s.select_open))
        p.text_input(w.TextInputOptions(value=s.input_value,placeholder="Type here",focused=s.editing))
    def meters(p):
        for i in range(8): p.meter(w.MeterOptions(value=(i+1)/8,label=f"Meter {i+1}",style="segmented" if i%2 else "smooth"))
        p.gauge(GaugeOptions(value=s.sample["cpu"]["total"],label="CPU"))
    def text(p):
        p.heading("Typography & Unicode")
        p.text("Readable, clipped and dependency-free")
        p.label("日本語 中文 한국어 • café • 🚀")
        for label in ("READY","WARNING","LIVE"): p.badge(w.BadgeOptions(text=label))
        p.divider()
        p.button(w.ButtonOptions(label="Open command palette"),lambda:setattr(s,"palette",True))
        graph(p,s.sample["cpu"]["history"],"History")
    grid(ui,[("Controls",controls),("Meters & Gauge",meters),("Text & Badges",text)],3)


def graphics(ui,s):
    def canvas(c,surface):
        for x in range(c.width):
            y=int((.5+.35*math.sin(x/12+s.sample["time"]))*max(0,c.height-1))
            c.pixel(x,y)
    grid(ui,[("Braille Canvas",lambda p:p.canvas(canvas)),
             ("CPU Plot",lambda p:graph(p,s.sample["cpu"]["history"],"CPU %")),
             ("Network Plot",lambda p:graph(p,s.sample["network"]["downHistory"],"down",s.sample["network"]["upHistory"])),
             ("Gauge",lambda p:p.gauge(GaugeOptions(value=s.sample["cpu"]["total"],label="CPU")))])


def themes(ui,s):
    def picker(p):
        p.label("F2 or Left/Right to switch themes")
        for i,name in enumerate(THEMES):
            p.button(w.ButtonOptions(label=("● " if i==s.theme_index else "  ")+name),lambda index=i:setattr(s,"theme_index",index))
    def preview(p):
        p.heading(THEMES[s.theme_index])
        for name in ("primary","secondary","accent","success","warning","danger","muted"):
            p.meter(w.MeterOptions(value=.7,label=name,color=getattr(p.theme,name)))
        graph(p,s.sample["cpu"]["history"],"Preview")
    grid(ui,[("Built-in Themes",picker),("Live Preview",preview)])


def input_screen(ui,s):
    def events(p):
        p.text("Last key: "+s.last_key)
        p.text("Mouse: "+s.last_mouse)
        p.label("e to edit; Esc exits text input")
        p.text_input(w.TextInputOptions(value=s.input_value,focused=s.editing,placeholder="UTF-8 + paste"))
        table(p,s,"input.events",[{"event":v} for v in reversed(s.key_log)],[("event","Key Events")])
    def diagnostics(p):
        pairs(p,[("Renderer","native Python"),("Source",s.source),("FPS",s.fps),("Render ms",s.render_ms),("Changed cells",s.changed_cells),("Output bytes",s.output_bytes)])
        p.label("Arrows scroll only the focused pane")
        p.label("Ctrl+K palette · F1 help · q quit")
    grid(ui,[("Input Inspector",events),("Diagnostics",diagnostics)])


def stress(ui,s):
    panels=[]
    for i in range(12):
        def draw(p,index=i):
            p.meter(w.MeterOptions(value=(math.sin(s.sample["time"]+index)+1)/2,label=f"Load {index+1}"))
            graph(p,s.sample["cpu"]["history"])
        panels.append((f"Stress {i+1:02d}",draw))
    grid(ui,panels,4 if ui.width>=120 else 3)


def render(ui,s: State):
    ui.row(Layout(size=1),lambda r:(r.heading("hqtui — python"),r.spacer(),r.label(f'{s.source.upper()}  {"PAUSED" if s.paused else "LIVE"}')))
    # Split the tab bar at a narrow width so every screen remains reachable.
    groups=[SCREENS] if ui.width>=150 else [SCREENS[:5],SCREENS[5:]]
    for group in groups:
        start=SCREENS.index(group[0])
        ui.tabs(w.TabsOptions(tabs=[f'{(start+i+1)%10} {name}' for i,name in enumerate(group)],active=SCREENS.index(s.screen)-start),lambda i,base=start:setattr(s,"screen",SCREENS[base+i]))
    if ui.width<30 or ui.height<12:
        ui.text("Terminal too small; resize to 30×12 or larger")
        ui.spacer()
    else:
        fn={"dashboard":dashboard,"components":components,"graphics":graphics,"themes":themes,"input":input_screen,"stress":stress}.get(s.screen,telemetry)
        ui.column(Layout(size="fill"),lambda body:fn(body,s))
    if s.unavailable: ui.label("Unavailable: "+", ".join(s.unavailable))
    ui.status_bar(w.StatusBarOptions(items=[w.StatusItem("help","F1"),w.StatusItem("theme","F2"),w.StatusItem("filter","F3"),w.StatusItem("palette","^K"),w.StatusItem("quit","q")],right=[w.StatusItem(f'{s.screen} · {THEMES[s.theme_index]}')]))
    if s.filtering: ui.modal(w.ModalOptions(title="Filter Processes",message=s.filter+"▏\nEnter applies · Esc clears",width=60))
    if s.help: ui.modal(w.ModalOptions(title="hqtui — Help",width=66,message="1–9/0 / Tab: screen\nF2: theme  F3: filter  F6: sort\nCtrl+K: command palette  Space: pause\nArrows / PgUp / PgDn / Home / End: scroll\nMouse: tabs, controls, selection and wheel\ne: edit text in Components/Input\nq / Ctrl+C: quit   Any key: close help"))
    if s.modal: ui.modal(w.ModalOptions(title="Read-only Demo",message="No process will be killed and no service changed.\nPress any key to close.",width=58))
    if s.palette: ui.command_palette(w.CommandPaletteOptions(query=s.palette_query,items=[w.PaletteItem(label,hint) for label,hint in s.commands()],selected=s.palette_index,placeholder="Search commands"))
