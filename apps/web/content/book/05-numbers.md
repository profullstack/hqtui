---
title: Numbers that move
order: 5
summary: Meters, progress, graphs, sparklines, histograms, heat bars, gauges and donuts, and how to choose.
---

Nine widgets draw numbers. Choosing between them is mostly about two questions:
is this one value or a series, and how much vertical space do I have?

| you have | you have room | use |
| --- | --- | --- |
| one ratio | one row | `meter` |
| one ratio, known total | one row | `progress` |
| one ratio, want it loud | five rows | `gauge` |
| many ratios | one row each | `meters` |
| a series | one row | `sparkline` |
| a series | several rows | `graph` |
| a series, short and countable | several rows | `histogram` |
| parts of a whole | several rows | `donut` |
| a temperature | one row | `heatBar` |

## One value

```ts
ui.meter({ label: "CPU", value: 0.62, style: "smooth", color: theme.primary });
ui.meter({ label: "MEM", value: 0.31, style: "segmented" });
```

`value` is 0 to 1. Out-of-range values are clamped rather than drawn off the
end, and `NaN` renders as an empty bar rather than throwing, because a metric
that is briefly unavailable should not take the dashboard down with it.

`smooth` uses partial block characters for sub-cell precision. `segmented`
draws discrete ticks, like btop. Segmented reads better when several meters are
stacked, because the ticks line up between rows; smooth reads better alone.

Leave `color` off and the bar is coloured along the theme's heat ramp, green
through amber to red as it fills. That is usually what you want for a
utilisation figure, and exactly what you do not want for something where high
is good. Pass an explicit colour in that case.

```ts
ui.progress({ label: "Indexing", value: 37, max: 120, showCount: true });
```

`progress` is for a job with a known total. With `max` and `showCount` it shows
`37/120` rather than a percentage, which is more useful when the unit means
something.

## Many values

```ts
ui.meters(
  cores.map((value, i) => ({ label: `P${i}`, value })),
  { columns: 2, labelWidth: 4, valueWidth: 5, style: "segmented" },
);
```

One call for a whole bank, laid out in columns. Set `labelWidth` and
`valueWidth` explicitly when the labels vary in length, or the bars start at
different columns and the block stops reading as a unit.

## A series

```ts
ui.sparkline({ label: "CPU ", values: history, text: "44%", color: theme.success });
```

A sparkline is one row: label, inline chart, value. Three or four stacked make
an excellent compact summary, and they cost almost nothing.

```ts
ui.graph({ values: history, min: 0, max: 100, fill: true, color: theme.success, size: "1fr" });
```

A graph is a Braille line chart, so it draws at twice the horizontal and four
times the vertical resolution of the cells it occupies. That is why it looks
smooth in a space where block characters would look like stairs.

Set `min` and `max` when the scale is meaningful. A CPU graph that autoscales
to its own range makes an idle machine look busy: 4% to 6% fills the panel.
Pinning `0` to `100` costs nothing and tells the truth.

Several series overlay:

```ts
ui.graph({
  series: [
    { values: rx, label: "rx" },
    { values: tx, label: "tx" },
  ],
  legend: true,
  axis: true,
});
```

`axis` puts min and max labels down the left edge; `timeAxis` puts labels along
the bottom. Both cost a row or a column, so add them when the numbers matter
and leave them off in a dense grid where the shape is the point.

## When Braille is wrong

Braille needs a font with Braille coverage and a terminal that renders it. Most
do. When it does not, or when the series is short enough to count, block
columns read better:

```ts
ui.histogram({ values: history, color: theme.accent, size: "1fr" });
```

The library also degrades on its own: on a terminal that reports no Unicode
support, graphs fall back to block and then to ASCII rather than emitting
mojibake. You do not have to detect anything.

## Dials

```ts
ui.gauge({ value: 62, label: "62%" });
ui.donut({ segments: [
  { value: 4.65, color: theme.primary, label: "Used" },
  { value: 10.96, color: theme.warning, label: "Free" },
] });
```

A gauge wants at least nine columns by five rows; a donut about twelve by six.
Below that they are drawn but not worth the space, and a meter says the same
thing in one row. Use them where you have room and want one number to dominate,
which on a dashboard is usually not more than once.

## The heat bar

```ts
ui.heatBar({ value: 0.64 });
```

Segments coloured along the heat ramp with no label and no readout. It is the
temperature row in btop, and it is the right widget when the colour *is* the
information and the exact number is not.
