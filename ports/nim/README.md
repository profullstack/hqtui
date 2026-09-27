# HQTUI for Nim

Nim 2.2.4+ bindings to the shared C/C++ engine, with no Nim package dependencies.
Build custom widget trees in Nim or run the full ten-screen dashboard in the same
process. Linux and macOS are supported; live metrics require Linux.

## Build and run

From the repository root, with Nim, a C/C++17 compiler and CMake 3.20+ installed:

```sh
cmake -S ports/cpp -B ports/cpp/build-bindings \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DBUILD_TESTING=OFF -DHQTUI_BUILD_BINDINGS=ON
cmake --build ports/cpp/build-bindings --target hqtui_bindings --parallel 2
nim c -r ports/nim/examples/hello.nim
nim c -r -d:release ports/nim/examples/dashboard.nim --sim
nim c -r ports/nim/examples/widgets.nim
```

The loader uses that checkout build by default. Set `HQTUI_NATIVE_LIB` to the
absolute path of `libhqtui_bindings.so` (Linux) or `libhqtui_bindings.dylib`
(macOS) when installing or moving the executable. The library must remain
available at runtime. Nimble metadata is included; this package is not published.

Once this change is on main, the latest-source launcher supports both forms:

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

Compile with `--path:ports/nim/src` when using the checkout. Each widget accepts
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

```sh
sh ports/nim/tests/build.sh
export HQTUI_NATIVE_LIB="$PWD/ports/cpp/build-bindings/libhqtui_bindings.so"
HQTUI_BINDING_COMMANDS='{"nim":["sh","ports/nim/tests/run.sh"]}' \
  python3 ports/bindings/tests/check.py
ports/nim/build/widgets
```

On macOS use `.dylib`. The shared runner checks 240 exact TypeScript reference
frames, six custom frames, all ten interactive tabs, resizing, quit/SIGTERM
terminal restoration, and Linux live and injected collector data. The Nim API
suite also checks UTF-8, diff output, failed updates, errors and move ownership.
CI builds the examples and runs acceptance on Linux and macOS.
