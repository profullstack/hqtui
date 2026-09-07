---
title: Text and status
order: 3
summary: Text, labels, headings, badges, dividers, key/value pairs and the status bar.
---

Most of a dashboard is not charts. It is labels, numbers, and the small
furniture that tells you what you are looking at. Getting that furniture right
is most of what makes a terminal UI feel finished.

## Text, and its two shorthands

```ts
ui.text("Plain text. It fills the width it is given.");
ui.text("Bold, in the theme's primary color.", { bold: true, fg: theme.primary });
ui.text("Right aligned.", { align: "right" });
ui.text("Long copy wraps when you ask it to.", { wrap: true });
```

Without `wrap`, text is truncated at the edge with an ellipsis rather than
spilling. That is deliberate: a wrapped line silently changes a widget's height,
and a dashboard whose panels resize when a hostname gets longer is a dashboard
that jumps around.

Two shorthands exist because they are used constantly:

- `ui.label(...)` is text in the theme's muted colour. Captions, units, the
  line under a number that says what the number is.
- `ui.heading(...)` is bold text in the theme's title colour.

```ts
ui.heading("Storage");
ui.label("Four volumes, one degraded");
```

Reach for these rather than passing colours by hand. When someone switches to
the light theme, muted and title follow; a hard-coded grey does not.

## Badges

A badge is a status chip: short, coloured, and read at a glance.

```ts
ui.row({ size: 1, gap: 1 }, (r) => {
  r.badge({ text: "active", color: theme.success, size: 10 });
  r.badge({ text: "idle", color: theme.warning, variant: "subtle", size: 8 });
  r.badge({ text: "failed", color: theme.danger, variant: "outline", size: 10 });
});
```

Three variants, and they are not interchangeable. `filled` is loud and belongs
to the one thing that matters on the screen. `subtle` tints the background and
sits quietly in a list. `outline` is for a state that is notable but not
current, like a job that failed an hour ago.

If every badge is filled, none of them is.

## Dividers

```ts
ui.divider();
ui.divider({ label: "status", align: "center" });
```

A labelled divider titles a section without spending a panel on it. In a dense
screen that is often the right trade: a panel costs two rows of border and a
gap, a divider costs one row.

## Key and value pairs

This is the backbone of every system panel, and it has one job: put labels on
the left, values on the right, and align them.

```ts
ui.keyValues([
  { label: "Host", value: "web-01.iad" },
  { label: "Uptime", value: "18d 04:12" },
  { label: "Load", value: "0.42  0.51  0.60", color: theme.warning },
  { label: "Established", value: "1,284", color: theme.success },
]);
```

Values are pushed to the right edge by default, which is what makes a column of
numbers readable. Pass `spread: false` and they sit next to their label
instead, which reads better for prose-ish values like a file path.

Colour the value, not the label. The label is furniture; the value is the thing
whose state you are signalling.

## The status bar

Terminal users expect a strip of keybindings along the bottom, and expect it in
a particular shape: key, then what the key does.

```ts
ui.statusBar({
  items: [
    { key: "F1", label: "Help" },
    { key: "F2", label: "Theme" },
    { key: "F3", label: "Filter", active: true },
    { key: "q", label: "Quit" },
  ],
  right: [{ label: "0.41ms  184 cells" }],
});
```

`active` highlights an entry, which is how you show that filter mode is
currently on rather than merely available. The `right` slot is for the things
that are true rather than the things you can do: frame time, a connection
state, a clock.

Draw it last, after the body, with `ui.spacer(1)` above it. It is the one
widget whose position is a convention rather than a preference, and breaking
the convention makes an application feel wrong for reasons people struggle to
name.
