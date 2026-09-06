"""Installed as hqtui-demo-python; also python -m hqtui_demo."""
from __future__ import annotations

import argparse
import copy
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from hqtui import App, AppOptions
from hqtui.testing import render_to_html, render_to_screen

from . import __version__
from .collect import Collector
from .model import SCREENS, THEMES, Simulation, State
from .view import render


def arguments(argv=None):
    p=argparse.ArgumentParser(prog="hqtui-demo-python",description="Native Python hqtui reference demo. Read-only real metrics or seeded simulation.")
    mode=p.add_mutually_exclusive_group()
    mode.add_argument("--sim",action="store_true"); mode.add_argument("--real",action="store_true")
    p.add_argument("--seed",type=int,default=1337)
    p.add_argument("--fps",type=int,default=30)
    p.add_argument("--interval",type=float,default=1.,help="real metrics polling interval in seconds")
    p.add_argument("--theme",choices=THEMES,default="dark")
    p.add_argument("--screen",choices=SCREENS,default="dashboard")
    p.add_argument("--snapshot",action="store_true",help="one frame without a terminal; defaults to simulation")
    p.add_argument("--width",type=int,default=160); p.add_argument("--height",type=int,default=50)
    p.add_argument("--format",choices=("text","ansi","html"),default="text")
    p.add_argument("--ticks",type=int,default=0)
    p.add_argument("--version",action="version",version=__version__)
    a=p.parse_args(argv)
    for ok,message in ((1<=a.fps<=120,"fps must be 1–120"),(math.isfinite(a.interval) and .05<=a.interval<=60,"interval must be 0.05–60 seconds"),(1<=a.width<=500 and 1<=a.height<=200,"size must be 1–500 by 1–200"),(0<=a.ticks<=10000,"ticks must be 0–10000"),(0<=a.seed<=0xFFFFFFFF,"seed must be an unsigned 32-bit integer")):
        if not ok: p.error(message)
    return a


def main(argv=None):
    args=arguments(argv)
    if not args.snapshot and (not sys.stdin.isatty() or not sys.stdout.isatty()):
        print("An interactive terminal is required. Use --snapshot for headless output.",file=sys.stderr)
        return 2
    source=Simulation(args.seed) if args.sim or (args.snapshot and not args.real) else Collector()
    source.refresh(0.1)
    for _ in range(args.ticks):
        if isinstance(source,Simulation): source.refresh(.1)
    state=State(copy.deepcopy(source.sample),source.source,list(source.unavailable),source.sensor_note,screen=args.screen,theme_index=THEMES.index(args.theme))
    if args.snapshot:
        screen=render_to_screen(args.width,args.height,args.theme,lambda ui:render(ui,state))
        print(render_to_html(screen) if args.format=="html" else screen.ansi() if args.format=="ansi" else screen.text())
        return 0
    app=App(AppOptions(theme=args.theme,fps=args.fps,always_render=True,quit_keys=(),focus_navigation=False))
    def key(event):
        if state.key(event.key,event.char or ""): app.quit()
        theme=THEMES[state.theme_index]
        if app.theme.name!=theme: app.set_theme(theme)
    def paste(event):
        clean="".join(c for c in event.text if c.isprintable())[:4096]
        if state.editing: state.input_value=(state.input_value+clean)[:4096]
        elif state.filtering: state.filter=(state.filter+clean)[:4096]
        elif state.palette: state.palette_query=(state.palette_query+clean)[:4096]
    app.on("key",key); app.on("paste",paste)
    app.on("mouse",lambda e:setattr(state,"last_mouse",f"{e.action.value} {e.x},{e.y} wheel={e.scroll}"))
    pending=None; next_poll=0.; last_frame=time.monotonic()
    # One worker; render never blocks on systemctl, ps, journalctl or procfs.
    with ThreadPoolExecutor(max_workers=1,thread_name_prefix="hqtui-collector") as worker:
        def update(frame):
            nonlocal pending,next_poll,last_frame
            now=time.monotonic(); state.fps=1/max(.001,now-last_frame); last_frame=now
            if pending is not None and pending.done():
                pending.result(); pending=None
                if not state.paused:
                    state.sample=copy.deepcopy(source.sample)
                    state.unavailable=list(source.unavailable); state.sensor_note=source.sensor_note
            if not state.paused and now>=next_poll and pending is None:
                pending=worker.submit(source.refresh,.1)
                next_poll=now+(.1 if isinstance(source,Simulation) else args.interval)
            if app.theme.name!=THEMES[state.theme_index]: app.set_theme(THEMES[state.theme_index])
            state.render_ms=app.stats.render*1000; state.changed_cells=app.stats.changed_cells; state.output_bytes=app.stats.bytes
            render(frame.ui,state)
        app.render(update)
        try: app.start()
        except KeyboardInterrupt: pass
    return 0


if __name__=="__main__": raise SystemExit(main())
