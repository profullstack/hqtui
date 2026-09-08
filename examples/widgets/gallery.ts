/**
 * Every widget HQTUI ships, one function each, in the language the library was
 * written in.
 *
 * This file is not a snippet dump. It compiles, it is type-checked by CI, and
 * every function here is rendered headlessly to produce the pictures on
 * hqtui.com/widgets. The `@widget` / `@end` markers are what the site slices to
 * show the code for a single widget, so a snippet on the site is always a
 * region of a program that builds.
 *
 * Keep each function self-contained: no shared state, no imports beyond these,
 * and no argument that a reader would have to go and find.
 */
import type { Container, Theme } from "@profullstack/hqtui";

const CPU_HISTORY = [12, 18, 26, 22, 31, 44, 38, 52, 61, 48, 39, 44, 57, 66, 72, 64, 51, 43, 37, 41];
const NET_HISTORY = [4, 9, 6, 14, 22, 18, 31, 27, 19, 12, 8, 15, 24, 33, 29, 21];

// ------------------------------------------------------------------- text

// @widget text
export function text(ui: Container, theme: Theme): void {
  ui.text("Plain text. It fills the width it is given.");
  ui.text("Bold, in the theme's primary color.", { bold: true, fg: theme.primary });
  ui.text("Right aligned.", { align: "right" });
  ui.text("Long copy wraps when you ask it to, instead of being cut at the edge.", { wrap: true });
}
// @end

// @widget label
export function label(ui: Container, theme: Theme): void {
  // `label` is `text` in the theme's muted color: secondary copy, captions,
  // the line under a number that says what the number is.
  ui.label("cpu · 8 cores · 3.4 GHz");
  ui.text("42.1%", { bold: true, fg: theme.success });
  ui.label("15 minute average");
}
// @end

// @widget heading
export function heading(ui: Container, theme: Theme): void {
  // `heading` is `text` in the theme's title color, bold.
  ui.heading("Storage");
  ui.label("Four volumes, one degraded");
  ui.spacer(1);
  ui.heading("Network", { fg: theme.accent });
}
// @end

// @widget badge
export function badge(ui: Container, theme: Theme): void {
  ui.row({ size: 1, gap: 1 }, (r) => {
    r.badge({ text: "active", color: theme.success, size: 10 });
    r.badge({ text: "idle", color: theme.warning, variant: "subtle", size: 8 });
    r.badge({ text: "failed", color: theme.danger, variant: "outline", size: 10 });
    r.spacer("fill");
  });
}
// @end

// @widget divider
export function divider(ui: Container, theme: Theme): void {
  ui.text("Above the line");
  ui.divider();
  ui.text("Below it");
  ui.divider({ label: "status", align: "center", color: theme.accent });
  ui.text("A labelled divider titles a section without spending a panel on it");
}
// @end

// @widget keyValues
export function keyValues(ui: Container, theme: Theme): void {
  // The backbone of every "System" panel: labels left, values right.
  ui.keyValues([
    { label: "Host", value: "web-01.iad" },
    { label: "Uptime", value: "18d 04:12" },
    { label: "Load", value: "0.42  0.51  0.60", color: theme.warning },
    { label: "Established", value: "1,284", color: theme.success },
  ]);
}
// @end

// @widget statusBar
export function statusBar(ui: Container, _theme: Theme): void {
  // Usually the last thing drawn, pinned to the bottom row.
  ui.statusBar({
    items: [
      { key: "F1", label: "Help" },
      { key: "F2", label: "Theme" },
      { key: "F3", label: "Filter", active: true },
      { key: "^K", label: "Palette" },
      { key: "q", label: "Quit" },
    ],
    right: [{ label: "0.41ms  184 cells" }],
  });
}
// @end

// ------------------------------------------------------------------- data

// @widget table
export function table(ui: Container, theme: Theme): void {
  ui.table({
    rows: [
      { name: "src", size: "4.2 KB", type: "dir", modified: "2m ago" },
      { name: "test", size: "1.1 KB", type: "dir", modified: "5m ago" },
      { name: "package.json", size: "1.2 KB", type: "file", modified: "10m ago" },
      { name: "README.md", size: "3.4 KB", type: "file", modified: "1h ago" },
    ],
    selected: 1,
    zebra: true,
    columns: [
      { key: "name", title: "Name", min: 12, color: theme.primary },
      { key: "size", title: "Size", width: 9, align: "right" },
      { key: "type", title: "Type", width: 6 },
      { key: "modified", title: "Modified", width: 10, align: "right", color: theme.muted },
    ],
  });
}
// @end

