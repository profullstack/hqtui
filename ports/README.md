# hqtui, in other languages

C and C++ are now being implemented with one shared native C rendering core and
a thin C++17 ownership API. They are **not complete supported ports yet**. See
[C](c/README.md), [C++](cpp/README.md), and the [acceptance checklist](c/STATUS.md).

Native ports of [the TypeScript reference implementation](https://hqtui.com).
Not bindings: there is no Node in the picture at runtime or at build time, and
each port is idiomatic in its own language rather than a transliteration.

| Port | Deps | Source | Docs |
|---|---|---|---|
| [Rust](rust/) | none | ~10,200 lines | [README](rust/README.md) |
| [Go](go/) | none | ~8,600 lines | [README](go/README.md) |
| [Python](python/) | none | ~7,500 lines | [README](python/README.md) |
| [Zig](zig/) | none | ~9,200 lines | [README](zig/README.md) |

Every one of them is standard-library only. A TUI library that drags in a
dependency tree is a TUI library nobody reaches for from a small tool.

None of them are on a package registry yet — crates.io, PyPI and the Zig
package index have no `hqtui`, and publishing comes after this lands. Today you
run them from a checkout, which is what every command below assumes:

```bash
git clone https://github.com/profullstack/hqtui && cd hqtui
```

The exception is Go, which needs no registry: the module path carries its
subdirectory, so `go get github.com/profullstack/hqtui/ports/go` resolves once
this is on `main`.

[TARGETS.md](TARGETS.md) is the scored list of which language gets a port next,
and why — speed and community, written down rather than argued each time. C is
next, because it is the FFI floor for every language that can call C.

## What makes five implementations tractable

[`conformance/`](conformance/) holds a corpus of golden fixtures generated from
the TypeScript implementation, and every port replays all of it. The same widget
arguments must produce the same cells, the same colors, and the same escape
bytes — cell for cell, byte for byte.

```bash
bun conformance/generate.ts     # regenerate from the reference
```

Thirteen groups, roughly nine thousand reference cells:

| Group | What it pins down |
|---|---|
| `color` | Packed color values, all 256 palette quantizations, gradients |
| `unicode` | Display widths, grapheme clustering, truncation, wrapping |
| `ansi` | Escape sequence construction and stripping |
| `layout` | The fr/percent/auto/fill solver, two-pass clamping |
| `buffer` | Framebuffer writes, wide-glyph continuation cells |
| `diff` | The encoder's exact output bytes, cursor-state model |
| `theme` | All nine built-in themes, heat ramps, series colors |
| `surface` | Every border style, titles, subtitles, footers |
| `braille` | 2x4 sub-cell rasterisation, clipping, line walks |
| `blocks` | Block-element and shade glyph selection |
| `input` | 26 byte-chunk scenarios, including split escape sequences |
| `widgets` | 53 widget scenes |
| `screen` | 10 whole-screen layouts through the builder |

The last two are what catch the interesting failures. A widget drawn onto a
surface somebody else sized will pass even when the layout solver is subtly
wrong; a whole screen will not.

This is also why the ports landed as fast as they did. Writing the Rust port
forced every ambiguity in the reference into the open and into a fixture — after
which Go, Python and Zig each passed on the first run.

## Running the suites

```bash
cd rust   && cargo test
cd go     && go test ./...
cd python && python -m unittest discover
cd zig    && zig build test
```

## Seeing it work

Each port ships the same three examples, and the screenshot one needs no TTY:

```bash
cd rust   && cargo run --example screenshot
cd go     && go run ./examples/screenshot
cd python && python examples/screenshot.py
cd zig    && zig build run-screenshot
```

All four print the same dashboard — the same Braille curves, the same meter
fills, the same table alignment. That is the whole point.

## What differs between ports, and why

Nothing in the rendering. The differences are in how each language wants to be
written, and each is documented in the source at the point it matters:

- **Rust** inverts interaction: a control takes an `id` and the app reports what
  happened, because an `onPress` closure that mutates captured state fights
  ownership the whole way down.
- **Go** keeps the reference's callback shape exactly, because Go closures
  capture by reference and there is a garbage collector. Optional values become
  pointers, since a Go zero value cannot mean "unset".
- **Python** keeps the callbacks too, and uses `array("L")` for the cell planes —
  a list of boxed integers for a 200x50 screen is ten thousand objects per frame.
- **Zig** has no closures at all, so nested containers take a context pointer
  beside a plain function, and interaction is inverted as in Rust. Frame memory
  is two arenas rather than per-object lifetimes.

Terminal handling differs the most, because each language's standard library
draws the line somewhere different: Zig has `termios` and `poll` and needs
neither a subprocess nor a thread; Go has `syscall.Termios`; Python has the
`termios` and `select` modules; Rust has none of it without a dependency and
shells out to `stty -g`.
