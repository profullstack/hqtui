# Contributing to HQTUI

Thanks for helping. HQTUI is MIT licensed and permanently open source.

## Getting set up

```bash
git clone https://github.com/profullstack/hqtui
cd hqtui
bun install
bun test                  # ~100 tests, no TTY required
bun run typecheck
bun run demo -- --sim     # the reference dashboard
bun run bench             # renderer benchmarks
```

Bun is the default runtime; everything also runs under Node 22.6+
(`node --test packages/hqtui/test/*.test.ts`).

## The rules that matter

1. **`packages/hqtui` has zero runtime dependencies.** Higher-level packages may depend
   on other packages in this repo, and nothing else.
2. **No network access, no telemetry, no subprocesses** in the library. `apps/demo` may
   run commands to read real system metrics; the library may not.
3. **Nothing allocates per cell in a hot path.** Framebuffer work uses typed arrays and
   reused buffers. If you add to the render path, add a benchmark.
4. **Every widget must survive a 1x1 terminal.** Clipping is the Surface's job, but
   widgets must not throw, and must not draw outside the rect they were given.
5. **Terminal state must always be restored** — on Ctrl+C, SIGTERM, an uncaught
   exception, and normal exit.

## Tests

Use the headless renderer; snapshot tests should never need a real terminal.

```ts
import { renderToScreen } from "@profullstack/hqtui";
const screen = renderToScreen(({ ui }) => ui.text("CPU 72%"), { width: 40, height: 3 });
```

## Pull requests

Keep changes focused, include tests, and run `bun run typecheck && bun test` first.
Performance-sensitive changes should include before/after `bun run bench` output.
