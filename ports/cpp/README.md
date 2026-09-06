# hqtui — C++ (in development)

C++17 API over the native C11 core. No JS runtime, virtual dispatch or per-cell
C++ objects. `Buffer` and `Encoder` own their native objects with move-only RAII;
rendered output is borrowed as `std::string_view` until the next encode call.
Both static and shared linking work. Public APIs remain experimental.

**This is the rendering foundation, not yet the complete library or ten-screen
demo.** [Acceptance checklist](../c/STATUS.md). C++ is not advertised as a finished
port on hqtui.com.

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
