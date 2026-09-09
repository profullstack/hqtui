"""The reference widget, graphics, theme, input and stress showcases in Python."""
import math
from hqtui import GridSpec, Cell, ScrollHandlers
from hqtui.buffer import Style
from hqtui.color import Gradient
from hqtui.graphics import DonutOptions, DonutSegment
from hqtui.theme import resolve_theme
from .model import THEMES
from .dashboard import (w,Layout,Panel,row,txt,kv,keys,percent,bytes,data_table,dc,
                        scalar,overlay,PlotOptions,Series,GaugeOptions)

def graphics(ui,s):
    gap=s.panel_gap()
    t=ui.theme;time=s.sample["time"]
    wave=lambda phase,freq:[math.sin(i/freq+phase)*50+50 for i in range(240)]
    a,b,c=wave(time/3,9),wave(time/3+2,5),wave(time/2,17)
    def draw(r):
        def left(p):
            p.panel(Panel(title="Braille (2×4 pixels per cell)"),lambda p:p.graph(w.GraphOptions(values=a,plot=PlotOptions(min=0,max=100,fill=True,color=t.accent,grid=True))))
            p.panel(Panel(title="Block elements"),lambda p:p.graph(w.GraphOptions(values=a,plot=PlotOptions(min=0,max=100,mode="block",colors=t.heat))))
            p.panel(Panel(title="ASCII fallback"),lambda p:p.graph(w.GraphOptions(values=a,plot=PlotOptions(min=0,max=100,mode="ascii",color=t.foreground))))
        r.column(Layout(gap=gap,bordered=True),left)
        def right(p):
            p.panel(Panel(title="Multi-series"),lambda p:p.graph(w.GraphOptions(series=[Series(a,t.primary,"alpha"),Series(b,t.success,"beta"),Series(c,t.secondary,"gamma")],axis=True,legend=True,plot=PlotOptions(min=0,max=100))))
            def gradient(surface):
                steps=Gradient(t.heat).steps(surface.width)
                for y in range(surface.height):
                    for x,color in enumerate(steps): surface.char(x,y,"█",Style(fg=color))
            p.panel(Panel(title="Gradients"),lambda p:p.draw(gradient))
            def canvas(c,surface):
                cx,cy=c.width/2,c.height/2;radius=min(cx,cy)-2;c.circle(cx,cy,radius)
                for i in range(12):
                    angle=i/12*math.pi*2+time/4;c.line(cx,cy,cx+math.cos(angle)*radius,cy+math.sin(angle)*radius*.9)
            p.panel(Panel(title="Raw Braille canvas"),lambda p:p.canvas(canvas,color=t.accent))
        r.column(Layout(gap=gap,bordered=True),right)
    row(ui,"1fr",gap,draw)
def themes(ui,s):
    gap=s.panel_gap()
    ui.label(f'Theme {s.theme_index+1}/9: {ui.theme.name}   ←/→ or F2 to change');ui.spacer(1)
    def grid(g):
        for i,name in enumerate(THEMES):
            e=resolve_theme(name)
            def draw(p,e=e):
                def badges(r):
                    for label,color,width in (("primary",e.primary,10),("ok",e.success,5),("warn",e.warning,7),("err",e.danger,6)):
                        r.badge(w.BadgeOptions(text=label,color=color),Layout(size=width))
                    r.spacer()
                row(p,1,1,badges);p.meter(w.MeterOptions(value=.72,label="cpu",background=e.background))
                p.graph(w.GraphOptions(values=s.sample["cpu"]["history"],plot=PlotOptions(min=0,max=100,fill=True,color=e.graph[0],background=e.background)))
                def ramp(surface):
                    for ci,color in enumerate(e.graph):
                        for x in range(3): surface.char(ci*4+x,0,"█",Style(fg=color,bg=e.background))
                p.draw(ramp,Layout(size=1))
            g.panel(Panel(title=e.name,border_color=e.border_focused if i==s.theme_index else e.border,background=e.background),Cell(),draw)
    ui.grid(GridSpec(columns=3,rows=3,gap=gap),grid)
