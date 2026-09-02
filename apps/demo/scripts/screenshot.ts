import { renderToText, renderToAnsi, themes } from "@profullstack/hqtui";
import type { Container, Theme } from "@profullstack/hqtui";
import { createCollector } from "../src/system/index.ts";
import { createState, type DemoState } from "../src/state.ts";
import * as screens from "../src/screens/index.ts";

const collector = await createCollector({ real: false, seed: 1337 });
await collector.refresh(0.1);
const state = createState(collector.current(), "simulated", []);
const screen = process.argv[2] ?? "dashboard";
const w = Number(process.argv[3] ?? 160);
const h = Number(process.argv[4] ?? 48);
const byName: Record<string, (ui: Container, state: DemoState, theme: Theme) => void> = {
  dashboard: screens.dashboardScreen,
  components: screens.componentsScreen,
  graphics: screens.graphicsScreen,
  themes: screens.themesScreen,
  input: screens.inputScreen,
  stress: screens.stressScreen,
};
const fn = byName[screen];
if (!fn) {
  console.error(`unknown screen "${screen}"; try one of: ${Object.keys(byName).join(", ")}`);
  process.exit(1);
}

const view = ({ ui, theme }: { ui: Container; theme: Theme }) => fn(ui, state, theme);
if (process.env.ANSI) process.stdout.write(renderToAnsi(view, { width: w, height: h }) + "\x1b[0m\n");
else console.log(renderToText(view, { width: w, height: h }));
