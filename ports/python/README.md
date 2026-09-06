# hqtui — Python

High Quality Terminal UI for Python. btop-grade dashboards with a one-import
API, dark by default, **standard library only** — nothing in `dependencies`,
nothing to pin.

This is a native port of [the TypeScript reference
implementation](https://hqtui.com), not a binding. There is no Node in the
picture at runtime or at install time.

```bash
pip install hqtui
```

## Hello, terminal

```python
from hqtui import App, Panel

app = App()
app.render(lambda f: f.ui.panel(
    Panel(title="Hello"),
    lambda p: p.text("Hello, terminal."),
))
app.start()
```

`App()` already gives you a dark theme, truecolor with automatic 256/16
fallback, mouse tracking, the alternate screen, resize handling, 30fps adaptive
rendering (15 over SSH), and a terminal that is restored however the process
dies.

## Handlers close over your state

Python keeps the reference implementation's shape, because Python closures
capture by reference and the runtime has a garbage collector. The Rust port has
to invert this; Python does not:

```python
import hqtui.widgets as w
from hqtui import App, ScrollHandlers

state = {"selected": 0}
app = App()

app.on("key", lambda e: state.update(
    selected=state["selected"] + (1 if e.name == "down" else -1 if e.name == "up" else 0)
))

app.render(lambda f: f.ui.table(
    w.TableOptions(
        rows=[w.TableRow(("1", "systemd"))],
        columns=[w.TableColumn("PID"), w.TableColumn("NAME")],
        selected=state["selected"],
    ),
    # The wheel acts on whatever is under the pointer.
    ScrollHandlers(on_select_row=lambda row: state.update(selected=row)),
))
app.start()
```

Run the examples to see it working:

```bash
python examples/hello.py        # the smallest app
python examples/dashboard.py    # a live dashboard, mouse and keyboard
python examples/screenshot.py   # renders to stdout, no TTY needed
```

## Testing without a terminal

```python
from hqtui import Panel, render_to_screen

screen = render_to_screen(80, 24, "dark", lambda ui: ui.panel(
    Panel(title="CPU"), lambda p: p.text("72%")))
assert screen.contains("72%")
```

`render_to_screen` also gives you `.ansi()` for a colored screenshot,
`.cell(x, y)` for structural assertions, and `.regions` so a test can prove a
widget is actually reachable by a click.

## How this stays honest

Every port replays a shared corpus of fixtures generated from the TypeScript
implementation: the same widget arguments must produce the same cells, the same
colors and the same escape bytes.

```bash
python -m unittest discover      # 13 conformance groups, ~9k reference cells
```

That covers colors and all 256 palette quantizations, Unicode widths and
grapheme clustering, the layout solver, the framebuffer, the diff encoder's
exact output bytes, Braille rasterisation, every border style, all 53 widget
scenes and 10 whole-screen layouts.

## Where this differs from the reference, and why

Three places, all documented in the source at the point they matter:

**The framebuffer uses `array`, not lists.** Four `array("L")` planes instead of
a list of cell objects. This matters more here than it does in the reference: a
list of boxed integers for a 200x50 screen is ten thousand objects per frame,
and the whole design exists to avoid exactly that.

**NaN does not propagate the same way.** `math.floor(nan)` raises where
JavaScript's `Math.floor` returns NaN, so `round_half_up` passes NaN and the
infinities through, and `clamp01` turns NaN into 0. Both reach the same empty
state the reference draws, without the exception.

**Tables take strings.** The reference is generic over a row type and reads
cells by key. `TableRow(("1", "systemd"))` keeps the widget out of the business
of formatting someone else's objects.

Everything else — layout, widgets, colors, glyph selection, escape output — is
identical, and the conformance suite is what says so.

## Terminal handling

Python has the easiest job of the four ports: `termios`, `tty`, `signal`,
`select` and `os.get_terminal_size` are all standard library and correctly
implemented per platform. There is no FFI (as in Rust) and no subprocess.

One thing that falls out of that: `poll_input` waits on the file descriptor
itself with `select`, rather than on a clock. The other ports have to time the
Escape-key ambiguity against their own frame budget.

Windows has no POSIX terminal layer here, so the interactive `App` does not run
there — but everything above it (the framebuffer, widgets, encoder and headless
renderer) is pure computation and works fine.

## License

MIT.
