# VTTUI — High-Performance Graphical TUI Library
## Product Requirements Document

**Status:** Draft  
**Project name:** VTTUI  
**Final name:** VTTUI  
**License:** MIT  
**Project type:** Completely open-source TypeScript library  
**Primary runtimes:** Bun and Node.js  
**Secondary runtime goal:** Deno where practical  
**Primary platforms:** Linux, macOS, Windows Terminal  
**Primary use case:** Build beautiful, responsive, btop-quality terminal user interfaces using native TypeScript/JavaScript.

---

## 1. Executive Summary

VTTUI is a completely open-source TypeScript library for building high-quality graphical terminal user interfaces with the visual polish and responsiveness associated with applications such as `btop`.

The library must make it possible for a TypeScript developer to build dashboards, monitors, file managers, developer tools, process viewers, deployment consoles, database clients, agent dashboards, interactive CLIs, log viewers, network monitors, and other full-screen TUIs without using ncurses, Electron, a browser DOM, React reconciliation, or a native Rust/Zig/C++ rendering dependency.

The core design philosophy is:

> **Own the terminal directly, render only what changed, and make beautiful graphics a first-class primitive.**

VTTUI will use ANSI/VT terminal control sequences, Unicode/Braille rendering, 24-bit truecolor, a virtual framebuffer, diff-based rendering, optimized batched stdout writes, keyboard/mouse input handling, responsive layout, and reusable widgets.

The project will ship with a polished fake-realtime demo application showing the complete component system and serving as both a performance benchmark and a visual reference implementation.

---

# 2. Product Vision

Modern terminal applications should not have to look like 1990s ncurses software.

VTTUI should allow developers to create terminal applications that feel visually comparable to modern desktop dashboards while retaining the advantages of terminal software:

- instant startup
- extremely low resource usage
- remote operation over SSH
- no browser required
- keyboard-first workflows
- scriptability
- portability
- tiny deployment footprint
- native integration with command-line ecosystems

VTTUI should become the reusable rendering foundation for beautiful TypeScript/Bun/Node terminal applications.

---

# 3. Visual Target

VTTUI should realistically support interfaces in this quality range.

## 3.1 Component and layout showcase

![VTTUI component showcase](./assets/vttui-component-showcase.png)

The library should support the visual primitives demonstrated above:

- bordered panels
- CPU/core meters
- process tables
- line and area graphs
- network graphs
- disk utilization
- temperature bars
- tree views
- dialogs
- tables
- logs
- theme previews
- keyboard command bars
- colored status values
- gauges
- sparkline widgets
- multi-pane layouts

## 3.2 Fake realtime reference demo

![VTTUI realtime demo](./assets/vttui-realtime-demo.png)

The repository must include a runnable demo with simulated realtime data that reproduces the general quality and density of this design.

The demo does **not** need real system access. Its purpose is to demonstrate:

1. rendering quality
2. animation smoothness
3. high-density layouts
4. graphs
5. widgets
6. input handling
7. themes
8. responsive resizing
9. performance under constantly changing data

A separate optional example may later use real system statistics.

---

# 4. Naming and Domain Strategy

`VTTUI` is the project name.

The VTTUI brand should remain short, memorable, terminal-oriented, easy to spell, and sufficiently distinct across:

- GitHub organization/repository
- npm namespace
- website/domain
- social accounts
- package search
- documentation search
- CLI command

## 4.1 Brand requirements

The VTTUI brand should:

- be 4–10 characters
- imply terminal UI, terminal graphics, cells, glyphs, rendering, or dashboards
- work as a CLI command
- work as an npm package or organization
- have a viable `.dev`, `.sh`, `.io`, or `.com` domain
- avoid collisions with established terminal frameworks
- avoid names easily confused with OpenTUI, Ink, Blessed, Bubble Tea, Ratatui, Textual, TermGFX, etc.

## 4.2 Domain strategy

Primary domain target: `vttui.dev`.

Registrar availability and naming conflicts should still be re-checked immediately before registration.

### Package and repository naming

Until the final brand is chosen, use:

- repository codename: `vttui`
- docs title: `VTTUI`
- package examples: `@vttui/*`
- demo command: `vttui-demo`

Do **not** publish permanent package names until naming is finalized.

---

# 5. Goals

## 5.1 Primary goals

VTTUI must:

