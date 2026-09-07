"""Native reference dashboard. Cell expectations come from the TypeScript app."""
from __future__ import annotations
import math
import hqtui.widgets as w
from hqtui import Layout, Panel, ScrollHandlers
from hqtui.graphics import GaugeOptions, PlotOptions, Series
from hqtui.theme import heat_color
from hqtui.widgets.table import resolve_offset

def scalar(v):
    if v is None: return "—"
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    return str(v)

def bytes(v, digits=2):
    if v is None or not math.isfinite(v): return "—"
    v=max(0,v)
    for unit in ("B","KiB","MiB","GiB","TiB","PiB"):
        if v<1024 or unit=="PiB": return f'{v:.{0 if unit=="B" else digits}f} {unit}'
        v/=1024

def percent(v): return f'{math.floor(max(0,min(1,v))*100+.5)}%'
def bit_rate(v):
    v=max(0,v)*8
    for scale,unit in ((1e9,"Gb/s"),(1e6,"Mb/s"),(1e3,"Kb/s")):
        if v>=scale: return f'{v/scale:.1f} {unit}'
    return f'{v:.0f} b/s'
def byte_rate(v):
    for scale,unit in ((1e9,"GB/s"),(1e6,"MB/s"),(1e3,"KB/s")):
        if v>=scale: return f'{v/scale:.1f} {unit}'
    return f'{max(0,v):.0f} B/s'
def duration(v):
    v=int(max(0,v));d,h,m=v//86400,v%86400//3600,v%3600//60
    if d: return f'{d}d {h}h {m}m'
    if h: return f'{h}h {m}m'
    return f'{m}m {v%60}s'
def row(p,size,gap,fn): p.row(Layout(size=size,gap=gap),fn)
def col(p,size,fn): p.column(Layout(size=size),fn)
def txt(p,value,color): p.text(value,w.TextStyle(fg=color))
def kv(label,value,color=None): return w.KeyValueRow(label,scalar(value),color=color)
def keys(p,rows,spread=True): p.key_values(w.KeyValueOptions(rows=rows,spread=spread))
def plot(p,values,color,maximum=None,axis=False): p.graph(w.GraphOptions(values=values,axis=axis,plot=PlotOptions(min=0,max=maximum,fill=True,color=color)))
def multi(p,a,b,ca,cb): p.graph(w.GraphOptions(series=[Series(values=a,color=ca,fill=True),Series(values=b,color=cb,fill=True)],plot=PlotOptions(min=0)))
def meter(p,value,color=None): p.meter(w.MeterOptions(value=value,color=color,show_value=False,style="segmented"))
def overlay(s): return s.help or s.modal or s.palette or s.filtering

def data_table(p,s,name,data,columns,zebra=False,header=True,scrollbar=True):
    p.column(Layout(),lambda surface:_data_table(surface,s,name,data,columns,zebra,header,scrollbar))

def _data_table(p,s,name,data,columns,zebra=False,header=True,scrollbar=True):
    """Columns are (field, widget options, optional formatter, optional color)."""
    pane=s.pane(name,len(data))
    pane.offset=resolve_offset(pane.offset,pane.selected,max(0,p.height-int(header)),len(data),True)
    rows=[]
    for d in data:
        rows.append(w.TableRow([fmt(d) if fmt else scalar(d.get(key)) for key,c,fmt,color in columns],cell_colors=[color(d) if color else c.color for key,c,fmt,color in columns]))
    def focus():
        if not overlay(s): s.focused[s.screen]=name
    def scroll(delta):
        if not overlay(s): focus();pane.move(delta)
    def select(i):
        if not overlay(s): pane.selected=min(max(0,len(data)-1),pane.offset+i)
    p.table(w.TableOptions(rows=rows,columns=[c for _,c,_,_ in columns],selected=pane.selected,offset=pane.offset,follow_selection=True,zebra=zebra,scrollbar=scrollbar,header=header),ScrollHandlers(on_focus=focus,on_scroll=scroll,on_select_row=select))
