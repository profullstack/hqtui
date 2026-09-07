"""Native reference app shell; screens are implemented with Python hqtui."""
from hqtui import Layout
import hqtui.widgets as w
from .model import SCREENS, THEMES
from .dashboard import dashboard
from .telemetry_view import telemetry
from .showcase import components, graphics, themes, input_screen, stress

def body(ui,s):
    draw={"dashboard":dashboard,"components":components,"graphics":graphics,"themes":themes,"input":input_screen,"stress":stress}.get(s.screen,telemetry)
    draw(ui,s)

def render(ui,s):
    t=ui.theme
    def header(r):
        r.text(" hqtui.com",w.TextStyle(fg=t.title,bold=True),Layout(size=12))
        def select(i):
            if not (s.help or s.modal or s.palette or s.filtering): s.screen=SCREENS[i]
        r.tabs(w.TabsOptions(tabs=[f'{(i+1)%10} {name}' for i,name in enumerate(SCREENS)],active=SCREENS.index(s.screen)),select)
        r.text(f'{"paused" if s.paused else "live"}  {"simulated" if s.source=="simulated" else "real"}  {s.fps:.0f}fps  {s.clock} ',w.TextStyle(fg=t.warning if s.paused else t.success,align="right"))
    ui.row(Layout(size=1),header);ui.spacer(1)
    ui.column(Layout(size=max(0,ui.height-4)),lambda p:body(p,s));ui.spacer(1)
    ui.status_bar(w.StatusBarOptions(items=[w.StatusItem("Help","F1"),w.StatusItem(f"Theme ({t.name})","F2"),w.StatusItem("Filter: "+s.filter+"_" if s.filtering else "Filter","F3",active=s.filtering),w.StatusItem("Sort: "+s.sort,"F6"),w.StatusItem("Palette","^K"),w.StatusItem("Screen","Tab"),w.StatusItem("Quit","q")],right=[w.StatusItem(f'{s.render_ms:.2f}ms  {s.changed_cells} cells  {s.output_bytes}B')]))
    if s.help: ui.modal(w.ModalOptions(title="hqtui — Help",message="1–9/0 / Tab: screen\nF2 theme · F3 filter · F6 sort\nCtrl+K palette · Space pause\nArrows / PgUp / PgDn / Home / End: scroll\nMouse tabs, controls, selection and wheel\ne edits text · Esc finishes\nq / Ctrl+C quit · Any key closes help"))
    if s.modal: ui.modal(w.ModalOptions(title="Read-only Demo",message="No process will be killed and no service changed.\nPress any key to close."))
    if s.palette: ui.command_palette(w.CommandPaletteOptions(query=s.palette_query,items=[w.PaletteItem(label) for label,hint in s.commands()],selected=s.palette_index))
