## What this changes

<!-- One or two sentences. If it fixes an issue, link it. -->

## Why

<!-- What was wrong, and how you know. A reproduction beats a description. -->

## Checklist

CONTRIBUTING has the full list; these are the ones that come up most.

- [ ] `bun run typecheck && bun test` pass
- [ ] Tests added or updated, using the headless renderer — no real terminal needed
- [ ] `packages/hqtui` still has zero runtime dependencies
- [ ] No network access, telemetry or subprocesses in the library
- [ ] Nothing allocates per cell in a hot path
- [ ] Every widget touched still survives a 1x1 terminal without throwing or
      drawing outside its rect
- [ ] The terminal is still restored on Ctrl+C, SIGTERM, an uncaught exception
      and normal exit

## Benchmarks

<!-- Required for render-path changes. Paste `bun run bench` before and after. -->

```
```
