import { renderToText } from "@profullstack/hqtui";
import { createCollector } from "../src/system/index.ts";
import { createState, pane } from "../src/state.ts";
import * as screens from "../src/screens/index.ts";

const c = await createCollector({ real: true });
for (let i = 0; i < 3; i++) { await c.refresh(1); await new Promise(r => setTimeout(r, 400)); }
const state = createState(c.current(), "real", []);
state.screen = "dashboard";
console.log("journal entries:", state.sample.logs.length);

const draw = () => renderToText(({ ui, theme }: any) => screens.dashboardScreen(ui, state, theme), { width: 170, height: 46 });
draw();
const p = state.panes["dashboard.logs"];
console.log("pane:", JSON.stringify(p));

const a = draw().split("\n");
p.offset = 20;
const b = draw().split("\n");
let diff = 0;
for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff++;
console.log("differing lines:", diff, "of", a.length);
// Show the tail, where the Logs panel lives.
console.log("--- offset=0 tail ---");
console.log(a.slice(-4).map((l) => l.slice(-72)).join("\n"));
console.log("--- offset=20 tail ---");
console.log(b.slice(-4).map((l) => l.slice(-72)).join("\n"));
