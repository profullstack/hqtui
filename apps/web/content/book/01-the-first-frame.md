---
title: The first frame
order: 1
summary: The smallest real program, and what actually happens when it draws.
---

Here is a whole application.

```ts
import { createApp } from "@profullstack/hqtui";

const app = createApp();
app.render(({ ui }) => {
  ui.panel({ title: "Hello" }, (p) => {
    p.text("Hello, terminal.");
    p.label("Press q to quit.");
  });
});
await app.start();
```

Run it and you get a bordered panel, in the terminal's full alternate screen,
that redraws when the window resizes and restores your shell cleanly when you
press `q`. There is no configuration, no widget registry, no component
lifecycle. There is a function that describes a screen.

That function is the whole model, so it is worth being precise about it.

## The view is a function of your state

`app.render` takes a callback and calls it whenever something might have
changed. It hands you a container and the current terminal size, and you draw.
It does not hand you a component tree to mutate, and it does not keep a copy of
your data.

This matters more than it sounds. Your state stays yours: a plain object, a
class, a database handle, whatever you already had. Nothing needs to be wrapped
in an observable or declared in a schema for the library to see it.

```ts
const state = { selected: 0, rows: loadRows() };

app.render(({ ui }) => {
  ui.table({
    rows: state.rows,
    selected: state.selected,
    columns: [{ key: "name", title: "Name" }, { key: "size", title: "Size" }],
  });
});
```

When `state.selected` changes, the next frame reflects it. There is no
subscription to forget.

## Frames are cheap because the terminal is not redrawn

The naive way to build a terminal UI is to clear the screen and print
everything again. That flickers, it is slow, and it fights the scrollback.

HQTUI keeps two framebuffers. You draw into one; the encoder compares it to
the last one and emits escape sequences only for the cells that differ. A
dashboard where one number changed sends a handful of bytes, not a screen.

You will see this in the status bar of the demo: *changed cells* and the byte
count of the last frame. Those numbers are the ones worth watching when a UI
feels sluggish, and [Performance](/book/10-performance) is about reading them.

## The container, briefly

The `ui` you are handed is a `Container`. Everything hangs off it, and it has
two kinds of method:

- **Layout**, which nests: `row`, `column`, `panel`, `grid`, `spacer`.
- **Widgets**, which draw: `text`, `table`, `meter`, `graph`, `button`, and the
  rest of [the gallery](/widgets).

They compose the obvious way.

```ts
ui.row({ gap: 1 }, (row) => {
  row.panel({ title: "Left", size: "1fr" }, (p) => p.text("one"));
  row.panel({ title: "Right", size: "1fr" }, (p) => p.text("two"));
});
```

A container passed to a callback is scoped to that region. `p` above cannot
draw outside its panel, which is why you never end up with a widget that
mysteriously overwrites the one next to it.

## Where the frame ends up

Nothing about this requires a terminal. The same view function renders
headlessly:

```ts
import { renderToText } from "@profullstack/hqtui";

const screen = renderToText(({ ui }) => {
  ui.panel({ title: "Hello" }, (p) => p.text("Hello, terminal."));
}, { width: 40, height: 5 });
```

`screen` is a string. That is how the pictures on hqtui.com are made, how the
tests in [Testing](/book/09-testing) assert, and how you check a layout in CI
without a pseudo-terminal. It is the same code path as the real thing, not a
mock of it.

## What to read next

If you know what you want to draw, go to [the widget
gallery](/widgets) and copy the call. If you want to understand why your panels
are the wrong size, the next chapter is the one you need.