// @widget list
export function list(ui: Container, theme: Theme): void {
  ui.list({
    items: [
      { label: "apps/demo", color: theme.primary },
      { label: "packages/hqtui" },
      { label: "apps/web" },
      { label: "docs" },
    ],
    selected: 0,
    bullet: "▸",
    scrollbar: true,
  });
}
// @end

// @widget tree
export function tree(ui: Container, _theme: Theme): void {
  ui.tree({
    nodes: [
      {
        label: "systemd",
        expanded: true,
        values: [{ text: "1.3", width: 6 }],
        children: [
          { label: "bash", values: [{ text: "0.1", width: 6 }] },
          {
            label: "bun",
            expanded: true,
            values: [{ text: "32.8", width: 6 }],
            children: [{ label: "bun:worker", values: [{ text: "12.4", width: 6 }] }],
          },
          { label: "postgres", values: [{ text: "6.7", width: 6 }] },
        ],
      },
    ],
    selected: 2,
  });
}
// @end

// @widget log
export function log(ui: Container, _theme: Theme): void {
  ui.log({
    entries: [
      { time: "12:45:02", level: "info", message: "listening on :8080" },
      { time: "12:45:09", level: "warn", message: "slow query 412ms", meta: "{table=users}" },
      { time: "12:45:11", level: "error", message: "upstream timeout" },
      { time: "12:45:14", level: "info", message: "retry succeeded" },
    ],
    // Lines scrolled back from the newest. 0 keeps it tailing.
    fromEnd: 0,
    scrollbar: true,
  });
}
// @end

// @widget scrollbar
export function scrollbar(ui: Container, theme: Theme): void {
  // The bar is over state you own, so it works beside anything that scrolls:
  // wrapped prose, a canvas, a draw() of your own.
  ui.row({ gap: 1 }, (r) => {
    r.text(
      "A scrollbar you drive yourself. It has no idea what is beside it, only " +
        "how much there is, how much fits, and where you are.",
      { wrap: true, fg: theme.foreground },
    );
    r.scrollbar({ total: 40, viewport: 5, offset: 12, size: 1 });
  });
}
// @end

// @widget chart
export function chart(ui: Container, theme: Theme): void {
  // Points carry their own x, so a sparse series and a dense one line up.
  ui.chart({
    series: [
      { points: [[0, 1], [2, 6], [5, 3], [8, 9], [10, 4]], label: "load" },
      { points: [[0, 8], [10, 2]], label: "limit", color: theme.muted },
    ],
    axis: true,
    legend: true,
    x: { min: 0, max: 10, ticks: 3, format: (v) => `${v}s` },
    y: { min: 0, max: 10 },
  });
}
// @end

// ----------------------------------------------------------------- meters

// @widget meter
export function meter(ui: Container, theme: Theme): void {
  ui.meter({ label: "CPU", value: 0.62, style: "smooth", color: theme.primary });
  ui.meter({ label: "MEM", value: 0.31, style: "segmented" });
  ui.meter({ label: "SWP", value: 0.87, style: "smooth" });
}
// @end

// @widget meters
export function meters(ui: Container, _theme: Theme): void {
  // One call for a whole bank. `columns` lays them out side by side.
  ui.meters(
    [0.12, 0.44, 0.71, 0.09, 0.38, 0.55, 0.22, 0.66].map((value, i) => ({ label: `P${i}`, value })),
    { columns: 2, labelWidth: 4, valueWidth: 5, style: "segmented" },
  );
}
// @end

// @widget progress
export function progress(ui: Container, _theme: Theme): void {
  ui.progress({ label: "Indexing", value: 37, max: 120, showCount: true });
  ui.progress({ label: "Upload", value: 0.82 });
}
// @end

