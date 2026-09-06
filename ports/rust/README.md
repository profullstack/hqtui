# hqtui — Rust

High Quality Terminal UI for Rust. btop-grade dashboards with a one-import API,
dark by default, **zero dependencies** — not even for the tests.

This is a native port of [the TypeScript reference
implementation](https://hqtui.com), not a binding. There is no Node in the
picture at runtime or at build time.

Not on crates.io yet — it ships in the monorepo. To run it now:

```bash
git clone https://github.com/profullstack/hqtui
cd hqtui/ports/rust && cargo run --example dashboard
```

To depend on it from your own crate, point at the checkout:

```toml
[dependencies]
hqtui = { path = "../hqtui/ports/rust" }
```

## Hello, terminal

```rust
use hqtui::prelude::*;

fn main() -> std::io::Result<()> {
    App::new()?.run(|f| {
        f.ui.panel(Panel::new().title("Hello"), |p| {
            p.text("Hello, terminal.");
        });
    })
}
```

`App::new()` already gives you a dark theme, truecolor with automatic 256/16
fallback, mouse tracking, the alternate screen, resize handling, 30fps adaptive
rendering (15 over SSH), and a terminal that is restored however the process
dies — Ctrl+C, SIGTERM, or a panic.

## A real app

Most apps want the explicit loop, because that is where your own state lives:

```rust
use hqtui::prelude::*;

fn main() -> std::io::Result<()> {
    let mut app = App::new()?;
    let mut selected = 0usize;

    while app.running() {
        for event in app.poll()? {
            if let InputEvent::Key(k) = event {
                match k.name.as_str() {
                    "down" => selected += 1,
                    "up" => selected = selected.saturating_sub(1),
                    _ => {}
                }
            }
        }
        if let Some(row) = app.clicked_row("procs") { selected = row; }
        selected += app.scrolled("procs").max(0) as usize;

        app.draw(|f| {
            f.ui.panel(Panel::new().title("Processes"), |p| {
                p.table(TableOptions {
                    rows: vec![TableRow::new(["1", "systemd"])],
                    columns: vec![TableColumn::new("PID"), TableColumn::new("NAME")],
                    selected: Some(selected),
                    follow_selection: true,
                    ..Default::default()
                }, "procs");
            });
        })?;
    }
    Ok(())
}
```

Run the examples to see it working:

```bash
cargo run --example hello        # the smallest app
cargo run --example dashboard    # a live dashboard, mouse and keyboard
cargo run --example screenshot   # renders to stdout, no TTY needed
```

## Testing without a terminal

```rust
use hqtui::testing::render_to_screen;
use hqtui::ui::Panel;

let screen = render_to_screen(80, 24, "dark", |ui| {
    ui.panel(Panel::new().title("CPU"), |p| { p.text("72%"); });
});
assert!(screen.contains("72%"));
```

`render_to_screen` also gives you `.ansi()` for a colored screenshot,
`.cell(x, y)` for structural assertions, and `.regions` so a test can prove a
widget is actually reachable by a click.

## How this stays honest

Every port replays a shared corpus of fixtures generated from the TypeScript
implementation: the same widget arguments must produce the same cells, the same
colors and the same escape bytes.

```bash
cargo test              # 14 conformance groups, ~9k reference cells
```

That covers colors and all 256 palette quantizations, Unicode widths and
grapheme clustering, the layout solver, the framebuffer, the diff encoder's
exact output bytes, Braille rasterisation, every border style, all 53 widget
scenes and 10 whole-screen layouts.

## Where this differs from the reference, and why

Three places, all documented in the source at the point they matter:

**Interaction is inverted.** There, a widget takes an `onPress` callback that
mutates whatever the closure captured. Here a control is given an `id` and the
app reports what happened to it — `app.pressed("run")`, `app.scrolled("procs")`,
`app.clicked_row("procs")`. Your state stays yours: no `Rc<RefCell<_>>`, no
callback registry.

**The loop is yours.** `App::run` exists for the simple case, but the explicit
`poll`/`draw` loop is what most apps want, because a view that borrows the state
it also mutates cannot be a repeating callback.

**Tables take strings.** The reference is generic over a row type and reads
cells by key. `TableRow::new(["1", "systemd"])` keeps the widget free of type
parameters and puts formatting where the data lives.

Everything below those — layout, widgets, colors, glyph selection, escape
output — is identical, and the conformance suite is what says so.

## The one dependency-shaped decision

Raw mode goes through `stty`, not a hand-declared `struct termios`. That struct
has a different field layout and a different set of flag constants on Linux,
macOS and each BSD; one of them would have been wrong and untested. `stty -g`
hands back an opaque description of the current settings and takes it back
verbatim, so restoring is exact rather than reconstructed. The cost is two
short-lived processes for the life of the app.

Window size and signals do go through direct C calls, because they cannot be
shelled out to — but `struct winsize` is four `u16`s everywhere and `signal()`
has one standard signature, so unlike `termios` there is nothing
platform-shaped to get wrong.

Windows is not supported by the terminal layer yet. Everything above it — the
framebuffer, widgets, encoder and headless renderer — is pure computation and
runs anywhere.

## License

MIT.
