---
title: The same screen in eleven languages
order: 11
summary: Native ports, FFI bindings, and a bridge that lets COBOL draw a Braille chart.
---

The same dashboard runs in eleven languages, and they are not all the same kind
of thing. Knowing which kind you are using tells you what to expect.

## Native ports

TypeScript, JavaScript, Rust, Go, Python and Zig each implement the library.
Not a wrapper: the buffer, the diff, the layout engine and all twenty-eight
widgets, in that language, with no shared object to install.

```rust
ui.meter(MeterOptions::new(0.62).label("CPU"));
```

```go
ui.Meter(hqtui.MeterOptions{Value: 0.62, Label: "CPU"})
```

```python
ui.meter(w.MeterOptions(value=0.62, label="CPU"))
```

They are kept honest by generated fixtures: the TypeScript reference renders a
few hundred scenes, and every other port renders the same scenes and is
compared cell for cell. A drifted default fails a build rather than becoming a
subtle difference nobody notices for a year.

Use a native port when the language is the one your project is already in. The
API is idiomatic in each: builders in Rust, option structs in Go, dataclasses
in Python, anonymous struct literals in Zig.

## FFI bindings

C++, Ruby, PHP and Perl reach a shared native core through a small C ABI.

```ruby
ui.meter(0.62, label: 'CPU')
```

The trade is real and worth stating plainly: those four reach the eight widgets
the core draws, not all twenty-eight. `text`, `divider`, `keyValues`, `table`,
`log`, `meter`, `graph` and `gauge`. If you need tabs or a command palette in
Ruby today, you need a native port instead, and the honest coverage table lives
on [the widget gallery](/widgets).

They also need the shared library built, which the launcher does for you and
your build will have to do for itself.

## A bridge

COBOL is the eleventh, and it is a different idea. COBOL does not link against
anything. It writes fixed-width records, which is the thing COBOL has always
been good at, and an adapter reads them and draws.

```cobol
MOVE "METER" TO SR-VERB
MOVE "CPU"   TO SR-KEY
MOVE "0.62"  TO SR-NUM
PERFORM EMIT-RECORD
```

```
cobc -x -free examples/widgets.cbl -o widgets
./widgets | bun adapter/render.ts
```

There are two adapters, one in TypeScript and one in Rust, and they produce
byte-identical output from the same records. That is the point of the design:
the interface is a record layout rather than an API, so it belongs to no
language and no runtime, and a nightly batch job that already emits records can
be pointed at a dashboard for the cost of a `DISPLAY` statement.

The same trick works for anything that can write a line of text. If you have a
language with no port and no FFI, you have a bridge already.

## Choosing

- The language your project is in has a native port: use it, and you get
  everything.
- It has an FFI binding: use it if the eight widgets cover you.
- It has neither, but it can print: write records and use an adapter.
- You want the demo without installing anything:

```
curl -fsSL https://hqtui.com/demo.sh | sh -s -- rust
```

That fetches the current revision, builds it in a private cache, and runs it,
with `--mise` to use the pinned toolchain or `--system` to use yours. It never
touches your checkout and never installs anything globally.

## What is actually shared

Not code, in most cases. What is shared is the specification: the fixture
scenes, the theme definitions, the layout rules, and the exact bytes the
encoder should emit for a given diff. That is why the ports do not drift, and
why adding a twelfth language is a matter of implementing against fixtures
rather than guessing from documentation.