def dc(key,title,width=None,minimum=None,color=None,right=False,fmt=None,cell_color=None):
    return key,w.TableColumn(title,width=width,min=minimum,color=color,align="right" if right else "left"),fmt,cell_color

def cpu_panel(ui,s,columns):
    c=s.sample["cpu"]
    def draw(p):
        t=p.theme;p.label(f'{c["model"]}   {c["frequencyGhz"]:.1f} GHz');plot(p,c["history"],t.success,100)
        p.meters(w.MetersOptions(items=[w.MeterItem(label=f'P{i}',value=v) for i,v in enumerate(c["cores"])],columns=columns,label_width=4,value_width=5,style="segmented"))
        p.divider();keys(p,[kv("Load Avg","   ".join(f'{v:.2f}' for v in c["load"]),t.warning)])
    ui.panel(Panel(title="CPU Overview",subtitle=percent(c["total"])),draw)
def memory_panel(ui,s):
    m=s.sample["memory"];used=m["used"]/max(1,m["total"]);swap=m["swapUsed"]/max(1,m["swapTotal"])
    def draw(p):
        t=p.theme;txt(p,f'Memory      {bytes(m["used"])} / {bytes(m["total"])} ({percent(used)})',t.foreground);meter(p,used);p.spacer(1)
        keys(p,[kv(label,bytes(m[key]),color) for key,label,color in (("used","Used:",t.warning),("available","Available:",t.success),("cached","Cached:",t.accent),("buffers","Buffers:",t.secondary),("free","Free:",t.muted))])
        p.spacer();p.divider();txt(p,f'Swap        {bytes(m["swapUsed"])} / {bytes(m["swapTotal"])} ({percent(swap)})',t.foreground);meter(p,swap,t.secondary)
        keys(p,[kv("Used:",bytes(m["swapUsed"]),t.secondary),kv("Free:",bytes(m["swapTotal"]-m["swapUsed"]),t.muted)])
    ui.panel(Panel(title="Memory & Swap"),draw)
def disks_panel(ui,s):
    disks=s.sample["disks"]
    def draw(p):
        t=p.theme
        if not disks: p.label("No disks reported");return
        for i,d in enumerate(disks[:2]):
            used=d["used"]/max(1,d["total"])
            txt(p,f'{d["device"]} — {bytes(d["total"])} ({d["type"]})',t.foreground);txt(p,f'Used: {bytes(d["used"])} ({percent(used)})',t.muted);meter(p,used);txt(p,"Free: "+bytes(d["total"]-d["used"]),t.muted)
            row(p,1,0,lambda r,d=d:(txt(r,"Read: "+byte_rate(d["readRate"]),t.success),r.text("Write: "+byte_rate(d["writeRate"]),w.TextStyle(fg=t.secondary,align="right"))))
            multi(p,d["readHistory"],d["writeHistory"],t.success,t.secondary)
            if i==0 and len(disks)>1: p.divider()
    ui.panel(Panel(title="Disks"),draw)
