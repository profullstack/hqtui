import { renderToText } from "@profullstack/hqtui";
import { createCollector } from "../src/system/index.ts";
import { createState } from "../src/state.ts";
import * as screens from "../src/screens/index.ts";

const c = await createCollector({ real: process.argv[5] !== "sim" });
for (let i = 0; i < 3; i++) { await c.refresh(1); await new Promise(r => setTimeout(r, 500)); }
const state = createState(c.current(), c.source, c.unavailable);
const name = (process.argv[2] ?? "traffic") as string;
const fn: any = {
  dashboard: screens.dashboardScreen, traffic: screens.trafficScreen,
  sessions: screens.sessionsScreen, network: screens.networkScreen,
  services: screens.servicesScreen, components: screens.componentsScreen,
}[name];
console.log(renderToText(({ ui, theme }: any) => fn(ui, state, theme), {
  width: Number(process.argv[3] ?? 150), height: Number(process.argv[4] ?? 44),
}));