- be written in TypeScript
- run directly in modern JavaScript runtimes
- have a zero-runtime-dependency core whenever practical
- provide btop-quality terminal graphics
- render smoothly at interactive frame rates
- minimize terminal output using differential rendering
- support 24-bit truecolor
- support Unicode/Braille graphics
- support keyboard input
- support mouse input
- support terminal resize events
- support responsive layouts
- support high-level reusable widgets
- support low-level drawing primitives
- work well over SSH
- work correctly inside tmux
- work on Linux, macOS, and Windows Terminal
- degrade gracefully on limited terminals
- remain completely open source

## 5.2 Secondary goals

- optional JSX/declarative package
- Deno support
- WebAssembly-independent operation
- plugin/component ecosystem
- reusable theme packages
- screenshot/export tooling
- test renderer
- headless renderer
- accessibility/high-contrast modes
- reduced-motion mode
- terminal capability debugging CLI

---

# 6. Non-Goals

The MVP will not:

- implement a browser DOM
- implement full CSS
- require React
- require Electron
- require ncurses
- require a native Rust/Zig/C++ addon
- require OpenTUI
- emulate a complete terminal
- replace tmux
- implement a shell
- provide GPU rendering
- support arbitrary image protocols as a core requirement
- guarantee every legacy terminal behaves identically

Kitty/Sixel/iTerm image protocols may be explored later as optional extensions.

---

# 7. Core Architecture

The rendering pipeline should be intentionally simple:

```text
Application State
      │
      ▼
 Layout Engine
      │
      ▼
 Widget / Graphics Drawing
      │
      ▼
 Current Framebuffer
      │
      ├──────────────┐
      ▼              │
 Previous Buffer     │
      │              │
      └──────┬───────┘
             ▼
        Frame Differ
             │
             ▼
      ANSI Run Optimizer
             │
             ▼
        Batched Output
             │
             ▼
          Terminal
```

The renderer must not treat the terminal as a stream of independent widgets. The screen is a grid of cells and should be managed as one coherent framebuffer.

---

# 8. Monorepo Structure

Recommended repository:

```text
vttui/
├── apps/
│   ├── demo/
│   ├── benchmark/
│   └── docs/
│
├── packages/
│   ├── core/
│   ├── renderer/
│   ├── terminal/
│   ├── input/
│   ├── layout/
│   ├── graphics/
│   ├── widgets/
│   ├── themes/
│   ├── testing/
│   └── jsx/                 # optional, post-MVP
│
├── examples/
│   ├── hello-world/
│   ├── dashboard/
│   ├── process-table/
│   ├── graph/
│   ├── mouse/
│   ├── modal/
│   └── responsive/
│
├── benchmarks/
├── docs/
├── scripts/
├── assets/
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

For npm publishing after final naming:

```text
@vttui/core
@vttui/graphics
@vttui/widgets
@vttui/themes
@vttui/testing
@vttui/jsx
```

A bundled convenience package may export the common API:

```text
vttui
```

---

# 9. Technology Stack

## Required

- TypeScript
- Node.js 24+
- Bun
- ESM
- pnpm workspace
- Oxc for linting/formatting where suitable
- Rolldown for package bundling where suitable
- GitHub Actions
- MIT license

## Development/testing

Recommended:

- Vitest or Node/Bun native tests
- snapshot testing for deterministic renderer output
- benchmark suite
- pseudo-terminal integration tests where practical

## Runtime dependencies

Target:

```text
@vttui/core → 0 runtime dependencies
```

Higher-level packages may depend only on other packages from the project.

---

# 10. Terminal Layer

The terminal package is responsible for low-level interaction with the TTY.

## 10.1 Required features

- enter/leave alternate screen
- hide/show cursor
- cursor movement
- cursor position
- raw input mode
- terminal size detection
- resize event handling
- clear screen/regions
- synchronized updates where supported
- terminal title
- bracketed paste support
- mouse tracking modes
- focus events where supported
- cleanup after exceptions
- cleanup after signals
- restore terminal state on exit

Example:

```ts
const terminal = await createTerminal();

await terminal.enter();

