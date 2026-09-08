/**
 * The COBOL bridge: fixed-width records in, a rendered terminal UI out.
 *
 *   cobc -x -free ../examples/widgets.cbl -o widgets
 *   ./widgets | bun render.ts
 *
 * COBOL never links against HQTUI. It writes 80-column records, which is the
 * one thing every COBOL that has ever existed can do, and this reads them and
 * calls the library. The record layout is the interface:
 *
 *   columns  1-9    verb     the instruction
 *           10-29   key      a label, a level, an alignment, ON/ACTIVE
 *           30-73   text     content; "|" separates repeated fields
 *           74-80   num      a number as text, so no locale can eat it
 *
 * Repeated records accumulate: ITEM builds a list, NODE and CHILD a shallow
 * tree, SEGMENT a donut, SPARKPT a sparkline, HISTBAR a histogram, MITEM a
 * bank of meters, OPTION a dropdown, PITEM a command palette, MTEXT and
 * MBUTTON a modal, TAB a tab bar, STATUS a status bar. The widget is drawn
 * once the scene ends, which is what lets a flat record stream describe
 * something with parts.
 *
 * ports/cobol/adapter/render.rs reads exactly the same records and calls the
 * Rust port instead, because a record layout is not an API and belongs to
 * nobody.
 */
import { renderToScreen } from "@profullstack/hqtui";
import type { Align, Container, Theme } from "@profullstack/hqtui";

interface Record_ {
  verb: string;
  key: string;
  text: string;
  num: string;
}

/** One widget: the id COBOL declared, and every record that followed it. */
interface Scene {
  id: string;
  records: Record_[];
}

export function parseRecord(line: string): Record_ {
  const padded = line.padEnd(80, " ");
  return {
    verb: padded.slice(0, 9).trim(),
    key: padded.slice(9, 29).trim(),
    text: padded.slice(29, 73).trim(),
    num: padded.slice(73, 80).trim(),
  };
}

/** Splits the record stream into scenes at each WIDGET record. */
export function parseScenes(input: string): Scene[] {
  const scenes: Scene[] = [];
  for (const line of input.split("\n")) {
    if (line.trim().length === 0) continue;
    const record = parseRecord(line);
    if (record.verb === "WIDGET") {
      scenes.push({ id: record.key, records: [] });
      continue;
    }
    scenes[scenes.length - 1]?.records.push(record);
  }
  return scenes;
}

const ALIGN: Record<string, Align> = { LEFT: "left", CENTER: "center", RIGHT: "right" };

type ButtonVariant = "primary" | "success" | "warning" | "danger" | "ghost";
const VARIANT: Record<string, ButtonVariant> = {
  PRIMARY: "primary",
  SUCCESS: "success",
  WARNING: "warning",
  DANGER: "danger",
  GHOST: "ghost",
};

/**
 * Turns one scene's records into calls. Anything the layout cannot express is
 * simply not here: this is a bridge, not a second API.
 */
