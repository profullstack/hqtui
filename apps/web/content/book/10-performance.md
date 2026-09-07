---
title: Performance
order: 10
summary: The diff, what a frame actually costs, and the four things that make one slow.
---

A terminal is a slow output device with a fast interface, and almost every
sluggish TUI is sluggish for the same reason: it writes too much.

## What a frame costs

Three numbers, in order of how often they explain the problem:

1. **Bytes written.** What actually goes down the pipe. Over SSH this is the
   one that matters.
2. **Changed cells.** How many cells differed from the last frame. Bytes track
   this closely.
3. **Render time.** How long your view function took. Usually the smallest of
   the three, and usually not the problem.

The demo puts all three in its status bar, and it is worth putting them in
yours while you are building:

```ts
ui.statusBar({
  items: KEYS,
  right: [{ label: `${num(state.renderMs, 2)}ms  ${state.changedCells} cells  ${state.bytes}B` }],
});
```

A steady dashboard at rest should be writing tens of bytes per frame, not
thousands. If an idle screen is writing kilobytes, something is changing that
should not be.

## The usual culprits

**A clock with seconds, redrawn as a whole row.** The row is one string, so one
digit changing rewrites the row. Draw the clock in its own small region and the
diff shrinks to the digits.

**Rebuilding data every frame.** The view is called on every tick; if it sorts
ten thousand processes each time, that is your render time. Sort when the data
changes, not when the screen draws.

```ts
// Wrong: sorts every frame.
app.render(({ ui }) => {
  const rows = [...state.processes].sort(byCpu);
  ui.table({ rows, /* … */ });
});

// Right: sorts when the data or the sort key changes.
function refresh() { state.sorted = [...state.processes].sort(byCpu); }
app.render(({ ui }) => ui.table({ rows: state.sorted, /* … */ }));
```

**Rendering rows you cannot see.** Pass `offset` and let the widget draw the
visible window. Slicing ten thousand rows to twenty yourself works too; drawing
all ten thousand into a twenty-row region does not, because you paid to format
every one of them.

**Animating something nobody asked to animate.** A spinner in a corner
guarantees a non-empty diff on every single frame, forever. If the screen is
otherwise static, that spinner is your entire byte budget.

## Frame rate

Draw when something changed, not on a timer, whenever you can:

```ts
setInterval(() => { poll(); app.invalidate(); }, 1000);
```

`invalidate` asks for a frame. If your data arrives once a second, thirty
frames a second is twenty-nine wasted diffs. The library will coalesce
invalidations within a frame, so calling it from three different handlers in
the same tick costs one render.

When you genuinely are animating, cap it. Sixty frames a second in a terminal
is not smoother than thirty; it is the same picture and twice the bytes.

## The parts that are already fast

Some things are not worth optimising because they are already handled:

- **The diff.** Cell comparison is a tight loop over typed arrays, and the
  encoder emits runs rather than per-cell escapes. It moves the cursor rather
  than repainting a line, and it does not reset attributes between cells that
  share them.
- **Resizes.** Buffers are reused across a resize rather than reallocated.
- **Unicode width.** Character widths are computed from a compact table, not by
  measuring, and the result is cached per code point.

You will not beat these by hand, and attempts usually end up drawing more.

## Measuring properly

Render headlessly in a loop rather than eyeballing the terminal:

```ts
import { renderFrames } from "@profullstack/hqtui";

const start = performance.now();
renderFrames(view, 100, { width: 200, height: 60 });
console.log((performance.now() - start) / 100, "ms per frame");
```

That measures your view, without the terminal in the way. If it is fast here
and slow on screen, the problem is bytes rather than compute, and the fix is
drawing less rather than drawing faster.