try {
  // run application
} finally {
  await terminal.restore();
}
```

VTTUI must make it difficult for an application crash to leave the user's terminal in an unusable state.

---

# 11. Terminal Capability Detection

VTTUI should detect or infer:

- TTY vs redirected stdout
- terminal dimensions
- Unicode support
- Braille support
- truecolor
- 256-color mode
- 16-color fallback
- mouse capability
- OSC support where relevant
- synchronized output
- tmux
- screen
- SSH
- Windows Terminal
- Kitty
- WezTerm
- iTerm2
- Alacritty
- Ghostty
- xterm-compatible terminals

Application code should be able to inspect capabilities:

```ts
const caps = app.capabilities;

caps.trueColor;
caps.braille;
caps.mouse;
caps.unicode;
caps.synchronizedOutput;
```

Manual overrides must be supported through API options and environment variables.

---

# 12. Framebuffer

The framebuffer is the core performance primitive.

Avoid one JavaScript object per cell in hot paths.

Recommended representation:

```ts
interface FrameBuffer {
  width: number;
  height: number;

  chars: Uint32Array;
  foreground: Uint32Array;
  background: Uint32Array;
  attributes: Uint16Array;
}
```

Each cell represents:

- Unicode codepoint/grapheme reference
- foreground RGB/index
- background RGB/index
- style attributes

Possible packed color representation:

```text
0xRRGGBB
```

or an integer encoding supporting special/default values.

## 12.1 Double buffering

Maintain:

```text
previousFrame
currentFrame
```

After rendering:

```text
diff(previousFrame, currentFrame)
     ↓
optimized terminal writes
```

Buffers should be reused rather than constantly reallocated.

---

# 13. Unicode and Grapheme Handling

Terminal text rendering is deceptively difficult.

VTTUI must correctly handle:

- ASCII
- Unicode box characters
- Braille
- block elements
- emoji where practical
- full-width CJK characters
- combining marks
- zero-width codepoints
- grapheme clusters
- ambiguous-width behavior

The renderer must never corrupt adjacent cells due to incorrect width assumptions.

Provide a low-level width abstraction so behavior can evolve without changing widget APIs.

---

# 14. Differential Renderer

A full redraw should not occur for every update.

Example:

```text
CPU 72%
```

becoming:

```text
CPU 73%
```

should ideally output only the changed region.

## 14.1 Diff algorithm

For each row:

1. compare previous/current cells
2. locate changed spans
3. combine neighboring changes
4. calculate whether cursor movement or rewriting is cheaper
5. minimize style transitions
6. output runs rather than individual cells
7. batch output into as few writes as practical

Conceptually:

```ts
const operations = diff(previous, current);
const ansi = optimize(operations, terminalState);

stdout.write(ansi);
```

## 14.2 Terminal state cache

Maintain assumed terminal state:

```ts
interface TerminalState {
  x: number;
  y: number;
  fg: number;
  bg: number;
  attributes: number;
}
```

Do not emit redundant escape sequences.

---

# 15. Render Scheduler

VTTUI should not blindly redraw at a fixed rate.

Supported modes:

### Invalidation mode

```ts
app.invalidate();
```

Render only when state changes.

### Fixed animation rate

```ts
app.setTargetFps(30);
```

### Adaptive mode

Animations may request frames while static interfaces remain idle.

Target behavior:

```text
idle              ~0 FPS
typing             event-driven
realtime dashboard 10–30 FPS
animation          up to 60 FPS
```

The event loop should remain responsive under sustained data updates.

---

# 16. Graphics Engine

Graphics are a first-class feature, not an afterthought.

## 16.1 Braille canvas

Unicode Braille provides a virtual 2×4 pixel matrix per terminal cell.

A Braille canvas should expose:

```ts
const canvas = new BrailleCanvas(width, height);

canvas.pixel(x, y);
canvas.line(x1, y1, x2, y2);
canvas.polyline(points);
canvas.fill(...);
canvas.clear();
```

## 16.2 Drawing primitives

Required primitives:

- point
- line
- horizontal line
- vertical line
- rectangle
- filled rectangle
- polyline
- area
- plot
- text
- box
- border
- sparkline
- bar
- arc/gauge approximations

## 16.3 Character rendering modes

Support:

```text
braille
block
half-block
quadrant
ascii
```

Fallback:

```text
Braille
   ↓
Unicode block elements
   ↓
