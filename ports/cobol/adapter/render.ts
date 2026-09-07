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
 *           10-29   key      a label, a level, an alignment
 *           30-73   text     content; "|" separates repeated fields
 *           74-80   num      a number as text, so no locale can eat it
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
  let selected = 0;

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
      default:
        throw new Error(`unknown verb ${JSON.stringify(record.verb)} in scene ${scene.id}`);
    }
  }

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