def input_screen(ui,s):
    gap=s.panel_gap()
    t=ui.theme
    def draw(r):
        def events(p):
            keys(p,[kv("Key",s.last_key,t.accent),kv("Mouse",s.last_mouse,t.primary)]);p.spacer(1);p.divider(w.DividerOptions(label="history"));p.list(w.ListOptions(items=[w.ListItem(v) for v in reversed(s.key_log[-20:])]))
        r.panel(Panel(title="Last Events"),events)
        def controls(p):
            txt(p,"Press any key — modifiers are normalized.",t.foreground);p.label("Arrows, Function keys, Ctrl/Alt/Shift combinations,");p.label("paste, focus, mouse move, click, drag and scroll.");p.spacer(1);p.divider(w.DividerOptions(label="focusable controls"));p.spacer(1)
            def buttons(r):
                r.button(w.ButtonOptions(label="Button A",width=12),layout=Layout(size=12));r.button(w.ButtonOptions(label="Button B",width=12,variant="success"),layout=Layout(size=12))
                r.checkbox(w.CheckboxOptions(label="Check",checked=s.checkbox),lambda:toggle(s,"checkbox"),Layout(size=12));r.spacer()
            row(p,1,2,buttons);p.spacer(1);p.label("Tab / Shift+Tab moves focus. Enter activates.");p.spacer();keys(p,[kv("Mouse tracking","on"),kv("Bracketed paste","on"),kv("Focus events","on")])
        r.panel(Panel(title="Try it"),controls)
    row(ui,"1fr",gap,draw)
def stress(ui,s):
    gap=s.panel_gap()
    t=ui.theme
    def stats(r):
        for title,value,color in (("Render",f'{s.render_ms:.2f} ms/frame',t.success),("Changed cells",str(s.changed_cells),t.warning),("Bytes/frame",str(s.output_bytes),t.primary),("FPS",f'{s.fps:.1f}',t.accent)):
            r.panel(Panel(title=title),lambda p,value=value,color=color:txt(p,value,color))
    row(ui,3,gap,stats)
    def draw(surface):
        ramp=Gradient(t.graph);chars="▖▗▘▙▚▛▜▝▞▟█▓▒░";time=s.sample["time"]
        for y in range(surface.height):
            for x in range(surface.width):
                v=(math.sin(x/6+time)+math.cos(y/4-time))/2;n=(v+1)/2;surface.char(x,y,chars[math.floor(n*(len(chars)-1))],Style(fg=ramp.sample(n)))
    ui.panel(Panel(title="Full-screen churn"),lambda p:p.draw(draw))
def toggle(s,key):
    if not overlay(s): setattr(s,key,not getattr(s,key))
def tree():
    def node(name,cpu,mem,*children): return w.TreeNode(label=name,values=[w.TreeValue(cpu,6),w.TreeValue(mem,6)],children=children)
    return [node("systemd","1.3","0.1",node("bash","0.1","0.2"),node("bun","32.8","4.2",node("bun:worker","12.4","1.8"),node("bun:worker","8.7","1.3")),node("node","18.1","2.1",node("node:worker","6.1","0.8")),node("postgres","6.7","1.8"))]
def handlers(s,name,pane):
    def focus():
        if not overlay(s): s.focused[s.screen]=name
    def scroll(d):
        if not overlay(s): focus();pane.move(d)
    def select(i):
        if not overlay(s): pane.selected=max(0,min(pane.total-1,pane.offset+i))
    return ScrollHandlers(on_focus=focus,on_scroll=scroll,on_select_row=select)
