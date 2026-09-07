---
title: Tables, lists, trees and logs
order: 4
summary: The four widgets that show rows, and the scrolling model they share.
---

Four widgets show a sequence of things: `table`, `list`, `tree` and `log`. They
look different and share one idea, so learn the idea once.

## The pane

A list of rows longer than the space it has needs two numbers: which row is
selected, and which row is at the top. Those two numbers are yours.

```ts
const pane = { selected: 0, offset: 0 };

ui.table({
  rows,
  selected: pane.selected,
  offset: pane.offset,
  followSelection: true,
  onScroll: (delta) => { pane.offset += delta; },
  onSelectRow: (row) => { pane.selected = pane.offset + row; },
  columns: [...],
});
```

The library does not keep them, because the moment it does you have two sources
of truth about where the user is, and they drift the first time you filter the
list. `followSelection` is the one convenience: it scrolls `offset` so the
selected row stays visible, which is what an arrow key should do.

`onScroll` turns the widget into its own scroll region: the wheel acts on
whatever the pointer is over, rather than on one designated list per screen.
Pass it, and a mouse works the way people expect.

## Tables

```ts
ui.table({
  rows: files,
  selected: 1,
  zebra: true,
  columns: [
    { key: "name", title: "Name", min: 12, color: theme.primary },
    { key: "size", title: "Size", width: 9, align: "right" },
    { key: "type", title: "Type", width: 6 },
    { key: "modified", title: "Modified", width: 10, align: "right", color: theme.muted },
  ],
});
```

`width` is fixed, `min` is a floor for a column that otherwise shares the
remainder. Give fixed widths to the columns whose content has a known shape
(sizes, times, percentages) and let the name column absorb the rest. That one
rule produces a table that survives being resized.

Right-align numbers. Always. A column of right-aligned figures can be compared
by eye in a way a ragged one cannot, and it costs one word.

`zebra` tints alternate rows. It helps on wide tables and is noise on narrow
ones.

## Lists

A list is a table with one column and less ceremony.

```ts
ui.list({
  items: [
    { label: "apps/demo", color: theme.primary },
    { label: "packages/hqtui" },
  ],
  selected: 0,
  bullet: "▸",
  scrollbar: true,
});
```

Use it for navigation and for sets of things with no attributes worth a column.
The moment you want a second piece of information per row, you want a table.

## Trees

```ts
ui.tree({
  nodes: [{
    label: "systemd",
    expanded: true,
    values: [{ text: "1.3", width: 6 }],
    children: [
      { label: "bash", values: [{ text: "0.1", width: 6 }] },
      { label: "postgres", values: [{ text: "6.7", width: 6 }] },
    ],
  }],
  selected: 2,
});
```

`expanded` is on the node, so the shape of the tree is your data's business.
`values` are right-hand columns carried per node, which is how a process tree
shows CPU and memory without giving up the indentation that makes it a tree.

Selection counts *visible* rows, not nodes: collapsing a subtree changes what
index 2 means. Store the selection as an index into what is shown, and
recompute it when you collapse something, or store the node id and find it
each frame. The second is more code and never wrong.

## Logs

Logs are the odd one out: they tail.

```ts
ui.log({
  entries: [
    { time: "12:45:02", level: "info", message: "listening on :8080" },
    { time: "12:45:09", level: "warn", message: "slow query 412ms", meta: "{table=users}" },
    { time: "12:45:11", level: "error", message: "upstream timeout" },
  ],
  fromEnd: 0,
  scrollbar: true,
});
```

`fromEnd` counts backwards from the newest line, and `0` means keep tailing.
That is the opposite of `offset` on the other three, and it is deliberate: a
log that is following the tail should stay following it when new lines arrive,
and an offset from the top does the wrong thing every time a line is appended.

Scrolling back sets `fromEnd` to a positive number; scrolling to the bottom
sets it to zero and tailing resumes. Wire it as:

```ts
onScroll: (delta) => { pane.fromEnd = Math.max(0, pane.fromEnd - delta); }
```

`level` is matched case-insensitively against the theme's levels, so `info`,
`INFO` and `Info` all colour the same. `meta` is the trailing dimmed field for
structured context, and it is truncated first when the terminal is narrow,
which is the right thing to lose.
