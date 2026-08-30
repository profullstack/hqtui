import { renderToText, renderToAnsi, themes } from "@profullstack/hqtui";
import { createCollector } from "../src/system/index.ts";
import { createState } from "../src/state.ts";
import * as screens from "../src/screens/index.ts";

const collector = await createCollector({ real: false, seed: 1337 });
await collector.refresh(0.1);
const state = createState(collector.current(), "simulated", []);
const screen = (process.argv[2] ?? "dashboard") as any;
const w = Number(process.argv[3] ?? 160);
const h = Number(process.argv[4] ?? 48);
const fn: any = {
  dashboard: screens.dashboardScreen,
  components: screens.componentsScreen,
  graphics: screens.graphicsScreen,
  themes: screens.themesScreen,
  input: screens.inputScreen,
  stress: screens.stressScreen,
}[screen];

const view = ({ ui, theme }: any) => fn(ui, state, theme);
if (process.env.ANSI) process.stdout.write(renderToAnsi(view, { width: w, height: h }) + "\x1b[0m\n");
else console.log(renderToText(view, { width: w, height: h }));