def system_panel(ui,s):
    sys,c,m=s.sample["system"],s.sample["cpu"],s.sample["memory"];used=m["used"]/max(1,m["total"]);count=sys["processCount"] or len(s.sample["processes"])
    def draw(p):
        t=p.theme
        def summary(r):
            keys(r,[kv("OS:",sys["os"]),kv("Kernel:",sys["kernel"]),kv("Uptime:",duration(sys["uptime"])),kv("Hostname:",sys["hostname"]),kv("Shell:",sys["shell"]),kv("Source:","simulated" if s.source=="simulated" else "linux/proc",t.accent)],False)
            keys(r,[kv("CPU:",percent(c["total"]),heat_color(t,c["total"])),kv("Memory:",f'{percent(used)} ({bytes(m["used"])})',t.warning),kv("Swap:",percent(m["swapUsed"]/m["swapTotal"]) if m["swapTotal"] else "—",t.secondary),kv("Load:"," ".join(f'{v:.2f}' for v in c["load"])),kv("Processes:",count),kv("Threads:",sys["threadCount"])],False)
        p.row(Layout(size=6,min=6,gap=2),summary)
        p.panel(Panel(title="CPU History",min=5),lambda g:plot(g,c["history"],t.success,100,True))
        if p.width>=46 and p.height>=16:
            def stats(r):
                r.panel(Panel(title="Quick Stats"),lambda q:keys(q,[kv("Uptime",duration(sys["uptime"]),t.accent),kv("Procs",count,t.accent),kv("Threads",sys["threadCount"] or "—",t.accent),kv("Ctx/s",f'{s.sample["telemetry"]["kernel"]["contextSwitchRate"]/1000:.1f}K',t.accent)]))
                r.panel(Panel(title="Memory"),lambda q:(txt(q,percent(used),t.warning),plot(q,m["history"],t.primary,100)))
                temp=next(iter(s.sample["temperatures"]),None)
                r.panel(Panel(title="Temp",size=14),lambda q:q.gauge(GaugeOptions(value=min(1,temp["value"]/(temp["max"] or 100)) if temp else c["total"],label=f'{math.floor(temp["value"]+.5)}°C' if temp else percent(c["total"]))))
            row(p,6,1,stats)
        else:
            p.divider();keys(p,[kv("Threads",sys["threadCount"],t.accent),kv("Ctx switches",f'{sys["contextSwitches"]/1000:.1f}K',t.accent)])
    ui.panel(Panel(title="System"),draw)
def processes_panel(ui,s):
    def draw(p):
        t=p.theme
        columns=[dc("pid","PID",7,right=True),dc("name","Name",minimum=8,color=t.primary),dc("cpu","CPU%",6,right=True,fmt=lambda d:f'{d["cpu"]:.1f}',cell_color=lambda d:heat_color(t,min(1,d["cpu"]/100))),dc("mem","MEM%",6,color=t.warning,right=True,fmt=lambda d:f'{d["mem"]:.1f}'),dc("rss","RSS",9,right=True,fmt=lambda d:bytes(d["rss"],0)),dc("threads","Threads",7,right=True),dc("state","S",2,cell_color=lambda d:t.success if d["state"]=="R" else t.muted),dc("user","User",10,color=t.muted),dc("command","Command",minimum=10,color=t.muted)]
        data_table(p,s,"dashboard.processes",s.processes(),columns)
    ui.panel(Panel(title=f'Processes (sorted by {s.sort.upper()})',subtitle="filter: "+s.filter if s.filter else "",focusable=True),draw)
def network_panel(ui,s):
    n=s.sample["network"]
    def draw(p):
        t=p.theme;row(p,1,0,lambda r:(txt(r,"Download: "+bit_rate(n["downRate"]),t.primary),r.text("Upload: "+bit_rate(n["upRate"]),w.TextStyle(fg=t.secondary,align="right"))))
        for prefix,color in (("down",t.primary),("up",t.secondary)):
            p.graph(w.GraphOptions(values=n[prefix+"History"],axis=True,axis_format=lambda v:bit_rate(v).replace(" ",""),plot=PlotOptions(min=0,fill=True,color=color)))
        p.divider()
        def totals(r):
            for prefix,color in (("down",t.primary),("up",t.secondary)):
                keys(r,[kv("Total:",bytes(n[prefix+"Total"]),color),kv("Current:",bit_rate(n[prefix+"Rate"]),color),kv("Peak:",bit_rate(n[prefix+"Peak"]),color)],False)
        row(p,3,2,totals)
    ui.panel(Panel(title="Network"),draw)