export function draw(scene: Scene, ui: Container, theme: Theme): void {
  const rows: string[][] = [];
  const columns: { key: string; title: string; align: Align }[] = [];
  const keys: { label: string; value: string }[] = [];
  const entries: { time: string; level: string; message: string; meta?: string }[] = [];
  const points: number[] = [];
  const listItems: { label: string }[] = [];
  const treeNodes: { label: string; children: { label: string }[] }[] = [];
  const tabLabels: string[] = [];
  const statusItems: { key?: string; label: string }[] = [];
  const segments: { value: number; label?: string }[] = [];
  const bars: number[] = [];
  const histogramBars: number[] = [];
  const meterItems: { label: string; value: number }[] = [];
  const options: string[] = [];
  const paletteItems: { label: string; hint?: string }[] = [];
  const modalButtons: { label: string; variant?: ButtonVariant; focused?: boolean }[] = [];
  const modalLines: string[] = [];
  let meterColumns = 1;
  let dropdown: { value: string; open: boolean; width: number } | undefined;
  let modal: { title: string; width: number } | undefined;
  let palette: { query: string; selected: number } | undefined;
  let tooltip: { text: string; x: number; y: number } | undefined;
  let selected = 0;
  let activeTab = 0;

  for (const record of scene.records) {
    switch (record.verb) {
      case "TEXT":
        ui.text(record.text, { align: ALIGN[record.key] ?? "left" });
        break;
      case "LABEL":
        ui.label(record.text);
        break;
      case "HEADING":
        ui.heading(record.text);
        break;
      case "DIVIDER":
        ui.divider(record.text ? { label: record.text } : {});
        break;
      case "KEYVALUE":
        keys.push({ label: record.key, value: record.text });
        break;
      case "COLUMN":
        columns.push({
          key: `c${columns.length}`,
          title: record.text,
          align: ALIGN[record.key] ?? "left",
        });
        break;
      case "ROW":
        rows.push(record.text.split("|"));
        break;
      case "SELECT":
        selected = Number(record.num) || 0;
        break;
      case "LOG": {
        const [time = "", message = "", meta = ""] = record.text.split("|");
        entries.push({ time, level: record.key.toLowerCase(), message, meta: meta || undefined });
        break;
      }
      case "METER":
        ui.meter({ label: record.key, value: Number(record.num) || 0 });
        break;
      case "GRAPHPT":
        points.push(Number(record.num) || 0);
        break;
      case "GAUGE":
        ui.gauge({ value: Number(record.num) || 0, label: record.text });
        break;
      case "BADGE":
        ui.badge({ text: record.text, size: record.text.length + 4 });
        break;
      case "PROGRESS":
        ui.progress({
          label: record.key,
          value: Number(record.num) || 0,
          max: record.text ? Number(record.text) : undefined,
          showCount: Boolean(record.text),
        });
        break;
      case "SPARKPT":
        // One sample per record, like GRAPHPT. A batch job emits these in the
        // order it computed them.
        bars.push(Number(record.num) || 0);
        break;
      case "HEATBAR":
        ui.heatBar({ value: Number(record.num) || 0 });
        break;
      case "SEGMENT":
        segments.push({ value: Number(record.num) || 0, label: record.text || undefined });
        break;
      case "ITEM":
        listItems.push({ label: record.text });
        break;
      case "NODE":
        treeNodes.push({ label: record.text, children: [] });
        break;
      case "CHILD": {
        // Belongs to the node most recently declared, which is how a
        // record stream describes a shallow hierarchy without nesting.
        const parent = treeNodes[treeNodes.length - 1];
        if (!parent) throw new Error(`CHILD before any NODE in scene ${scene.id}`);
        parent.children.push({ label: record.text });
        break;
      }
      case "BUTTON":
        ui.button({ label: record.text, size: record.text.length + 2 });
        break;
      case "CHECKBOX":
        ui.checkbox({ label: record.text, checked: record.key === "ON" });
        break;
      case "INPUT":
        ui.textInput({ label: record.key, value: record.text });
        break;
      case "TAB":
        if (record.key === "ACTIVE") activeTab = tabLabels.length;
        tabLabels.push(record.text);
        break;
      case "STATUS":
        statusItems.push({ key: record.key || undefined, label: record.text });
        break;
      case "HISTBAR":
        histogramBars.push(Number(record.num) || 0);
        break;
      case "METERS":
        meterColumns = Number(record.num) || 1;
        break;
      case "MITEM":
        meterItems.push({ label: record.key, value: Number(record.num) || 0 });
        break;
      case "DROPDOWN":
        dropdown = {
          value: record.text,
          open: record.key === "OPEN",
          width: Number(record.num) || 20,
        };
        break;
      case "OPTION":
        options.push(record.text);
        break;
      case "MODAL":
        modal = { title: record.key, width: Number(record.num) || 46 };
        break;
      case "MTEXT":
        // One line per record, so a message is not capped at the 44 columns a
        // single record can carry.
        modalLines.push(record.text);
        break;
      case "MBUTTON":
        modalButtons.push({
          label: record.text,
          variant: VARIANT[record.key] ?? "primary",
          focused: record.num === "1",
        });
        break;
      case "PALETTE":
        palette = { query: record.key, selected: Number(record.num) || 0 };
        break;
      case "PITEM":
        paletteItems.push({ label: record.text, hint: record.key || undefined });
        break;
      case "TOOLTIP": {
        // The anchor is a cell, so it travels as "column|row".
        const [x = "0", y = "0"] = record.key.split("|");
        tooltip = { text: record.text, x: Number(x) || 0, y: Number(y) || 0 };
        break;
      }
      default:
        throw new Error(`unknown verb ${JSON.stringify(record.verb)} in scene ${scene.id}`);
    }
  }

  if (bars.length > 0) ui.sparkline({ values: bars, label: "", text: "" });
  if (histogramBars.length > 0) {
    ui.histogram({ values: histogramBars, color: theme.accent, size: "1fr" });
  }
  if (meterItems.length > 0) {
    ui.meters(meterItems, { columns: meterColumns, labelWidth: 4, valueWidth: 5 });
  }
  if (dropdown) {
    ui.select({
      value: dropdown.value,
      width: dropdown.width,
      size: dropdown.width,
      open: dropdown.open,
      options,
      selectedIndex: selected,
    });
  }
  if (segments.length > 0) ui.donut({ segments });
  if (listItems.length > 0) ui.list({ items: listItems, selected, bullet: "▸" });
  if (treeNodes.length > 0) {
    ui.tree({
      nodes: treeNodes.map((node) => ({ label: node.label, expanded: true, children: node.children })),
      selected,
    });
  }
  if (tabLabels.length > 0) ui.tabs({ tabs: tabLabels, active: activeTab });
  if (statusItems.length > 0) ui.statusBar({ items: statusItems });
  if (keys.length > 0) ui.keyValues(keys);
  if (columns.length > 0) {
    ui.table({
      columns,
      selected,
      zebra: true,
      rows: rows.map((cells) => Object.fromEntries(columns.map((c, i) => [c.key, cells[i] ?? ""]))),
    });
  }
  if (entries.length > 0) ui.log({ entries, fromEnd: 0, scrollbar: true });
  if (points.length > 0) {
    ui.graph({ values: points, min: 0, max: 100, fill: true, color: theme.success, size: "1fr" });
  }
  // Overlays last, because they draw over whatever the scene already put down.
  if (modal) {
    ui.modal({
      title: modal.title,
      width: modal.width,
      message: modalLines.join("\n"),
      buttons: modalButtons,
    });
  }
  if (palette) {
    ui.commandPalette({ query: palette.query, items: paletteItems, selected: palette.selected });
  }
  if (tooltip) ui.tooltip(tooltip);
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const scenes = parseScenes(Buffer.concat(chunks).toString("utf8"));

  if (scenes.length === 0) {
    console.error("no records on stdin: pipe the COBOL program into this");
    process.exit(1);
  }

  let blank = 0;
  for (const scene of scenes) {
    const out = renderToScreen(({ ui, theme }) => draw(scene, ui, theme), { width: 62, height: 12 })
      .text()
      .trimEnd();
    if (out.trim().length === 0) {
      console.error(`FAIL ${scene.id}: rendered an empty screen`);
      blank++;
      continue;
    }
    console.log(`--- ${scene.id}\n${out}`);
  }

  console.error(`${scenes.length - blank}/${scenes.length} widget examples rendered`);
  if (blank > 0) process.exitCode = 1;
}

if (import.meta.main) await main();