ASCII
```

---

# 17. Color System

Support:

- 24-bit RGB truecolor
- 256-color conversion
- 16-color conversion
- terminal default color
- alpha-like blending performed in software
- gradients
- theme tokens

Example:

```ts
rgb(0, 215, 255);
hex("#00d7ff");
```

Gradient:

```ts
gradient([
  "#00d7ff",
  "#5fff87",
  "#ffd75f",
  "#ff5f5f",
]);
```

The library should automatically quantize colors when truecolor is unavailable.

---

# 18. Layout Engine

A major product requirement is avoiding manual coordinate arithmetic for normal application development.

Support:

- rows
- columns
- grid
- fixed sizes
- percentages
- flex units
- min/max
- padding
- gaps
- alignment
- overflow/clipping
- nested containers

Example:

```ts
ui.row({ height: "100%" }, row => {
  row.panel({ width: "40%" });

  row.column({ width: "60%" }, col => {
    col.panel({ height: "50%" });
    col.panel({ height: "50%" });
  });
});
```

Constraint API:

```ts
fixed(20)
percent(40)
flex(1)
minmax(20, 80)
remaining()
```

---

# 19. Widget Library

MVP widgets:

## Structure

- Panel
- Box
- Divider
- Spacer
- ScrollView
- Tabs

## Text/data

- Text
- Label
- Badge
- KeyValue
- Table
- List
- Tree
- LogViewer

## Metrics

- Gauge
- Meter
- ProgressBar
- Sparkline
- LineGraph
- AreaGraph
- BrailleGraph
- Histogram
- MultiSeriesGraph

## Input

- Button
- Checkbox
- Radio
- Select
- TextInput
- SearchInput

## Overlay

- Modal
- Dialog
- CommandPalette
- Tooltip
- ContextMenu

## Navigation

- Menu
- StatusBar
- CommandBar
- Breadcrumb

---

# 20. Focus and Input Model

VTTUI must expose a predictable event system.

```ts
app.on("key", event => {});
app.on("mouse", event => {});
app.on("resize", event => {});
app.on("focus", event => {});
```

Keyboard events should normalize:

- arrows
- Enter
- Escape
- Tab
- Shift+Tab
- Backspace
- Delete
- Home/End
- PageUp/PageDown
- F1–F12+
- Ctrl combinations
- Alt combinations
- Shift combinations
- printable text
- paste

Mouse events:

- move
- click
- double click
- press
- release
- drag
- scroll
- coordinates
- modifiers

Focus traversal should work out of the box.

---

# 21. API Design

VTTUI should prioritize a simple imperative API first.

Example:

```ts
import {
  createApp,
  rgb,
} from "@vttui/core";

const app = await createApp({
  fps: 30,
});

app.render(({ ui, state }) => {
  ui.grid({
    columns: ["2fr", "1fr"],
    rows: [12, "1fr"],
  }, grid => {
    grid.panel({ title: "CPU" }, panel => {
      panel.graph({
        data: state.cpu,
        mode: "braille",
      });
    });

    grid.panel({ title: "Memory" }, panel => {
      panel.gauge({
        value: state.memory,
      });
    });

    grid.panel({ title: "Processes" }, panel => {
      panel.table({
        rows: state.processes,
      });
    });
  });
});

await app.start();
```

The API should allow direct low-level framebuffer access for advanced applications.

---

# 22. Optional Declarative / JSX Layer

JSX is useful but must not be the foundation of the renderer.

Post-MVP:

```tsx
<App>
  <Grid columns={["2fr", "1fr"]}>
    <Panel title="CPU">
      <BrailleGraph values={cpu} />
    </Panel>

    <Panel title="Memory">
      <Gauge value={memory} />
    </Panel>
  </Grid>
