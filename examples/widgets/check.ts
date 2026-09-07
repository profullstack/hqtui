/**
 * Renders every widget in gallery.ts headlessly and fails if one draws nothing.
 * A widget example that produces a blank screen is a broken example, and that
 * is exactly what a stale API rename looks like.
 */
import { renderToScreen } from "@profullstack/hqtui";
import type { Container, Theme } from "@profullstack/hqtui";
import * as gallery from "./gallery.ts";

type Example = (ui: Container, theme: Theme) => void;

const entries = Object.entries(gallery).filter(
  (entry): entry is [string, Example] => typeof entry[1] === "function",
);

let failed = 0;
for (const [id, fn] of entries) {
  const screen = renderToScreen(({ ui, theme }) => fn(ui, theme), { width: 64, height: 12 });
  const text = screen.text().trim();
  if (text.length === 0) {
    console.error(`FAIL ${id}: rendered an empty screen`);
    failed++;
    continue;
  }
  console.log(`ok   ${id}  (${text.split("\n").length} rows)`);
}

console.log(`\n${entries.length - failed}/${entries.length} widget examples rendered`);
if (failed > 0) process.exit(1);
