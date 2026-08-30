# @profullstack/hqtui-demo

The **HQTUI** reference dashboard: a btop-grade terminal system monitor built entirely
in TypeScript with [`@profullstack/hqtui`](https://www.npmjs.com/package/@profullstack/hqtui).

It runs on **real system metrics** on Linux, macOS and Windows — with no native
dependencies — or on a deterministic simulation so screenshots and benchmarks are
reproducible.

![HQTUI dashboard](https://raw.githubusercontent.com/profullstack/hqtui/main/assets/hqtui-dashboard.png)

## Run it

```bash
bunx @profullstack/hqtui-demo          # your real machine
bunx @profullstack/hqtui-demo --sim    # deterministic simulation

npx @profullstack/hqtui-demo           # Node 22.6+ works too
```

## Options

```
--sim              Use the deterministic simulation instead of real metrics
--real             Read real system metrics (default)
--seed <n>         Simulation seed (default 1337)
--fps <n>          Frame cap (default 30, 15 over SSH)
--theme <name>     dark, dracula, nord, tokyoNight, gruvbox, matrix,
                   monochrome, highContrast, light
--screen <name>    dashboard, components, graphics, themes, input, stress
--interval <ms>    Metric refresh interval (default 1000)
-h, --help         Show help
-v, --version      Show the version
```

## Keys

| Key | Action |
|---|---|
| `1`–`6`, `Tab` | Switch screens |
| `F1` | Help |
| `F2` | Cycle theme |
| `F3` | Filter processes |
| `F6` | Change sort |
| `Ctrl+K` | Command palette |
| `Space` | Pause updates |
| `↑` `↓` `PgUp` `PgDn` `Home` `End` | Move selection |
| `Enter` | Confirmation dialog |
| `q`, `Ctrl+C` | Quit |

Mouse works too: click the tabs and buttons, scroll the process list.

## Screens

- **dashboard** — CPU, memory, disks, network, processes, temperatures, sensors, logs
- **components** — every widget in the library, interactive
- **graphics** — braille vs block vs ASCII, multi-series, gradients, raw canvas
- **themes** — all nine themes side by side, live switching
- **input** — keyboard and mouse event visualizer
- **stress** — every cell changing every frame, with live render statistics

## Where the metrics come from

| Platform | Source | Notes |
|---|---|---|
| Linux | `/proc`, `/sys`, `ps`, `df` | Everything, including per-core CPU and hwmon temperatures |
| macOS | `sysctl`, `vm_stat`, `top`, `netstat`, `iostat`, `ps` | Temperatures and fan speed need privileges, so they are reported as unavailable |
| Windows | PowerShell CIM (`Win32_*`), `Get-Process` | Temperatures are not exposed by CIM |

Anything a platform cannot provide is reported as **unavailable** rather than
fabricated — press `F1` to see the list for your machine. Run with `--sim` to see every
widget populated.

The demo reads only. It never writes files, makes network requests, or passes input to
a shell. The library it is built on has zero runtime dependencies and touches nothing.

## Build your own

```bash
bun add @profullstack/hqtui
```

```ts
import { createApp } from "@profullstack/hqtui";

const app = await createApp();

app.render(({ ui }) => {
  ui.panel({ title: "Hello" }, (panel) => panel.text("Hello, terminal."));
});

await app.start();
```

Docs at [hqtui.com](https://hqtui.com) · source at
[github.com/profullstack/hqtui](https://github.com/profullstack/hqtui) · MIT.
