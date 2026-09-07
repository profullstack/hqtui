---
title: Layout
order: 2
summary: Rows, columns, panels and grids, and the three sizes that explain every surprise.
---

Almost every layout question in a terminal UI is the same question: who gets
the leftover space? Terminals are small, integral and resizable, so a layout
that looks right at 120 columns has to degrade to 80 without you thinking about
it each time.

There are three ways to size a thing, and knowing which one you asked for
explains nearly every surprise.

## Cells, fractions, fill

```ts
ui.column({ gap: 1 }, (col) => {
  col.text("header", { size: 1 });        // exactly one row
  col.panel({ title: "body", size: "1fr" }, () => {});  // a share of the rest
  col.spacer("fill");                      // whatever is still left
});
```

- **A number** is cells. `size: 3` is three rows in a column, three columns in
  a row. Use it for things with a known height: a status bar, a header, a
  single meter.
- **`"1fr"`** is a fraction of what remains after the fixed sizes are taken.
  Two siblings at `1fr` split the remainder evenly; `2fr` and `1fr` split it
  two to one. This is the one you want for the main body of a screen.
- **`"fill"`** takes the leftover. A `spacer("fill")` between two things pushes
  them apart, which is how you right-align the clock in a header row.

Omit `size` and a widget takes its intrinsic height: a four-row table takes
four rows, text takes as many rows as it has lines. That default is usually
right, and it is why most code does not mention sizing at all.

## Rows and columns

`row` lays children left to right, `column` top to bottom. The root container
is a column, so the common case needs no ceremony.

```ts
ui.row({ size: 1 }, (header) => {
  header.text(" hqtui", { bold: true, size: 12 });
  header.tabs({ tabs: ["dashboard", "traffic"], active: 0 });
  header.text("12:45:42 ", { align: "right" });
});
```

`gap` inserts blank cells between children, once, not around the outside. If
you find yourself adding a trailing spacer to fake a gap, you wanted `gap`.

## Panels

A panel is a box with a border, a title, and an interior container.

```ts
ui.panel({ title: "CPU Overview", subtitle: "62%", size: "1fr" }, (p) => {
  p.meter({ label: "all", value: 0.62 });
  p.graph({ values: history, min: 0, max: 100, size: "1fr" });
});
```

The interior is inset by the border, so a panel of height 10 gives its body 8
rows. This is the single most common source of "why is my graph one row too
short". If you need the body to be exactly `n`, ask for `n + 2`.

## Grids

When you want a real matrix rather than nested rows, use a grid.

```ts
ui.grid({ columns: ["1fr", "1fr"], rows: ["1fr", "1fr"], gap: 1 }, (g) => {
  g.panel({ title: "CPU" }, (p) => p.meter({ label: "all", value: cpu }));
  g.panel({ title: "Memory" }, (p) => p.meter({ label: "used", value: mem }));
  g.panel({ title: "Disk" }, (p) => p.meter({ label: "root", value: disk }));
  g.panel({ title: "Net" }, (p) => p.sparkline({ values: net }));
});
```

Cells fill in order. A grid is the right tool when the panels are peers; nested
rows and columns are right when one region genuinely contains another.

## Responding to width

Terminals get narrow. Rather than guessing, ask:

```ts
ui.responsive({
  0: (narrow) => narrow.column({}, (c) => { left(c); right(c); }),
  100: (wide) => wide.row({ gap: 1 }, (r) => { left(r); right(r); }),
});
```

The keys are minimum widths, and the largest one that fits wins. Two
breakpoints is usually enough: stacked, and side by side.

## When layout is not the answer

Sometimes you want to draw exactly where you mean to, and no amount of nesting
expresses it. There is an escape hatch, and using it is not a defeat:

```ts
ui.draw((surface) => {
  surface.text(0, 0, "anywhere", { fg: theme.primary });
  surface.hline(0, 1, surface.width, "─", { fg: theme.border });
});
```

`surface` is the raw region: width, height, and cell-level drawing, clipped to
the area the layout gave you. Every widget in the library is built on exactly
this, so nothing you can reach for is more privileged than what you can write.
