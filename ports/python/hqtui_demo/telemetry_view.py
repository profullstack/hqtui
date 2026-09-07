"""Native Traffic, Sessions, Network and Services reference screens."""
from .dashboard import (w, Layout, Panel, row, col, txt, kv, keys, plot, multi,
                        scalar, bytes, percent, byte_rate, data_table, dc, PlotOptions)
from hqtui.theme import series_color

def rate(v):
    if v>=1e6: return f'{v/1e6:.1f}M/s'
    if v>=1000: return f'{v/1000:.1f}K/s'
    return f'{v:.0f}/s'
def status_color(t,c): return {"1xx":t.secondary,"2xx":t.success,"3xx":t.accent,"4xx":t.warning,"5xx":t.danger}.get(c,t.muted)
def traffic(ui,s):
    if s.source!="simulated": ui.label("Protocol/direction: port-based estimates; HTTP rate: estimated from log growth")
    t=ui.theme;d=s.sample["telemetry"];net=d["net"];rates=net["rates"];http=d["http"]
    def top(r):
        def protocols(p):
            data=d["protocols"]
            if not data: p.label("No sockets visible.");return
            maximum=max(1,*(x["total"] for x in data))
            p.meters(w.MetersOptions(items=[w.MeterItem(label=b["protocol"],value=b["total"]/maximum,color=series_color(t,i),text=scalar(b["total"])) for i,b in enumerate(data[:9])],label_width=13,value_width=5))
        r.panel(Panel(title="Protocols",subtitle=f'{scalar(d["inboundConnections"])} in / {scalar(d["outboundConnections"])} out',border_color=t.accent),protocols)
        def tcp(p):
            row(p,1,0,lambda r:(txt(r,'↓ '+rate(rates["inSegs"])+" seg",t.primary),r.text('↑ '+rate(rates["outSegs"])+" seg",w.TextStyle(fg=t.secondary,align="right"))))
            multi(p,d["netInHistory"],d["netOutHistory"],t.primary,t.secondary);p.divider()
            keys(p,[kv("Established",net["tcpEstablished"],t.success),kv("Opens in/out",rate(rates["passiveOpens"])+" / "+rate(rates["activeOpens"]),t.accent),kv("Resets sent",f'{net["tcpOutRsts"]:,.0f}',t.muted)])
        r.panel(Panel(title="TCP",size="0.9fr",border_color=t.primary),tcp)
        color=t.danger if net["retransRatio"]>.02 else t.success
        def retrans(p):
            p.text(f'{max(0,min(1,net["retransRatio"]))*100:.2f}%',w.TextStyle(fg=color,bold=True));p.label("of outbound segments");plot(p,d["retransHistory"],t.danger)
            keys(p,[kv("UDP in/out",rate(rates["udpIn"])+" / "+rate(rates["udpOut"]),t.muted),kv("ICMP",scalar(net["icmpInMsgs"])+" / "+scalar(net["icmpOutMsgs"]),t.muted)])
        r.panel(Panel(title="Retransmits",size="0.7fr",border_color=color),retrans)
    row(ui,13,1,top)
    def middle(r):
        def left(c):
            def http_panel(p):
                if not http:
                    p.label("No readable HTTP access log.");p.label("nginx, apache, httpd and caddy logs are");p.label("root/adm readable — run with sudo to track requests.");return
                row(p,1,0,lambda r:(txt(r,http["source"],t.muted),r.text(scalar(http["upgrades"])+" upgrades (ws)",w.TextStyle(fg=t.secondary,align="right"))))
                p.graph(w.GraphOptions(values=http["history"],plot=PlotOptions(min=0,fill=True,color=t.success)),Layout(size=6));p.divider(w.DividerOptions(label="status"))
                maximum=max([1]+[b["count"] for b in http["statusClasses"]])
                p.meters(w.MetersOptions(items=[w.MeterItem(label=b["class"],value=b["count"]/maximum,color=status_color(t,b["class"]),text=scalar(b["count"])) for b in http["statusClasses"]],label_width=5,value_width=7));p.divider(w.DividerOptions(label="top paths"))
                data_table(p,s,"traffic.paths",http["topPaths"],[dc("path","Path",minimum=20,color=t.primary),dc("count","Hits",7,color=t.accent,right=True)],header=False)
            c.panel(Panel(title="HTTP",subtitle=f'{http["requestsPerSecond"]:.1f} req/s' if http else "no access log",border_color=t.success),http_panel)
        r.column(Layout(gap=1),left)
        def right(c):
            def ssh(p):
                if not d["ssh"]: p.label("No sshd events in the journal.");return
                data_table(p,s,"traffic.ssh",list(reversed(d["ssh"])),[dc("time","Time",9,color=t.muted),dc("action","Action",11,cell_color=lambda d:t.success if d["action"]=="accepted" else t.muted if d["action"]=="disconnect" else t.danger),dc("user","User",12,color=t.primary),dc("from","From",minimum=14,color=t.accent),dc("method","Method",10,color=t.muted)],True)
            c.panel(Panel(title="SSH Activity",subtitle=str(len(d["ssh"])),border_color=t.warning),ssh)
            def remotes(p):
                if not d["remotes"]: p.label("No remote peers.");return
                data_table(p,s,"traffic.remotes",d["remotes"],[dc("host","Host",minimum=16,color=t.accent),dc("connections","Conns",6,color=t.success,right=True),dc("protocols","Protocols",minimum=12,color=t.muted)],True)
            c.panel(Panel(title="Top Remote Hosts",size=10,border_color=t.secondary),remotes)
        r.column(Layout(size="0.85fr",gap=1),right)
    row(ui,"1fr",1,middle)
    if http and http["recent"]:
        ui.panel(Panel(title="Recent Requests",size=10,border_color=t.primary),lambda p:data_table(p,s,"traffic.requests",http["recent"],[dc("time","Time",9,color=t.muted),dc("method","Method",7,color=t.secondary),dc("path","Path",minimum=24,color=t.primary),dc("status","Status",7,right=True,cell_color=lambda d:status_color(t,str(d["status"])[0]+"xx")),dc("client","Client",16,color=t.accent),dc("bytes","Bytes",9,color=t.muted,right=True)],True))
