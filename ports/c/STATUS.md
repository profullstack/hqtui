# C/C++ acceptance status

C++ deliberately shares the C implementation: the user selected performance over
maintaining an independent C++ renderer. The C++ API adds move-only RAII ownership,
string views and value types, not a second render loop or foreign runtime.

## Verified locally

- C11/C++17 Release builds, static/shared linking, optional LTO.
- C and C++ lifecycle, bounds, resize/copy, Unicode and changed-frame checks.
- Warmed ASCII frames perform zero tracked framebuffer/encoder allocations.
- Shared TS fixtures: color operations/gradients, character/string widths,
  all 12 framebuffer scenes, 15 diff scenes (exact bytes), 15 layout solves,
  16 stacks, all nine palettes and 15 bordered-surface scenes.
- Buffer-local Unicode pools compare by text, not coincidentally equal IDs.
- Malformed UTF-8 is replaced, not re-emitted as raw C1 control bytes.
- Separate installed C and C++ consumer builds.

## Required before marking a complete supported port

- Remaining Unicode operations and text/ANSI parsing conformance.
- Braille, block graphics, plot modes, and all 53 widget scenes.
- Deferred container builder and all ten shared whole-screen fixtures.
- Input parser including incremental escapes, mouse and bracketed paste.
- Native terminal lifecycle, resize, signals, and PTY cleanup tests.
- Full ten-screen native demo: same reference layouts, interactions and real
  collectors. No shell-out to another language's demo, no rendered-fixture replay.
- Full demo screen-body parity at all 120 Rust-gated reference configurations,
  followed by shell/overlay and live-data coverage tests.
- Cross-platform CI and performance regression artifacts.

The current microbenchmarks exclude system collection, terminal transport,
layout/widgets and full application behavior. Do not market their timings as
end-to-end FPS or evidence that a demo is complete.
