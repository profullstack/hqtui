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

## Context menus

A right-click opens a small menu where the pointer is. Unlike every other
overlay here, you do not keep its state: the app holds the one open menu across
frames, moves its highlight with the arrows and the pointer, and closes it when
an item is chosen, on Escape, or on a click outside.

Tabs have one built in. Give them close callbacks and a right-click offers them:

```ts
ui.tabs({
  tabs: files.map((f) => f.name),
  active,
  onSelect: (i) => { active = i; },
  onClose: (i) => closeFile(i),             // "Close tab", and middle-click
  onCloseOthers: (i) => keepOnly(i),        // "Close all but this tab"
  onCloseAll: () => closeAll(),             // "Close all tabs"
  menu: (i) => [{ label: "Reload from disk", onSelect: () => reload(i) }],
});
```

Anything else gets one by sitting inside a `contextArea`. Left clicks pass
straight through to what is inside it, and anything inside with a menu of its
own wins:

```ts
ui.contextArea({ menu: [
  { label: "New file", hint: "ctrl+n", onSelect: newFile },
  MENU_SEPARATOR,
  { label: "Delete", danger: true, disabled: !selected, onSelect: remove },
] }, (area) => {
  area.list({ items, selected, onSelectRow });
});
```

A menu near the right edge slides left and one near the bottom opens upward,
so it is always whole. To open one from your own code, call
`app.openContextMenu({ x, y, items })`. If you would rather own the state, as
with the emoji picker, `ui.contextMenu` draws one from `selected`, `onChange`,
`onSelect` and `onClose`, and `contextMenuKey` turns a key into what it does.