def sessions(ui,s):
    t=ui.theme;d=s.sample["telemetry"]
    def top(r):
        def active(p):
            if not d["sessions"]: p.label("No interactive sessions.");p.label("(`who` reports nothing on this host)");return
            data_table(p,s,"sessions.active",d["sessions"],[dc("user","User",12,color=t.primary),dc("tty","TTY",10),dc("from","From",minimum=12,color=t.accent),dc("loginAt","Login",14,color=t.muted),dc("idle","Idle",8,right=True)])
        r.panel(Panel(title="Active Sessions",subtitle=str(len(d["sessions"])),border_color=t.success),active)
        def states(p):
            states=d["states"]
            for key,label,color in (("running","run ",t.success),("sleeping","slp ",t.primary),("stopped","stop",t.warning),("zombie","zomb",t.danger)):
                p.meter(w.MeterOptions(label=label,value=states[key]/max(1,states["total"]),text=scalar(states[key]),heat=False,color=color))
            p.spacer(1);keys(p,[kv("Total",states["total"],t.accent)])
        r.panel(Panel(title="Process States",size=34,border_color=t.primary),states)
    row(ui,9,1,top)
    def bottom(r):
        def logins(p):
            if not d["logins"]: p.label("No login history available.");return
            data_table(p,s,"sessions.logins",d["logins"],[dc("user","User",12,color=t.primary),dc("tty","TTY",12,color=t.muted),dc("from","From",minimum=14,color=t.accent),dc("when","When",minimum=16,color=t.muted),dc("status","Status",8,cell_color=lambda d:t.success if d["status"]=="still" else t.muted)],True)
        r.panel(Panel(title="Recent Logins",subtitle=f'{len(d["logins"])} from wtmp',border_color=t.accent),logins)
        def right(c):
            def failed(p):
                if not d["failedLogins"]: p.label("None recorded.");p.label("(btmp is usually root-only)");return
                data_table(p,s,"sessions.failed",d["failedLogins"],[dc("user","User",12,color=t.danger),dc("from","From",minimum=12),dc("when","When",minimum=14,color=t.muted)])
            c.panel(Panel(title="Failed Logins",border_color=t.danger),failed)
            c.panel(Panel(title="Session History",size=8,border_color=t.secondary),lambda p:(p.label("concurrent sessions"),plot(p,d["sessionHistory"],t.success)))
        r.column(Layout(size="0.8fr",gap=1),right)
    row(ui,"1fr",1,bottom)
