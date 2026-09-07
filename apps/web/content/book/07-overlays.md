---
title: Overlays
order: 7
summary: Modals, the command palette and tooltips, and why they are drawn last.
---

Three widgets draw over the screen rather than in it: `modal`,
`commandPalette` and `tooltip`. They share a mechanism worth understanding,
because it explains both why they work and the one way they surprise people.

## They are deferred, not nested

An overlay does not draw where you call it. It registers a function that runs
after the whole frame is laid out, against the root surface.

```ts
app.render(({ ui, height }) => {
  ui.row({ size: 1 }, (header) => { /* … */ });
  ui.column({ size: height - 4 }, (body) => { screen(body, state); });
  ui.statusBar({ items: KEYS });

  if (state.showHelp) {
    ui.modal({ title: "Help", width: 62, height: 18, message: HELP,
               buttons: [{ label: "Close", focused: true }] });
  }
});
```

The modal covers the header, the body and the status bar, even though it was
called from the same container as they were and even though the container it
was called on is only one row tall. That is the point: an overlay is not
constrained by the region you happened to be in when you asked for it.

The surprise is the mirror image. Because overlays run last, you cannot draw
*on top of* one from a normal widget. If you want something above a modal, it
has to be another overlay, and overlays run in the order they were registered,
so a tooltip registered after a modal lands on top of it.

## Modals

```ts
ui.modal({
  title: "Confirm Action",
  width: 46,
  height: 9,
  message: "Terminate process 4821 (postgres)?\n\nThis cannot be undone.",
  buttons: [
    { label: "Yes", variant: "success", focused: true },
    { label: "No", variant: "ghost" },
  ],
});
```

`message` honours newlines, which is why it is a string rather than a set of
children. A modal wants `width` and `height` given: sized to its content it
jitters as the message changes, and a dialog that changes size while you read
it is unpleasant.

Give exactly one button `focused: true`. That is the one `Enter` presses, and
for a destructive action it should be the safe one.

A modal does not trap input for you. It draws; you decide what keys mean while
it is up:

```ts
app.on("key", (key) => {
  if (state.showModal) {
    if (key.name === "escape" || key.name === "n") state.showModal = false;
    if (key.name === "enter" || key.name === "y") { terminate(); state.showModal = false; }
    return;                    // nothing behind the modal sees this key
  }
  // …normal bindings
});
```

That early `return` is the whole of modality. Forgetting it is why a dialog
sometimes scrolls the list behind it.

## The command palette

```ts
const matches = COMMANDS.filter((c) =>
  c.label.toLowerCase().includes(state.query.toLowerCase()));

ui.commandPalette({
  query: state.query,
  items: matches.map((c) => ({ label: c.label, hint: c.hint })),
  selected: state.index,
});
```

The palette draws a query line and the results. It does not filter: you do.
That is deliberate, because your matching is better than any generic one the
library could ship. Fuzzy match, match on aliases, sort by recency, put the
thing they just used first. The widget's job is to look right.

Bind it to `Ctrl+K`. Every application that has one binds it to `Ctrl+K`.

## Tooltips

```ts
ui.tooltip({ text: "swap is 87% full", x: 6, y: 3 });
```

A small floating box anchored at a cell, clamped so it stays on screen. Use it
for hover text with the mouse, or to explain a value that has just gone red.

Tooltips are the one overlay that should usually be transient. Register it only
while the condition holds, and let the next frame not register it, rather than
tracking a dismissal.
