---
title: Themes and colour
order: 8
summary: The palette, heat ramps, series colours, and what happens on a terminal that has eight of them.
---

## Use the theme, not a hex code

Every draw call takes an optional colour, and every one of them defaults to
something from the theme. Reaching past the theme is how a UI ends up
unreadable for the person who runs a light terminal.

The palette is small on purpose:

- `background`, `surface`, `foreground`, `muted`, `border`
- `primary`, `accent`
- `success`, `warning`, `danger`
- `title`, `borderFocused`
- `heat`, a ramp
- a series palette, for charts

```ts
ui.text("42.1%", { fg: theme.success });
ui.badge({ text: "failed", color: theme.danger, variant: "outline" });
```

If you find yourself wanting a colour that is not in the list, the usual answer
is that one of `primary`, `accent` or a series colour is the one you meant.

## The heat ramp

`theme.heat` is a gradient, green through amber to red. Meters and heat bars
use it by default, and you can sample it directly:

```ts
import { heatColor } from "@profullstack/hqtui";

ui.text(`${percent(load)}`, { fg: heatColor(theme, load) });
```

This is the right default for utilisation, and the wrong default whenever high
is good. A cache hit rate of 98% drawn on the heat ramp is a bright red number
that means everything is fine. Pass an explicit colour there.

## Series colours

For charts with several lines, take colours from the series palette rather than
picking them:

```ts
import { seriesColor } from "@profullstack/hqtui";

ui.graph({
  series: metrics.map((m, i) => ({ values: m.values, label: m.name, color: seriesColor(theme, i) })),
  legend: true,
});
```

They are chosen to stay distinguishable from each other and from the
background, in every bundled theme, which is harder than it sounds and not
worth redoing per project.

## Switching themes

```ts
const THEMES = ["dark", "dracula", "nord", "tokyo-night", "light"];
app.on("key", (key) => {
  if (key.name === "f2") app.setTheme(THEMES[++i % THEMES.length]);
});
```

The next frame is drawn in the new theme. There is nothing to invalidate,
because the view is a function and it is about to be called again anyway.

Test in the light theme at least once. It is where hard-coded colours show up,
and where a `muted` you replaced with a grey becomes invisible.

## Degradation

Not every terminal has sixteen million colours, and the library does not
pretend otherwise. Capabilities are detected once and every colour is mapped
down as needed: truecolour to 256, 256 to 16, and to nothing at all when the
terminal is not a terminal.

This is why you should not compare colours for equality or reason about the
exact bytes emitted. Write the colour you mean and let the encoder decide what
the terminal can hear.

The same applies to glyphs. Braille charts fall back to block characters and
then to ASCII; box-drawing borders fall back to `+`, `-` and `|`. You can force
any of it for testing:

```ts
renderToText(view, { width: 80, height: 24, capabilities: { unicode: false, colors: "16" } });
```

That is worth a snapshot test if you ship to environments you do not control,
because "it looked fine on my terminal" is the whole class of bug this
degradation exists to prevent.

## One warning about backgrounds

A background colour on a widget fills its whole region, including the cells the
content does not reach. That is what you want for a selected row and what you
do not want for a label, where it draws a coloured rectangle to the edge of the
panel. If a background looks too wide, the widget's region is wider than its
text, and the fix is a size rather than a colour.
