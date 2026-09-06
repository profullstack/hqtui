# Native reference demos

## Current verification

The documented dashboard commands now select the ten-screen native apps:

| Language | From its `ports/<language>` directory | From the repository root |
| --- | --- | --- |
| Rust | `cargo run --example dashboard` | `mise run demo:rust` |
| Go | `go run ./examples/dashboard` | `mise run demo:go` |
| Python | `python -m examples.dashboard` | `mise run demo:python` |
| Zig | `zig build run-dashboard` | `mise run demo:zig` |

The small library samples remain available under explicitly named `dashboard-mini`
commands (`examples.dashboard_mini` in Python). They are not the default demo.

`python3 apps/demo/scripts/check-native-commands.py` tests each documented command
in real and simulated mode, verifies that the full dashboard renders, then checks
that quitting restores the original terminal settings (Linux/macOS PTY required).

Rust screen bodies additionally pass 120 TypeScript-reference comparisons: ten
screens, four terminal sizes, three themes, matching characters, colors and
attributes. Regenerate the reference with `bun apps/demo/scripts/native-parity.ts`.
Go, Python and Zig have screen/rendering and interaction tests, but **their full
demo layouts have not yet passed this TypeScript visual-parity gate**. Launch
verification does not establish visual parity, nor parity of live telemetry sources.

## Acceptance target

The reference application is `apps/demo`. The Rust, Go, Python and Zig applications
must use their corresponding libraries from `ports/` and live in this repository.
The existing three-panel `examples/dashboard` programs are library examples, not
replacements for the reference demo.

## Acceptance contract

- All ten screens: dashboard, traffic, sessions, network, services, components,
  graphics, themes, input, stress.
- Real metrics by default; deterministic, seeded simulation with `--sim`.
- Native terminal lifecycle, rendering and input. No Node/Bun/Deno process, JS
  engine, TypeScript-generated screen images or cross-language runtime bridge.
- Common CLI options: `--sim`, `--real`, `--seed`, `--fps`, `--theme`, `--screen`,
  `--interval`, `--help`, `--version`. Invalid values fail before acquiring a TTY.
- `--snapshot` renders one frame without a TTY, with `--width` and `--height`.
  `--format text|ansi|html` selects the output. Snapshots default to simulation
  unless `--real` is explicit. `--ticks` advances the simulation deterministically.
- Keys: 1–9/0 and Tab select screens; F1 help, F2 themes, F3 process filter,
  F6 process sort, Ctrl+K palette, Space pause, arrows/PageUp/PageDown/Home/End
  move the focused pane, q/Ctrl+C quit. Filters and overlays capture input first.
- Mouse clicks select tabs and rows; each scrollable pane owns its cursor and
  wheel region. Component controls actually change state.
- Resizing and small terminals must clip safely. Histories and logs are bounded.
  Collection does not overlap, uses elapsed time for counter rates, and handles
  disappearing processes/interfaces and unavailable tools without crashing.
- Missing/privileged sources are explicitly labeled. Real mode never falls back
  to fabricated metrics. Sensor absence is not reported as a zero temperature.
- Read-only inspection: no process termination, service changes, network probing
  or privilege escalation. External system utilities get explicit argv, timeouts
  and bounded output; user input never enters a shell command.
- Tests cover all screens and themes, deterministic snapshots, CLI validation,
  filtering/sorting/pause/overlays, independent scrolling, counter resets,
  missing sources, terminal restoration and non-TTY behavior.

## Delivery

Keep demo code beside the library it consumes so ordinary language tooling can
build and package it: Rust `ports/rust/demo`, Go `ports/go/cmd/hqtui-demo`, Python
`ports/python/hqtui_demo`, Zig `ports/zig/demo`. Shared verification belongs under
`apps/demo/scripts`. Library examples remain available.

Automated publication must test and package the libraries before their demos,
validate versions, avoid publishing unrelated registry packages, and clearly
report absent registry credentials. Document source commands even when registry
publication is not yet configured. Do not claim a registry release without
verifying the package is available there.
