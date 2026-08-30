import { renderToText } from "@profullstack/hqtui";
import { createCollector } from "../src/system/index.ts";
import { createState, cursor } from "../src/state.ts";
import * as screens from "../src/screens/index.ts";

const c = await createCollector({ real: false, seed: 7 });
for (let i = 0; i < 20; i++) await c.refresh(0.1);
const state = createState(c.current(), "sim", []);
state.screen = "sessions";
const total = state.sample.telemetry.logins.length;
console.log("logins:", total);

function firstRow(): string {
  const text = renderToText(({ ui, theme }: any) => screens.sessionsScreen(ui, state, theme), { width: 130, height: 26 });
  const line = text.split("\n").find((l) => /\b(anthony|deploy|ci|root|postgres)\b/.test(l) && /Aug|still|ok/.test(l));
  return (line ?? "(none)").trim().slice(0, 60);
}

console.log("selected=0  ->", firstRow());
cursor(state).selected = total - 1;      // as `end` would
console.log("selected=last ->", firstRow());
// Replicate the mouse handler: scrolling moves the window and takes the
// selection with it, otherwise followSelection snaps the view straight back.
function scroll(delta: number): void {
  const c = cursor(state);
  c.offset = Math.max(0, Math.min(c.offset + delta * 3, Math.max(0, total - 1)));
  c.selected = Math.max(c.offset, Math.min(c.selected, c.offset + 20));
}
cursor(state).selected = 0;
cursor(state).offset = 0;
scroll(1);
console.log("scroll down ->", firstRow());
scroll(1);
console.log("scroll more ->", firstRow());
scroll(-1);
console.log("scroll up   ->", firstRow());