def network(ui,s):
    t=ui.theme;d=s.sample["telemetry"];active=[i for i in d["interfaces"] if i["rxTotal"]>0 or i["state"]=="up"];shown=(active or d["interfaces"])[:3]
    def top(r):
        if not shown: r.panel(Panel(title="Interfaces"),lambda p:p.label("No interfaces reported."));return
        for i,iface in enumerate(shown):
            def draw(p,d=iface):
                row(p,1,0,lambda r:(txt(r,"↓ "+byte_rate(d["rxRate"]),t.primary),r.text("↑ "+byte_rate(d["txRate"]),w.TextStyle(fg=t.secondary,align="right"))))
                multi(p,d["rxHistory"],d["txHistory"],t.primary,t.secondary);p.divider()
                keys(p,[kv("RX total",bytes(d["rxTotal"]),t.primary),kv("TX total",bytes(d["txTotal"]),t.secondary),kv("MAC",d["mac"],t.muted),kv("MTU / err / drop"," / ".join(scalar(d[k]) for k in ("mtu","errors","drops")),t.muted)])
            r.panel(Panel(title=f'{iface["name"]} ({iface["state"]})',subtitle=iface["ip"],border_color=(t.primary,t.success,t.secondary)[i]),draw)
    row(ui,13,1,top)
    def bottom(r):
        def connections(p):
            if not d["connections"]: p.label("No connections visible (`ss` unavailable).");return
            data_table(p,s,"network.connections",d["connections"],[dc("proto","Proto",6,color=t.muted),dc("local","Local",minimum=18),dc("remote","Remote",minimum=18,color=t.accent),dc("state","State",10,color=t.success),dc("process","Process",minimum=12,color=t.primary)],True)
        r.panel(Panel(title="Connections",subtitle=f'{len(d["connections"])} open',border_color=t.accent),connections)
        def right(c):
            c.panel(Panel(title="Listening Ports",subtitle=str(len(d["listeners"])),border_color=t.warning),lambda p:data_table(p,s,"network.listeners",d["listeners"],[dc("proto","Proto",6,color=t.muted),dc("port","Port",7,color=t.warning,right=True),dc("address","Address",minimum=10,color=t.muted),dc("process","Process",minimum=10,color=t.primary)],True))
            c.panel(Panel(title="Open Connections",size=6,border_color=t.secondary),lambda p:plot(p,d["connectionHistory"],t.accent))
        r.column(Layout(size="0.7fr",gap=1),right)
    row(ui,"1fr",1,bottom)