def components(ui,s):
    gap=s.panel_gap()
    t=ui.theme;c,m,n=s.sample["cpu"],s.sample["memory"],s.sample["network"]
    def draw(r):
        def left(left):
            def controls(p):
                def buttons(r):
                    for label,variant,width in (("Primary","primary",11),("Success","success",11),("Warning","warning",11),("Danger","danger",10)):
                        r.button(w.ButtonOptions(label=label,variant=variant,width=width),(lambda:toggle(s,"modal")) if label=="Primary" else None,Layout(size=width))
                    r.spacer()
                row(p,1,1,buttons);p.spacer(1)
                def inputs(r):
                    options=("Dark","Dracula","Nord","Tokyo Night")
                    r.select(w.SelectOptions(value=options[s.select_index%4],width=20,open=s.select_open,options=options,selected_index=s.select_index),lambda:toggle(s,"select_open"),Layout(size=20))
                    r.checkbox(w.CheckboxOptions(label="Toggle",checked=s.toggle,variant="toggle"),lambda:toggle(s,"toggle"),Layout(size=12))
                    r.checkbox(w.CheckboxOptions(label="Checkbox",checked=s.checkbox),lambda:toggle(s,"checkbox"),Layout(size=14));r.spacer()
                row(p,1,2,inputs);p.spacer(1);p.text_input(w.TextInputOptions(label="Search",value=s.input_value,placeholder="type to filter…",focused=s.editing),Layout(size=1));p.spacer(1)
                p.meter(w.MeterOptions(label="Slider",value=s.slider,style="smooth",heat=False,color=t.primary));p.progress(w.ProgressOptions(label="Progress",value=37,max=120,show_count=True))
            left.panel(Panel(title="Buttons & Inputs",size=13),controls)
            files=[dict(zip(("name","size","type","modified"),v)) for v in (("src","4.2 KB","dir","2m ago"),("test","1.1 KB","dir","5m ago"),("package.json","1.2 KB","file","10m ago"),("README.md","3.4 KB","file","1h ago"),("bun.lockb","12 KB","file","1h ago"))]
            left.panel(Panel(title="Table Widget"),lambda p:data_table(p,s,"components.files",files,[dc("name","Name",minimum=10,color=t.primary),dc("size","Size",9,right=True),dc("type","Type",6),dc("modified","Modified",10,color=t.muted,right=True)],True,scrollbar=False))
            def logs(p):
                data=s.sample["logs"];pane=s.pane("components.logs",len(data));pane.log=True;h=handlers(s,"components.logs",pane)
                def scroll(d):
                    if not overlay(s): h.on_focus();pane.offset=max(0,min(max(0,len(data)-1),pane.offset-d))
                p.log(w.LogOptions(entries=[w.LogEntry(time=d["time"],level=d["level"],message=d["message"],meta="{"+d["meta"]+"}") for d in data],from_end=pane.offset,scrollbar=True),ScrollHandlers(on_focus=h.on_focus,on_scroll=scroll))
            left.panel(Panel(title="Log Viewer",size=11),logs)
        r.column(Layout(gap=gap,bordered=True),left)
        def right(right):
            def processes(p):
                row(p,1,0,lambda r:(r.text("Name",w.TextStyle(fg=t.muted,bold=True)),r.text("CPU%   MEM%",w.TextStyle(fg=t.muted,bold=True,align="right"))))
                pane=s.pane("components.tree",8);p.tree(w.TreeOptions(nodes=tree(),selected=pane.selected,offset=pane.offset,follow_selection=True),handlers(s,"components.tree",pane))
            right.panel(Panel(title="Process Tree",size=13),processes)
            def gauges(p):
                p.sparkline(w.SparklineWidgetOptions(label="CPU ",values=c["history"],text=percent(c["total"]),color=t.success));p.sparkline(w.SparklineWidgetOptions(label="Mem ",values=m["history"],text=percent(m["used"]/max(1,m["total"])),color=t.warning));p.sparkline(w.SparklineWidgetOptions(label="Net ",values=n["downHistory"],text=bytes(n["downRate"])+"/s",color=t.primary));p.spacer(1)
                row(p,"1fr",2,lambda r:(r.gauge(GaugeOptions(value=c["total"],label=percent(c["total"]))),r.donut(DonutOptions(segments=[DonutSegment(m["used"],t.primary,"Used"),DonutSegment(m["available"],t.warning,"Free")]))))
            right.panel(Panel(title="Sparklines & Gauges",size=12),gauges)
            def lists(p):
                row(p,1,1,lambda r:(r.badge(w.BadgeOptions(text="active",color=t.success),Layout(size=10)),r.badge(w.BadgeOptions(text="idle",color=t.warning,variant="subtle"),Layout(size=8)),r.badge(w.BadgeOptions(text="failed",color=t.danger,variant="outline"),Layout(size=10)),r.spacer()))
                p.spacer(1);pane=s.pane("components.list",4);p.list(w.ListOptions(items=[w.ListItem("apps/demo",color=t.primary),w.ListItem("packages/hqtui"),w.ListItem("apps/web"),w.ListItem("docs")],selected=pane.selected,offset=pane.offset,follow_selection=True,bullet="▸",scrollbar=True),handlers(s,"components.list",pane))
            right.panel(Panel(title="Lists & Badges"),lists)
        r.column(Layout(gap=gap,bordered=True),right)
    row(ui,"1fr",gap,draw)
