---
title: Input and focus
order: 6
summary: Keys, the mouse, buttons, checkboxes, selects, text inputs, tabs, and how focus is decided.
---

## Keys

```ts
app.on("key", (key) => {
  switch (key.name) {
    case "down": state.selected++; break;
    case "up": state.selected--; break;
    case "q": app.quit(); break;
  }
});
```

`key.name` is a normalised name, not a byte: `"up"`, `"pageup"`, `"f3"`,
`"enter"`, `"escape"`, `"a"`. Modifiers are flags on the same object, so
`key.ctrl && key.name === "k"` is the command palette and you never parse an
escape sequence yourself.

Two things are worth knowing because they bite everyone once.

Terminals send `Escape` and the start of every function-key sequence as the
same first byte. The input layer disambiguates by waiting a few milliseconds,
so a real `Escape` arrives very slightly late. That is not a bug you can fix by
polling faster, and it is why `Escape` is a poor choice for anything that
should feel instant.

And arrow keys have two encodings. In application cursor mode a terminal sends
`ESC O A` rather than `ESC [ A`, and both are decoded, so you do not care.
You *do* care when you synthesise keys in a test: send the form your terminal
mode implies, or the key will not arrive.

## The mouse

Mouse handling is per widget rather than per screen, which is what makes the
wheel do the obvious thing:

```ts
ui.table({
  rows,
  onScroll: (delta) => scroll(pane, delta),
  onFocus: () => focus(pane),
  onSelectRow: (row) => { pane.selected = pane.offset + row; },
});
```

Pass `onScroll` and the widget claims the region it drew; the wheel over that
region scrolls it, and the wheel over the panel next to it scrolls that one
instead. There is no global "which list has the mouse" state to maintain.

A click is answered by the topmost region under it, and a double-click is the
same press delivered with `clicks: 2`. Every chrome element that looks
clickable takes a handler:

```ts
// A row: click selects, double-click opens.
ui.table({ rows, onSelectRow: select, onActivateRow: open });

// The key bar: each item that has an action is a button.
ui.statusBar({ items: [
  { key: "F1", label: "Help", onPress: showHelp },
  { key: "q", label: "Quit", onPress: () => app.quit() },
]});

// A dialog: its buttons press, and a click on the backdrop dismisses it.
// While it is up, nothing underneath hears a click at all.
ui.modal({
  title: "Delete?",
  buttons: [{ label: "Yes", onPress: confirm }, { label: "No", onPress: close }],
  onDismiss: close,
});

// A panel: whatever its children did not claim — border, title, blank space.
ui.panel({ title: " Remote ", onClick: () => focus("remote") }, build);
```

The rule is that a region answers for exactly the cells it drew: a key cap and
its label, a button, a row. The gap between two items belongs to neither, so a
click between `F1 Help` and `F2 Theme` does nothing rather than doing the wrong
thing.

Hover is the same shape. `onHoverRow` reports the row under the pointer, and
`hovered` draws it a shade lighter, so the eye finds the target before the
click. The widget only hears the pointer while it is inside, so clear the
hover in your own `mouse` listener when a move arrives that no row claimed:

```ts
ui.tree({ nodes, selected, hovered: state.hover,
          onHoverRow: (row) => { state.hover = row; state.hoverSeen = true; } });

app.on("mouse", (event) => {
  if (event.action === "move" && !state.hoverSeen) state.hover = undefined;
  state.hoverSeen = false;
});
```

## Controls, and how focus happens

```ts
ui.row({ size: 1, gap: 1 }, (r) => {
  r.button({ label: "Primary", width: 11, size: 11, onPress: () => confirm() });
  r.button({ label: "Danger", width: 10, size: 10, variant: "danger" });
});

ui.checkbox({ label: "Toggle", checked: state.toggle, variant: "toggle",
              onToggle: () => { state.toggle = !state.toggle; } });

ui.select({
  value: THEMES[state.theme],
  options: THEMES,
  selectedIndex: state.theme,
  open: state.open,
  onOpen: () => { state.open = !state.open; },
});

ui.textInput({ label: "Search", value: state.query, placeholder: "type to filter…" });
```

Focus is positional and implicit. A control that takes a handler registers
itself in the order it is drawn, and `Tab` moves through that order. There is
no focus id to assign and no tab index to keep in sync, because the order you
draw things in is the order a user will read them in.

The consequence to know: a control drawn conditionally changes the tab order
when it appears. If a panel shows an extra button while a job is running, the
buttons after it shift by one. Usually that is right. When it is not, draw the
control always and disable it.

Pass `focused: true` explicitly to override, which is what a modal does to put
the cursor on its default button.

## Tabs

```ts
ui.tabs({
  tabs: SCREENS.map((s, i) => `${(i + 1) % 10} ${s}`),
  active: SCREENS.indexOf(state.screen),
  onSelect: (index) => { state.screen = SCREENS[index]; },
});
```

Tabs are clickable and take a number prefix by convention, so `3` jumps to the
third screen and the label tells you that without a help page. It is a small
thing that makes an application feel like it was built by someone who uses
terminals.

## The pattern underneath

Every control here follows the same shape: it takes its current value and a
callback, and it stores nothing. `checked` comes from your state and `onToggle`
changes your state; the widget never holds a second copy that could disagree.

This is why there is no form abstraction in the library and no need for one.
Twelve controls wired this way are twelve lines of state and twelve callbacks,
and every one of them is inspectable in your own object rather than somewhere
in a component tree.