def services(ui,s):
    t=ui.theme;d=s.sample["telemetry"];failed=sum(x["active"]=="failed" for x in d["services"])
    def top(r):
        def units(p):
            if not d["services"]: p.label("systemd not available on this host.");return
            data_table(p,s,"services.units",d["services"],[dc("name","Unit",minimum=18,color=t.primary),dc("active","Active",10,cell_color=lambda d:t.danger if d["active"]=="failed" else t.success if d["active"]=="active" else t.muted),dc("sub","Sub",10,color=t.muted),dc("description","Description",minimum=16,color=t.muted)],True)
        r.panel(Panel(title="Services",subtitle=f'{failed} failed' if failed else f'{len(d["services"])} units',subtitle_color=t.danger if failed else t.muted,border_color=t.danger if failed else t.success),units)
        def right(c):
            def kernel(p):
                k=d["kernel"]
                krate=lambda v:f'{v/1000:.1f}K/s' if v>=1000 else f'{v:.0f}/s'
                keys(p,[kv("Context switches",krate(k["contextSwitchRate"]),t.accent),kv("Interrupts",krate(k["interruptRate"]),t.accent),kv("Forks",krate(k["forkRate"]),t.accent),kv("Procs running",k["procsRunning"],t.success),kv("Procs blocked",k["procsBlocked"],t.warning if k["procsBlocked"] else t.muted),kv("Open file descriptors",f'{k["openFiles"]:,.0f}',t.primary),kv("Entropy available",k["entropy"],t.warning if k["entropy"]<200 else t.success),kv("Page in / out",f'{k["pageIn"]/1000:.0f}K / {k["pageOut"]/1000:.0f}K',t.muted)])
            c.panel(Panel(title="Kernel",size=11,border_color=t.accent),kernel)
            def containers(p):
                if not d["containers"]: p.label("No running containers.");p.label("(docker not installed or not reachable)");return
                data_table(p,s,"services.containers",d["containers"],[dc("name","Name",minimum=12,color=t.primary),dc("image","Image",minimum=14,color=t.muted),dc("status","Status",minimum=12,color=t.success)],True)
            c.panel(Panel(title="Containers",size=9,border_color=t.primary),containers)
            def hardware(p):
                rows=[];power=d["power"]
                if power:
                    draw=f'{power["powerDraw"]:.1f} W' if power["powerDraw"] is not None else "—"
                    rows.extend([kv("Battery",f'{scalar(power["battery"])}% ({power["timeRemaining"]})',t.success),kv("AC","connected" if power["acConnected"] else "on battery",t.muted),kv("Draw",draw,t.warning)])
                for g in d["gpus"]:
                    util=percent(g["utilization"]) if g["utilization"] is not None else "—"
                    rows.extend([kv(g["name"],f'{util} · {scalar(g["temperature"])}°C',t.accent),kv("GPU memory",bytes(g["memoryUsed"])+" / "+bytes(g["memoryTotal"]),t.muted)])
                if not rows: p.label("No battery or GPU telemetry on this host.");return
                keys(p,rows)
            c.panel(Panel(title="Hardware",border_color=t.warning),hardware)
        r.column(Layout(size="0.85fr",gap=1),right)
    row(ui,"1fr",1,top)
    def filesystems(p):
        if not d["filesystems"]: p.label("No filesystems reported.");return
        data_table(p,s,"services.filesystems",d["filesystems"],[dc("mount","Mount",minimum=14,color=t.primary),dc("device","Device",minimum=12,color=t.muted),dc("type","Type",8,color=t.muted),dc("size","Size",10,right=True,fmt=lambda d:bytes(d["size"],0)),dc("used","Used",10,right=True,fmt=lambda d:bytes(d["used"],0)),dc("pct","Use%",6,right=True,fmt=lambda d:percent(d["used"]/d["size"]) if d["size"] else "-",cell_color=lambda d:t.danger if d["size"] and d["used"]/d["size"]>.9 else t.warning),dc("inodes","Inodes",16,color=t.muted,right=True,fmt=lambda d:f'{percent(d["inodesUsed"]/d["inodesTotal"])} of {d["inodesTotal"]/1e6:.1f}M' if d["inodesTotal"] else "-")],True)
    ui.panel(Panel(title="Filesystems",size=10,border_color=t.secondary),filesystems)

def telemetry(ui,s): {"traffic":traffic,"sessions":sessions,"network":network,"services":services}[s.screen](ui,s)
