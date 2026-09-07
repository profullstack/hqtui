# hqtui — C (in development)

Native C11 core with no third-party runtime dependencies. The C++17 API in
[`../cpp`](../cpp/) uses this same core. This is **not yet a complete port**:
the full widget suite, terminal/input layer and ten-screen reference demo are
still being implemented. It is deliberately absent from the website's list of
supported languages. Do not substitute a small sample for `hqtui-demo`.

The [C++ demo](../cpp/README.md) now uses this C core with a C++ widget/terminal
layer. It does not make the C-only library or C-only demo complete.

Implemented: packed color math and palette conversion, bounded UTF-8 graphemes,
parallel-array framebuffers, clipped surfaces, reference border/title rendering,
nine theme palettes, constrained layouts, and a reusable changed-cell encoder.
The encoder returns bytes; it does not acquire the terminal or write stdout.

## Build and test

Requires a C11 compiler and CMake 3.20+. Python 3 is optional test tooling for
replaying shared TypeScript fixtures; no Python or JavaScript is needed to build
or use the library.

From the repository root:

```sh
cmake -S ports/c -B ports/c/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON
cmake --build ports/c/build --parallel
ctest --test-dir ports/c/build --output-on-failure
```

Or `mise run test:c` with CMake and a C compiler installed. Tests use explicit
checks even in Release builds, so `NDEBUG` cannot silently disable verification.
The conformance runner checks the existing TS fixtures, not expected output
generated from C. Coverage is partial: see [STATUS.md](STATUS.md).

## Use from CMake

```cmake
add_subdirectory(path/to/hqtui/ports/c hqtui-c)
target_link_libraries(your_app PRIVATE hqtui::c)
```

The build supports static libraries (default), shared libraries, CMake install
exports and pkg-config metadata. `cmake --install ports/c/build --prefix /your/prefix`
installs locally; nothing is published to a package registry.

```c
#include <hqtui.h>

hq_buffer *screen = hq_buffer_create(80, 24);
if (!screen) return 1;
const hq_theme *theme = hq_theme_at(0);
hq_buffer_clear(screen, theme->background, theme->foreground);
hq_surface root = hq_surface_root(screen, theme);
hq_box_options panel = {0};
panel.title = "Hello";
hq_surface inner = hq_surface_box(root, panel);
hq_text_options text = {0};
hq_surface_text(inner, 0, 0, "Hello, terminal.", text);
/* Read cells, export rows, or encode against a previous buffer. */
hq_buffer_destroy(screen);
```

## Performance contract

- Framebuffers reuse four typed arrays; no allocation per cell.
- Encoders reuse output capacity; unchanged frames emit no bytes.
- Unicode pools are per-buffer, bounded and lock-free (objects are not shared
  across threads without caller synchronization).
- Common layouts of up to 64 children use stack scratch rather than heap memory.
- New dimensions, output-capacity growth and new grapheme clusters may allocate.
- No `-ffast-math`: nonfinite inputs and reference rounding remain defined.
- Optional `-DHQTUI_LTO=ON` enables checked, compiler-supported LTO.

Benchmarks and allocation assertions are checked in, not speed guarantees. See
[`../cpp/README.md`](../cpp/README.md) for matched C/C++/TypeScript measurements.
Public API/ABI remains experimental until the complete conformance gate passes.