</App>
```

This package should translate declarative components into the same native VTTUI scene/layout model.

It must not introduce browser DOM semantics or React as a runtime requirement.

---

# 23. Fake Realtime Demo Application

The demo is a **required deliverable**, not optional marketing fluff.

Run:

```bash
pnpm demo
```

or eventually:

```bash
npx vttui demo
```

The demo should contain animated fake data for:

### CPU

- overall utilization
- per-core utilization
- load averages
- scrolling history graph

### Memory

- used
- available
- cached
- buffers
- swap

### Disk

- capacity
- free space
- read throughput
- write throughput
- IOPS
- history graphs

### Network

- receive rate
- transmit rate
- cumulative totals
- peaks
- dual-series graph

### Processes

- PID
- name
- CPU
- memory
- RSS
- threads
- user
- command
- state

### Temperatures

- CPU package
- CPU cores
- GPU
- SSD

### Sensors

- fans
- voltage
- battery
- power

### Logs

Generate simulated:

- INFO
- DEBUG
- WARN
- ERROR

### Component showcase

Include:

- buttons
- dropdown
- toggle
- checkbox
- table
- modal
- tree
- theme selector
- gauges
- progress bars
- command palette

---

# 24. Fake Data Engine

The demo must not depend on OS-specific monitoring APIs.

Create a deterministic simulation package:

```text
@vttui/demo-data
```

or internal demo module.

Properties:

- seeded PRNG
- smooth CPU variation
- periodic spikes
- correlated per-core values
- realistic memory drift
- network bursts
- process churn
- realistic disk activity
- temperature lag relative to CPU
- log event generation
- reproducible benchmark mode

Example:

```ts
const simulation = createSystemSimulation({
  seed: 1337,
  tickMs: 100,
});
```

This gives CI and benchmarks identical data sequences.

---

# 25. Themes

Ship attractive built-in themes.

Initial themes:

- VTTUI Default
- Dracula-inspired
- Nord-inspired
- Tokyo Night-inspired
- Gruvbox-inspired
- Monochrome
- High Contrast
- Light

Avoid copying copyrighted theme implementations verbatim where inappropriate; use compatible color inspiration or officially permitted palettes.

Theme API:

```ts
interface Theme {
  background: Color;
  foreground: Color;

  primary: Color;
  secondary: Color;

  success: Color;
  warning: Color;
  danger: Color;
  info: Color;

  border: Color;
  borderFocused: Color;
  muted: Color;

  graph: Color[];
}
```

User-defined themes must be straightforward.

---

# 26. Performance Requirements

Performance is a core product feature.

## 26.1 Target environments

Baseline benchmark:

```text
Terminal size: 160 × 50
Cells:         8,000
Refresh data:  10 Hz
Target FPS:    30
Runtime:       Bun / Node
```

Stretch benchmark:

```text
Terminal size: 240 × 70
Cells:         16,800
Target FPS:    60
```

## 26.2 Performance targets

For common dashboards:

- no visible flicker
- no full-screen clear per frame
- p95 renderer CPU time under 8 ms at 160×50 on a modern machine
- typical changed-frame render under 4 ms
- idle CPU near zero
- minimal garbage generation in hot paths
- one or very few stdout writes per frame
- no memory growth during long sessions
- responsive keyboard input while graphs update

These are targets, not promises until benchmarked.

---

# 27. Benchmark Suite

Repository must include reproducible benchmarks for:

- full framebuffer write
- 1% changed cells
- 10% changed cells
- 50% changed cells
- 100% changed cells
- contiguous change runs
- random sparse changes
- gradients
- Braille graph drawing
- text-heavy tables
- resize/re-layout
- grapheme-heavy text

Output:

```text
renderer.diff
renderer.encodeAnsi
renderer.frame
graphics.braille
layout.solve
widgets.table
```

Benchmark results should be publishable in docs and CI artifacts.

---

# 28. Memory and GC Requirements

Avoid creating temporary objects per cell.

Preferred:

- typed arrays
- reusable buffers
- object pools only where justified
- precomputed escape sequences where useful
- packed numeric colors/styles
- cached grapheme calculations
- cached border characters
- cached layout structures when unchanged

Profiling should explicitly inspect:

- allocations/frame
- GC pauses
- long-running heap growth
- retained widget state

---

# 29. Responsive Design

VTTUI applications must respond intelligently to terminal resize.

Widgets should support:

- minimum width
- minimum height
- hiding optional sections
- changing grid columns
- moving panels
- reducing graph density
- collapsing detail views

Example:

```ts
responsive({
  minWidth: 120,
  render: desktopDashboard,
  fallback: compactDashboard,
});
```

The demo must remain usable down to an explicitly documented minimum terminal size.

---

# 30. Terminal Compatibility

Tier 1:

- Linux TTY
- SSH sessions
- tmux
- Kitty
- WezTerm
- Ghostty
- Alacritty
- GNOME Terminal
- Konsole
- macOS Terminal
- iTerm2
- Windows Terminal

Tier 2:

- screen
- xterm
- other VT-compatible terminals

Fallback behavior:

- disable mouse
- quantize color
- replace Braille
- replace Unicode borders
- disable animation when necessary

---

# 31. SSH and Remote Performance

VTTUI should remain pleasant over remote connections.

Provide configuration:

```ts
createApp({
  outputMode: "auto",
  maxFps: 30,
  remoteMaxFps: 15,
});
```

Potential adaptive behavior:

- detect SSH environment
- reduce FPS
- aggressively combine writes
- avoid unnecessary redraws
- prefer compact ANSI changes

Do not compromise local performance to support remote sessions.

---

# 32. Accessibility

Provide:

- high-contrast theme
- monochrome mode
- no-color mode
- reduced-motion mode
- ASCII-only fallback
- configurable focus indicators
- semantic labels for test/headless output where practical

Environment compatibility:

```text
NO_COLOR
TERM
COLORTERM
```

---

# 33. Error Recovery

The framework must restore terminal state after:

- Ctrl+C
- SIGTERM
- uncaught exception
- rejected promise
- normal exit

Restoration includes:

- cursor visibility
- raw mode
- mouse mode
- alternate screen
- bracketed paste
- synchronized updates

Provide an explicit emergency restore helper if useful.

---

# 34. Testing Strategy

## Unit tests

- cell encoding
- colors
- gradients
- Braille masks
- graph interpolation
- terminal sequences
- input parser
- layout constraints
- diffing
- run optimization

## Snapshot tests

Use a headless framebuffer renderer:

```ts
const result = renderToText(app, {
  width: 80,
  height: 24,
});
```

Snapshots should not depend on a real terminal.

## Integration tests

Where possible:

- PTY lifecycle
- raw mode
- resize
- keyboard decoding
- mouse decoding
- cleanup

---

# 35. Headless/Test Renderer

A first-class testing package is required.

Example:

```ts
const screen = render(<Dashboard />, {
  width: 120,
  height: 40,
});