// @widget graph
export function graph(ui: Container, theme: Theme): void {
  // Braille line chart. `fill` shades the area under the curve.
  ui.graph({ values: CPU_HISTORY, min: 0, max: 100, fill: true, color: theme.success, size: "1fr" });
}
// @end

// @widget sparkline
export function sparkline(ui: Container, theme: Theme): void {
  ui.sparkline({ label: "CPU ", values: CPU_HISTORY, text: "44%", color: theme.success });
  ui.sparkline({ label: "Mem ", values: NET_HISTORY, text: "31%", color: theme.warning });
  ui.sparkline({ label: "Net ", values: CPU_HISTORY, text: "2.4 MB/s", color: theme.primary });
}
// @end

// @widget histogram
export function histogram(ui: Container, theme: Theme): void {
  // Block columns. Cheaper than Braille and easier to read when short.
  ui.histogram({ values: CPU_HISTORY, color: theme.accent, size: "1fr" });
}
// @end

// @widget heatBar
export function heatBar(ui: Container, _theme: Theme): void {
  // Segmented bar colored along the theme's heat ramp, like btop's temperatures.
  ui.heatBar({ value: 0.28 });
  ui.heatBar({ value: 0.64 });
  ui.heatBar({ value: 0.91 });
}
// @end

// @widget gauge
export function gauge(ui: Container, _theme: Theme): void {
  // A semicircular dial. Wants at least 9x5.
  ui.gauge({ value: 62, label: "62%" });
}
// @end

// @widget donut
export function donut(ui: Container, theme: Theme): void {
  ui.donut({
    segments: [
      { value: 4.65, color: theme.primary, label: "Used" },
      { value: 10.96, color: theme.warning, label: "Free" },
    ],
  });
}
// @end

// ----------------------------------------------------------------- inputs

// @widget button
export function button(ui: Container, _theme: Theme): void {
  // Pass `onPress` and the button joins the Tab order automatically.
  ui.row({ size: 1, gap: 1 }, (r) => {
    r.button({ label: "Primary", width: 11, size: 11, onPress: () => {} });
    r.button({ label: "Success", width: 11, size: 11, variant: "success" });
    r.button({ label: "Danger", width: 10, size: 10, variant: "danger" });
    r.spacer("fill");
  });
}
// @end

// @widget checkbox
export function checkbox(ui: Container, _theme: Theme): void {
  ui.row({ size: 1, gap: 2 }, (r) => {
    r.checkbox({ label: "Toggle", checked: true, variant: "toggle", size: 12 });
    r.checkbox({ label: "Checkbox", checked: false, size: 14 });
    r.spacer("fill");
  });
}
// @end

// @widget select
export function select(ui: Container, _theme: Theme): void {
  ui.select({
    value: "Dracula",
    width: 20,
    size: 20,
    open: true,
    options: ["Dark", "Dracula", "Nord", "Tokyo Night"],
    selectedIndex: 1,
  });
}
// @end

// @widget textInput
export function textInput(ui: Container, _theme: Theme): void {
  ui.textInput({ label: "Search", value: "postgres", size: 1 });
  ui.spacer(1);
  ui.textInput({ label: "Filter", value: "", placeholder: "type to filter…", size: 1 });
}
// @end

// @widget tabs
export function tabs(ui: Container, _theme: Theme): void {
  ui.tabs({
    tabs: ["1 dashboard", "2 traffic", "3 sessions", "4 network"],
    active: 1,
  });
}
// @end

// ---------------------------------------------------------------- overlays

// @widget modal
export function modal(ui: Container, _theme: Theme): void {
  // Overlays draw over everything already on the screen, centered.
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
}
// @end

// @widget commandPalette
export function commandPalette(ui: Container, _theme: Theme): void {
  ui.commandPalette({
    query: "the",
    items: [
      { label: "Toggle theme", hint: "F2" },
      { label: "Filter processes", hint: "F3" },
      { label: "Sort by memory", hint: "F6" },
    ],
    selected: 0,
  });
}
// @end

// @widget tooltip
export function tooltip(ui: Container, _theme: Theme): void {
  ui.text("Tooltips are overlays positioned at a cell, for hover and hints.");
  ui.tooltip({ text: "swap is 87% full", x: 6, y: 3 });
}
// @end