def disk_usage_panel(ui,s):
    disks=s.sample["disks"];first=disks[0] if disks else {}
    def draw(p):
        t=p.theme
        for d in disks:
            used=d["used"]/max(1,d["total"]);p.meter(w.MeterOptions(value=used,text=f'{percent(used)} {bytes(d["used"],0)} / {bytes(d["total"],0)}',style="segmented"));p.label(f'{d["mount"]} ({d["device"]})')
        p.spacer(1)
        def io(p):
            def columns(r):
                for prefix,label,color in (("read","Read: ",t.success),("write","Write: ",t.secondary)):
                    col(r,"fill",lambda c,prefix=prefix,label=label,color=color:(txt(c,label+byte_rate(first.get(prefix+"Rate",0)),color),plot(c,first.get(prefix+"History",[]),color)))
            row(p,"fill",2,columns)
        p.panel(Panel(title="I/O Summary"),io)
    ui.panel(Panel(title="Disk Usage",subtitle=first.get("device","")),draw)
def temperatures_panel(ui,s):
    def draw(p):
        t=p.theme;temps=s.sample["temperatures"]
        if not temps:
            txt(p,"No thermal sensors on this host.",t.muted);p.spacer(1);p.label("Run with --sim to see this panel populated.");return
        for temp in temps[:10]:
            v=min(1,temp["value"]/(temp["max"] or 100))
            row(p,1,0,lambda r,temp=temp,v=v:(r.text(temp["label"],w.TextStyle(fg=t.muted),Layout(size=16)),r.heat_bar(w.HeatBarOptions(value=v)),r.text(f'{math.floor(temp["value"]+.5)}°C',w.TextStyle(fg=heat_color(t,v),align="right"),Layout(size=6))))
    ui.panel(Panel(title="Temperatures"),draw)
def sensors_panel(ui,s):
    def draw(p):
        sensors=s.sample["sensors"]
        if not sensors:
            p.label("No hardware sensors on this host.");p.spacer(1);p.label("Probed: /sys/class/hwmon, thermal zones, lm-sensors,");p.label("power supplies and nvidia-smi.");return
        keys(p,[kv(v["label"],v["value"],p.theme.accent) for v in sensors])
    ui.panel(Panel(title="Sensors"),draw)
def logs_panel(ui,s):
    def draw(p):
        data=s.sample["logs"];pane=s.pane("dashboard.logs",len(data));pane.log=True
        def focus():
            if not overlay(s): s.focused[s.screen]="dashboard.logs"
        def scroll(d):
            if not overlay(s): focus();pane.offset=max(0,min(max(0,len(data)-1),pane.offset-d))
        p.log(w.LogOptions(entries=[w.LogEntry(time=d["time"],level=d["level"],message=d["message"],meta="{"+d["meta"]+"}") for d in data],from_end=pane.offset,scrollbar=True),ScrollHandlers(on_focus=focus,on_scroll=scroll))
    ui.panel(Panel(title="Logs"),draw)
def dashboard(ui,s):
    if ui.width>=150:
        row(ui,19 if ui.height>=44 else 16,1,lambda r:(col(r,"1fr",lambda c:cpu_panel(c,s,2)),col(r,"0.95fr",lambda c:memory_panel(c,s)),col(r,"0.95fr",lambda c:disks_panel(c,s)),col(r,"1.35fr",lambda c:system_panel(c,s))))
        row(ui,"1fr",1,lambda r:(col(r,"2fr",lambda c:processes_panel(c,s)),col(r,"1.2fr",lambda c:network_panel(c,s)),col(r,"1.2fr",lambda c:disk_usage_panel(c,s))))
        row(ui,12,1,lambda r:(temperatures_panel(r,s),sensors_panel(r,s),col(r,"1.6fr",lambda c:logs_panel(c,s))))
    elif ui.width>=100:
        row(ui,14,1,lambda r:(cpu_panel(r,s,2),memory_panel(r,s),system_panel(r,s)))
        row(ui,"1fr",1,lambda r:(col(r,"1.6fr",lambda c:processes_panel(c,s)),col(r,"fill",lambda c:network_panel(c,s))))
        row(ui,10,1,lambda r:(temperatures_panel(r,s),logs_panel(r,s)))
    else:
        row(ui,10,1,lambda r:(cpu_panel(r,s,1),memory_panel(r,s)))
        col(ui,"fill",lambda c:processes_panel(c,s));row(ui,8,1,lambda r:network_panel(r,s))