expect(screen.text()).toContain("CPU");
expect(screen.cell(4, 8).fg).toEqual(...);
```

Possible outputs:

- plain text
- ANSI
- JSON cell grid
- SVG (post-MVP)
- HTML debug view (post-MVP)

This will make VTTUI applications dramatically easier to test than traditional TUIs.

---

# 36. Developer Experience

Desired first-run flow:

```bash
pnpm add vttui
```

Then:

```ts
import { createApp } from "vttui";

const app = await createApp();

app.render(({ ui }) => {
  ui.panel({ title: "Hello" }, panel => {
    panel.text("Hello, terminal.");
  });
});

await app.start();
```

Development should support quick restart or optional HMR-like workflows without leaving stale terminal state.

---

# 37. CLI Scaffolding

Post-MVP or late MVP:

```bash
pnpm create vttui
```

Interactive choices:

```text
? Project name
? Template
  Basic
  Dashboard
  Table
  Monitor
  Full Demo

? Runtime
  Bun
  Node

? TypeScript
  Yes
```

Produces a working app immediately.

---

# 38. Documentation Site

Docs should include:

- quick start
- architecture
- widgets
- colors
- themes
- graphics
- Braille canvas
- layout
- keyboard
- mouse
- responsive design
- testing
- performance
- terminal compatibility
- examples
- migration guidance from Ink/Blessed/etc.
- benchmark dashboard

The documentation website may be statically deployed to GitHub Pages, Cloudflare Pages, or equivalent.

No hosted service is required for the library.

---

# 39. Open Source Requirements

The project is permanently open source.

## License

Recommended:

```text
MIT
```

Requirements:

- public repository
- public issue tracker
- public roadmap
- public CI
- contributor guide
- code of conduct
- security policy
- no proprietary core modules
- no telemetry by default
- no account requirement
- no cloud requirement
- no paid-only widgets

Commercial support, sponsorship, or consulting may exist later without restricting the open-source library.

---

# 40. Security and Privacy

VTTUI itself should:

- make no network requests
- include no analytics
- include no tracking
- write no files unless explicitly requested
- execute no subprocesses unless an application asks it to
- collect no user data

The fake demo must run entirely locally.

---

# 41. Packaging

Final package exports should be tree-shakeable.

Example:

```ts
import {
  createApp,
  Panel,
  BrailleGraph,
  Table,
} from "vttui";
```

Advanced users:

```ts
import { FrameBuffer } from "@vttui/renderer";
import { BrailleCanvas } from "@vttui/graphics";
```

Support:

- ESM
- `.d.ts`
- source maps
- Node
- Bun

Avoid unnecessary CommonJS unless demand justifies it.

---

# 42. Example Applications

The repository must demonstrate more than hello-world.

Required examples:

1. Hello panel
2. Progress/gauges
3. Braille graph
4. Multi-series graph
5. Table
6. Tree
7. Log viewer
8. Mouse interactions
9. Keyboard navigation
10. Modal/dialog
11. Responsive layout
12. Full fake system dashboard

---

# 43. Future Graphics Extensions

After core stability:

- Sixel
- Kitty graphics protocol
- iTerm inline images
- image-to-Braille
- image-to-half-block
- SVG screenshot renderer
- terminal recording
- animation timelines
- compositing
- custom shaders simulated through cell transforms
- canvas transforms
- antialiased Braille lines

These are optional extensions and must not bloat the core.

---

# 44. Potential Ecosystem Packages

Future:

```text
@vttui/charts
@vttui/forms
@vttui/filesystem
@vttui/monitoring
@vttui/themes
@vttui/jsx
@vttui/testing
@vttui/devtools
```

Third parties should be able to publish widgets without modifying core.

---

# 45. Reference Demo Interaction

Suggested controls:

```text
F1      Help
F2      Theme
F3      Search
F4      Filter
F5      Tree
F6      Sort
Tab     Next focus
Shift+Tab Previous focus
Enter   Activate
Esc     Close
Space   Toggle
q       Quit
Ctrl+C  Quit
```

Mouse:

- click tabs
- click buttons
- scroll lists
- drag scrollbars
- hover optional tooltips

---

# 46. Demo Screens

The fake realtime demo should expose several modes.

## Dashboard

Full system monitor.

## Components

Every widget in isolation.

## Graphics

Braille, block, gradient, and plotting tests.

## Layout

Responsive and nested grid demonstrations.

## Themes

Live theme switching.

## Stress Test

Rapidly changing data across the full screen.

## Input

Keyboard and mouse event visualizer.

---

# 47. Suggested MVP Milestones

## M0 — Research / spec

- confirm `vttui.dev` domain registration
- reserve GitHub org/repository
- reserve npm namespace
- terminal compatibility matrix
- rendering benchmark harness

## M1 — Terminal core

- raw mode
- alternate screen
- cursor
- resize
- ANSI
- colors
- cleanup

## M2 — Framebuffer

- typed-array cells
- double buffering
- diff
- run merging
- ANSI state optimization

## M3 — Graphics

- boxes
- lines
- Braille canvas
- sparkline
- graph
- gradients

## M4 — Layout

- row/column
- grid
- flex units
- padding/gaps
- clipping

## M5 — Input

- keyboard
- mouse
- focus
- paste
- resize

## M6 — Widgets

- panel
- text
- gauge
- table
- list
- tree
- logs
- modal
- tabs

## M7 — Fake realtime demo

Reproduce the target visuals included in this PRD.

## M8 — Tests and benchmarks

- headless renderer
- snapshots
- PTY integration
- performance suite

## M9 — Documentation

- website
- examples
- API reference
- migration guides

## M10 — 1.0 release

- stable API
- compatibility matrix
- benchmark report
- published npm packages

---

# 48. MVP Acceptance Criteria

Version `0.1` is acceptable when:

- full-screen app starts/restores terminal reliably
- framebuffer and differential renderer work
- truecolor works
- Braille graph renders correctly
- keyboard input works
- mouse input works in supported terminals
- terminal resize works
- panel/table/gauge/graph widgets exist
- fake realtime demo runs smoothly
- demo visually resembles the supplied mockups
- tests run in CI
- no runtime native dependency is required
- no telemetry/network access exists

Version `1.0` requires:

- stable public API
- documented compatibility
- reproducible performance benchmarks
- responsive layouts
- full MVP widget set
- theme support
- headless testing utilities
- polished docs
- Node and Bun production support
- Windows Terminal validation
- SSH/tmux validation

---

# 49. Performance Definition of Done

Before `1.0`, benchmark and publish:

```text
Machine
Runtime
Terminal
Terminal size
FPS target
Mean render time
p95 render time
Bytes/frame
Changed cells/frame
Memory usage
Allocations/frame
```

The renderer should demonstrate materially less output for small changes than a naive full-screen redraw.

Example target scenario:

```text
160 × 50 dashboard
30 FPS target
10% of cells changing
no flicker
responsive input
stable memory
```

---

# 50. Design Principles

Every architectural decision should be evaluated against these rules.

### 1. Terminal-first

Do not imitate browser architecture unnecessarily.

### 2. Performance by construction

Framebuffer diffing is fundamental, not an optimization bolted on later.

### 3. Beautiful by default

A developer should obtain a polished interface without spending days tuning ANSI sequences.

### 4. Escape hatches everywhere

Advanced developers must be able to draw directly.

### 5. No native dependency required

Native TypeScript/JavaScript remains the default implementation.

### 6. Zero network dependency

A terminal UI framework should work offline forever.

### 7. Open source means open source

No essential feature belongs behind a hosted service.

### 8. Remote-friendly

SSH and tmux are first-class environments.

### 9. Testable

Terminal applications should be unit/integration testable without screenshot clicking.

### 10. Small core, rich ecosystem

Keep rendering primitives lean; allow widgets and integrations to expand independently.

---

# 51. Initial API Sketch

```ts
import {
  createApp,
  themes,
} from "vttui";

