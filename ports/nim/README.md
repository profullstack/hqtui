# HQTUI for Nim

Nim 2.2.4+ bindings to the shared C/C++ engine, with no Nim package dependencies.
Build custom widget trees in Nim or run the full ten-screen dashboard in the same
process. Linux and macOS are supported; live metrics require Linux.

## Install

```sh
nimble install https://github.com/profullstack/hqtui?subdir=ports/nim
```

`nimble install hqtui` works the same way once the package is listed in
[nim-lang/packages](https://github.com/nim-lang/packages). Nimble picks the
newest `vX.Y.Z` tag, and the package version follows the hqtui release.

The engine is compiled from source into your program: the package carries a
copy of `ports/c`, `ports/cpp` and `ports/bindings` in `src/hqtui/engine`, built
through Nim's `compile` pragma. You need Nim 2.2.4+ and a C11/C++17 compiler
(GCC or Clang); there is no CMake step, no shared library and nothing to set at
run time. The first build of a program compiles the engine (about 20 seconds);
later builds reuse the objects in its nimcache.

## Build and run from a checkout

```sh
nim c -r ports/nim/examples/hello.nim
nim c -r -d:release ports/nim/examples/dashboard.nim --sim
nim c -r ports/nim/examples/widgets.nim
cd ports/nim && nimble test
```

`src/hqtui/engine` is generated. After changing the C, C++ or binding sources,
run `sh ports/nim/tools/vendor.sh`; CI fails when the copy differs.

The latest-source launcher runs the demo without a checkout:

```sh
curl -fsSL https://hqtui.com/demo.sh | sh -s -- --system nim
curl -fsSL https://hqtui.com/demo.sh | sh -s -- --mise nim --snapshot
```

The launcher builds and caches both the engine and Nim executable outside the
source checkout. Mise supplies Nim and CMake; host C/C++ build tools are required.

## Custom applications

```nim
import hqtui

let ui = newUI()
ui.panel("Hello", proc(p: UI) =
  p.text("Nim → 世界", %*{"color": "primary"})
  p.meter(0.72, %*{"label": "CPU"})
)
var scene = newScene(60, 12)
scene.set(ui)
stdout.write scene.render()
scene.close()
```

Compile with `--path:ports/nim/src` when using the checkout instead of Nimble. Each widget accepts
an optional JSON object for options, with the same fields as the
[shared protocol](../bindings/PROTOCOL.md). Arrays and records use Nim's `%*`
JSON literal macro, exported by `hqtui`. Named procedures cover every widget in
the protocol; `row`, `col` and `panel` accept a builder callback. `add` also
accepts any protocol widget directly. `toJson` returns an independent copy.

`Scene` owns its native handle, cannot be copied, and frees it when it leaves
scope under Nim's default ORC memory manager. `move` transfers ownership.
`close` is idempotent; using a closed scene raises `HqtuiError`. Native failures
also raise `HqtuiError`, and rejected updates retain the previous tree. Borrowed
native output is copied into a Nim string before returning. Keep each scene on
one thread and do not clone its native state.

`render` supports `text`, `ansi` and `diff`; `resize` changes dimensions and
`collapse` joins adjacent panel borders. `demoFrame` provides deterministic
sample bodies. `demo` forwards CLI arguments to the shared ten-screen demo.

For interactive applications, use `scene.withTerminal:` with `present`, `poll`
and `interrupted()`, as in [hello.nim](examples/hello.nim). Terminal cleanup runs
on exceptions and normal exit. Input is raw UTF-8/escape bytes; application
state and input handling live in your Nim code.

## Parity and validation

This is a shared-engine binding, with the same API coverage and renderer as
Ruby, PHP and Perl. It includes all shared widgets, nine themes, overlays,
headless output and the full interactive demo. It does not implement the larger
TypeScript API independently: modal content uses protocol fields rather than
arbitrary nested widgets, and input is not a high-level event/callback API.

`nimble test` runs the API suite and replays the `demo-parity` conformance
group (240 TypeScript reference frames). The shared binding runner checks the
same frames across Ruby, PHP, Perl and Nim, plus interactive behaviour:

```sh
sh ports/nim/tests/build.sh
export HQTUI_NATIVE_LIB="$PWD/ports/cpp/build-bindings/libhqtui_bindings.so"
HQTUI_BINDING_COMMANDS="{\"nim\":[\"sh\",\"$PWD/ports/nim/tests/run.sh\"]}" \
  python3 ports/bindings/tests/check.py
ports/nim/build/widgets
```

On macOS use `.dylib`. The shared runner checks 240 exact TypeScript reference
frames, six custom frames, all ten interactive tabs, resizing, quit/SIGTERM
terminal restoration, and Linux live and injected collector data. The Nim API
suite also checks UTF-8, diff output, failed updates, errors and move ownership.
CI builds the examples and runs acceptance on Linux and macOS.
