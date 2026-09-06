# hqtui — Zig

High Quality Terminal UI for Zig. btop-grade dashboards with a one-import API,
dark by default, **standard library only** — no package dependencies, nothing in
`build.zig.zon` to fetch.

This is a native port of [the TypeScript reference
implementation](https://hqtui.com), not a binding. There is no Node in the
picture at runtime or at build time.

Requires Zig 0.16.

```zig
// build.zig.zon
.dependencies = .{
    .hqtui = .{ .url = "https://github.com/profullstack/hqtui/archive/<ref>.tar.gz", .hash = "..." },
},
```

## Hello, terminal

```zig
const std = @import("std");
const hqtui = @import("hqtui");

fn view(ui: *hqtui.Container) anyerror!void {
    try ui.panel(.{ .title = "Hello" }, hqtui.Body.plain(body));
}

fn body(p: *hqtui.Container) anyerror!void {
    try p.text("Hello, terminal.", .{});
    try p.label("Press q to quit.");
}

pub fn main(init: std.process.Init) !void {
    var app = try hqtui.App.init(init.gpa, .{
        .terminal = .{ .env = .fromEnviron(&init.minimal.environ) },
    });
    defer app.deinit();
    try app.run(hqtui.Body.plain(view));
}
```

`App.init` already gives you a dark theme, truecolor with automatic 256/16
fallback, mouse tracking, the alternate screen, resize handling, 30fps adaptive
rendering (15 over SSH), and a terminal that is restored however the process
dies.

Run the examples:

```bash
zig build run-hello        # the smallest app
zig build run-dashboard    # a live dashboard, mouse and keyboard
zig build run-screenshot   # renders to stdout, no TTY needed
zig build run-screenshot -- --html   # a standalone HTML page
```

## Your state stays yours

Zig has no closures, so the two places the reference uses them work differently
here. Both changes point the same way: the data flows through you rather than
around you.

**A nested container takes a `Body`** — your context pointer beside a plain
function. **Interaction is inverted**: a control is given an `id`, and the app
tells you what happened to it. Nothing calls back into your state while you are
holding it.

```zig
const State = struct {
    selected: usize = 0,
    rows: []const Process,

    fn view(self: *State, ui: *hqtui.Container) anyerror!void {
        try ui.panel(.{ .title = "Processes" }, hqtui.Body.with(self, table));
    }

    fn table(self: *State, p: *hqtui.Container) anyerror!void {
        try p.table(.{ .rows = self.buildRows(p), .selected = self.selected }, "procs");
    }
};

while (app.running()) {
    for (try app.poll()) |event| switch (event) {
        .key => |k| if (std.mem.eql(u8, k.name, "down")) { state.selected += 1; },
        else => {},
    };
    // The wheel and clicks act on whatever is under the pointer.
    if (app.clickedRow("procs")) |row| state.selected = row;
    state.selected +|= @intCast(@max(0, app.scrolled("procs")));

    _ = try app.draw(hqtui.Body.with(&state, State.view));
}
```

The loop is a few lines, and it is visible. No reference counting, no callbacks
into the app, no lifetime puzzles.

## Frame memory

A child is drawn *after* the function that declared it returns — that is how
`fr` sizing works without a retained tree — so anything a widget points at has
to outlive the frame, not the call. Slices into your state and string literals
are fine. A stack buffer is not.

Two arenas make that safe:

- The **frame arena** is reset at the top of `draw`. `p.fmt("{d}%", .{n})` and
  `p.dupe(text)` allocate there, which is how you put a computed string on
  screen. Hit regions and focus ids also live there and stay readable until the
  *next* `draw`, which is what lets `poll` dispatch a click against the layout
  that is actually on screen.
- The **event arena** is reset at the top of `poll` and owns the ids
  `app.pressed("save")` matches against, so a button's id is still valid after
  the frame that drew it has been torn down.

## Testing without a terminal

```zig
var screen = try hqtui.renderToScreen(allocator, 80, 24, "dark", Body.plain(view));
defer screen.deinit();
try std.testing.expect(screen.contains("72%"));
```

`renderToScreen` also gives you `.ansi()` for a colored screenshot,
`.cell(x, y)` for structural assertions, `renderToHtml` for a standalone page,
and `.regions` so a test can prove a widget is actually reachable by a click.
The returned screen owns one arena, so a test frees one thing.

## How this stays honest

Every port replays a shared corpus of fixtures generated from the TypeScript
implementation: the same widget arguments must produce the same cells, the same
colors and the same escape bytes.

```bash
zig build test         # 13 conformance groups, ~9k reference cells
```

That covers colors and all 256 palette quantizations, Unicode widths and
grapheme clustering, the layout solver, the framebuffer, the diff encoder's
exact output bytes, Braille rasterisation, every border style, the input
parser's 26 byte-chunk scenarios, all 53 widget scenes and 10 whole-screen
layouts.

## Where this differs from the reference, and why

Three places, all documented in the source at the point they matter:

**Bodies instead of closures**, and **ids instead of callbacks** — described
above. This is the only difference a reader of the reference will feel.

**The cluster table is a fixed arena.** Grapheme clusters are interned so a cell
stays one 32-bit value. The other ports grow a map; here it is a 2 MiB static
buffer sized to `MAX_CLUSTERS`, taken under an atomic spin lock. Contention is
effectively nil — one `memcpy` per *distinct* cluster ever seen — and it means
the renderer never allocates for text.

**NaN reaches the same pixels by a different route.** JavaScript propagates NaN
through `Math.min`, Rust saturates, Python raises, and in Zig `@intFromFloat` on
NaN is illegal behaviour rather than a wrong answer. Every comparison that can
see a NaN is written to fold it explicitly, so a `NaN` meter renders the same
empty bar in all five implementations.

Everything else — layout, widgets, colors, glyph selection, escape output — is
identical, and the conformance suite is what says so.

## Terminal handling

Zig's standard library carries the whole POSIX layer this needs, which makes
this the least indirect of the ports:

- **Raw mode** is `std.posix.tcgetattr` / `tcsetattr`. The flags are named
  booleans on a packed struct that std defines per architecture, so there is no
  bit layout to get wrong, and the original `termios` is handed back verbatim
  rather than reconstructed. The Rust port cannot see a correct `termios`
  without a dependency and shells out to `stty -g` instead.
- **Input is polled, not threaded.** `std.posix.poll` waits on stdin with a
  timeout, so the render loop gets an answer within a bounded time with no
  reader thread, no channel, and no synchronization at all. Rust, Go and Python
  each needed one of those. The Escape-key timeout falls out of the same call:
  `poll` returning zero *is* the elapsed time, so it costs no clock syscall
  either.
- **Window size** is one `TIOCGWINSZ` ioctl; **signals** go through
  `std.posix.sigaction` and only ever store to an atomic.

One Zig 0.16 consequence worth knowing: there is no ambient `getenv` any more.
The environment reaches a program through `main`'s `std.process.Init` parameter
and nowhere else, so capability detection needs you to pass it —
`.terminal = .{ .env = .fromEnviron(&init.minimal.environ) }`. Skip it and every
terminal is detected as a dumb one.

Windows has no POSIX terminal layer here, so the interactive `App` does not run
there — but everything above it (the framebuffer, widgets, encoder and headless
renderer) is pure computation and works fine.

## License

MIT.