const simulation = createFakeSystem({
  seed: 1337,
});

const app = await createApp({
  theme: themes.default,
  maxFps: 30,
  mouse: true,
});

app.render(({ ui }) => {
  const data = simulation.current();

  ui.grid({
    columns: ["1fr", "1fr", "1fr"],
    rows: [20, "1fr"],
    gap: 1,
  }, grid => {
    grid.panel({ title: "CPU Overview" }, panel => {
      panel.graph({
        values: data.cpu.history,
        mode: "braille",
      });

      panel.meters(data.cpu.cores);
    });

    grid.panel({ title: "Memory & Swap" }, panel => {
      panel.gauge({
        value: data.memory.used / data.memory.total,
      });
    });

    grid.panel({ title: "Disks" }, panel => {
      panel.multiGraph({
        series: [
          data.disk.read,
          data.disk.write,
        ],
      });
    });

    grid.panel({
      title: "Processes",
      colSpan: 2,
    }, panel => {
      panel.table({
        rows: data.processes,
        sort: "cpu",
      });
    });

    grid.panel({ title: "System" }, panel => {
      panel.keyValues(data.system);
    });
  });
});

simulation.on("tick", () => app.invalidate());

await app.start();
```

---

# 52. Success Metrics

Open-source success should be measured using:

- GitHub stars/forks
- npm downloads
- external projects using the library
- contributors
- third-party widgets/themes
- documentation usage
- issue response time
- benchmark regressions
- terminal compatibility reports

Technical success:

- applications feel instantaneous
- developers can reproduce btop-class dashboards quickly
- the core remains dependency-light
- rendering performance remains stable as widgets grow

---

# 53. Final Product Statement

**VTTUI (codename)** is a native TypeScript graphical terminal UI framework focused on rendering quality and speed.

It combines:

```text
ANSI / VT terminal control
        +
