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
- C++ ten-screen demo and deferred widget layout layer: all 120 shared TS screen
  bodies match exact glyph/color/attribute hashes on Linux.
- C++ real Linux collectors, bounded/cancellable utility subprocesses and an
  asynchronous initial load; no JavaScript or another demo executable at runtime.
- C++ PTY launch, ten-tab switching, overlay, resize, q/SIGTERM and restoration.
- Real collector fixture checks for sensors/GPU, protocols/SSH, sessions, HTTP
  routes (query strings redacted) and Docker container rows.

## Required before marking a complete supported port

- Remaining Unicode operations and text/ANSI parsing conformance.
- Complete reusable widget/control API and all 53 standalone widget scenes.
- Remaining input-parser conformance and complete shell/overlay interaction parity.
- Cross-platform collector coverage; C++ live data remains Linux-specific.
- C API equivalents for the new C++ builder/widgets/input layer and a C-only demo.
- End-to-end performance comparisons including collectors and terminal transport.

The current microbenchmarks exclude system collection, terminal transport,
layout/widgets and full application behavior. Do not market their timings as
end-to-end FPS or evidence that a demo is complete.
