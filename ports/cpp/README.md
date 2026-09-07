# hqtui — C++ native demo (experimental library API)

C++17 API over the native C11 core. No JS runtime, virtual dispatch or per-cell
C++ objects. `Buffer` and `Encoder` own their native objects with move-only RAII;
rendered output is borrowed as `std::string_view` until the next encode call.
Both static and shared linking work. Public APIs remain experimental.

The ten-screen native demo now renders the TypeScript reference layouts, using
the C renderer plus C++ widgets and Linux collectors. All 120 screen-body reference
frames match exactly on Linux. This is not a claim that every library API, OS
collector or interaction is complete. [Acceptance checklist](../c/STATUS.md).

## Update and launch

```sh
curl -fsSL https://hqtui.com/demo.sh | sh -s -- --mise cpp
curl -fsSL https://hqtui.com/demo.sh | sh -s -- --system cpp
```

Both fetch latest main and build optimized code in a private cache. C++17 build
tools (GCC/Clang) must be installed. `--mise` supplies CMake 4.4.3; `--system`
uses installed CMake 3.20+. Subsequent invocations reuse the build until the
revision changes. `c++` is an alias for `cpp`.

The terminal supports Linux/macOS; live collectors require Linux. macOS defaults
to explicitly labelled sample data. Use `--sim`
for sample data, `--snapshot` for headless text, `--screen traffic` for a specific
tab. Use 1–9/0 or Tab to switch, F2 for themes, F3 for process filtering, F6 for
sorting, Ctrl+K for the palette and q to quit. Mouse selection/scrolling is native.
The first frame does not wait for collectors. Utility subprocesses have bounded
output/deadlines and are cancelled when quitting; no service is modified.

From an updated checkout: `mise run demo:cpp` updates before launch;
`mise run demo-local:cpp` runs local edits. Or build directly:

```sh
cmake -S ports/cpp -B ports/cpp/build-demo -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF
cmake --build ports/cpp/build-demo --target hqtui-demo-cpp --parallel 2
ports/cpp/build-demo/hqtui-demo-cpp
```

The library's new `<hqtui/widgets.hpp>` exposes deferred rows/columns/panels,
Braille graphs, meters, gauges, tables, key/value lists and logs. Its builder uses
frame-local callbacks and containers; the zero-allocation core benchmark below
does **not** imply the complete demo performs zero allocations.

## Build and check

Requires CMake 3.20+, a C11 compiler and a C++17 compiler. From the repository root:

```sh
cmake -S ports/cpp -B ports/cpp/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON
cmake --build ports/cpp/build --parallel
ctest --test-dir ports/cpp/build --output-on-failure
```

Or `mise run test:cpp`. Python is optional for fixture tests, not a runtime dependency.

```cpp
#include <hqtui.hpp>

hqtui::Buffer previous(80, 24), screen(80, 24);
hqtui::Encoder encoder;
screen.write(2, 1, "Hello, terminal.",
    hqtui::Style().foreground(hqtui::rgb(88, 166, 255)));
auto frame = encoder.encode(previous, screen, true);
// Write frame.output to your transport. No terminal is acquired implicitly.
previous.copy_from(screen);
```

For CMake consumers, `add_subdirectory(path/to/hqtui/ports/cpp hqtui-cpp)` then
`target_link_libraries(your_app PRIVATE hqtui::cpp)`. Installed consumers can use
`find_package(hqtui CONFIG REQUIRED)` with that same imported target.

## Matched benchmark

```sh
cmake -S ports/cpp -B ports/cpp/build-release -DCMAKE_BUILD_TYPE=Release -DHQTUI_LTO=ON
cmake --build ports/cpp/build-release --parallel
bun apps/benchmark/src/compare-native-core.ts 5000 3
```

The runner executes identical 200×50 unchanged, sparse and full-change workloads
serially through C, C++ and the actual TypeScript reference. It alternates trial
order, reports median core frame times, verifies byte/changed-cell counts agree,
and fails on tracked native warm-frame allocations. It excludes terminal I/O,
collectors, widgets and layout; this is not an end-to-end demo benchmark.

For memory/undefined-behavior checks:

```sh
cmake -S ports/cpp -B ports/cpp/build-sanitize -DCMAKE_BUILD_TYPE=Debug -DHQTUI_SANITIZE=ON
cmake --build ports/cpp/build-sanitize --parallel
ctest --test-dir ports/cpp/build-sanitize --output-on-failure
```