typed-array framebuffer
        +
differential rendering
        +
Unicode / Braille graphics
        +
truecolor
        +
responsive layout
        +
keyboard / mouse input
        +
high-quality widgets
        =
beautiful modern terminal applications
```

The reference implementation is the fake realtime dashboard included in this PRD.

The goal is simple:

> **Make it as easy to build a gorgeous, fast terminal application in TypeScript as it is to build a modern web dashboard.**

---

# Appendix A — Visual Assets

Repository paths:

```text
assets/vttui-component-showcase.png
assets/vttui-realtime-demo.png
```

These images are concept targets. Exact text, colors, layout, and metrics do not define a pixel-perfect implementation requirement; the product must match their overall visual fidelity, information density, animation quality, and polish.

---

# Appendix B — Brand Reservation Checklist

Before public launch:

- [ ] web search for collisions
- [ ] GitHub search
- [ ] npm search
- [ ] crates.io search
- [ ] PyPI search
- [ ] Go package search
- [ ] domain registrar availability
- [ ] trademark sanity check
- [ ] social account search
- [ ] reserve domain
- [ ] reserve npm namespace
- [ ] reserve GitHub org/repo
- [ ] reserve `vttui` / `@vttui` package names
- [ ] confirm screenshots use VTTUI branding
- [ ] publish branding guide
