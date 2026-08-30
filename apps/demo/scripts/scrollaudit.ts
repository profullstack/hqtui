import { renderToText } from "@profullstack/hqtui";
import { createCollector } from "../src/system/index.ts";
import { createState, pane, scrollPane } from "../src/state.ts";
import * as screens from "../src/screens/index.ts";

const c = await createCollector({ real: process.argv.includes("--real"), seed: 7 });
for (let i = 0; i < (process.argv.includes("--real") ? 3 : 40); i++) { await c.refresh(1); if (process.argv.includes("--real")) await new Promise((r) => setTimeout(r, 400)); }
const state = createState(c.current(), "sim", []);

// Deliberately short: every list must overflow, or the test proves nothing.
const SCREENS: [string, any, number][] = [
  ["dashboard", screens.dashboardScreen, 170],
  ["traffic", screens.trafficScreen, 158],
  ["sessions", screens.sessionsScreen, 150],
  ["network", screens.networkScreen, 158],
  ["services", screens.servicesScreen, 158],
  ["components", screens.componentsScreen, 150],
];

function draw(name: string, fn: any, w: number, h: number): string {
  state.screen = name as never;
  return renderToText(({ ui, theme }: any) => fn(ui, state, theme), { width: w, height: h });
}

const HEIGHTS = [46, 30, 22, 16];
const results = new Map<string, string>();

for (const [name, fn, w] of SCREENS) {
  for (const h of HEIGHTS) {
    draw(name, fn, w, h);                       // registers whatever is visible
    const ids = Object.keys(state.panes).filter((id) => id.startsWith(`${name}.`));
    for (const id of ids) {
      if (results.get(id) === "ok") continue;   // already proven at another height
      const p = state.panes[id];
      if (p.total <= 1) { results.set(id, `only ${p.total} row(s)`); continue; }

      p.offset = 0; p.selected = 0;
      const before = draw(name, fn, w, h);
      scrollPane(p, 1);                          // wheel down
      const wheel = draw(name, fn, w, h) !== before;

      p.offset = 0; p.selected = 0;
      const top = draw(name, fn, w, h);
      p.selected = p.total - 1;                  // End
      const keys = draw(name, fn, w, h) !== top;
      p.offset = 0; p.selected = 0;

      if (wheel && keys) results.set(id, "ok");
      else if (!wheel && !keys) results.set(id, results.get(id) ?? "fits at this height");
      else results.set(id, `PARTIAL wheel=${wheel} keys=${keys}`);
    }
  }
}

let failures = 0;
for (const [id, verdict] of [...results].sort()) {
  if (verdict.startsWith("PARTIAL")) failures++;
  console.log(`  ${id.padEnd(24)} ${verdict}`);
}
console.log(failures === 0 ? "\nevery pane scrolls (or has nothing to scroll)" : `\n${failures} broken pane(s)`);
process.exit(failures === 0 ? 0 : 1);
