/** Generate expectations from the real TypeScript screen functions, never from native output. */
import { readFileSync, writeFileSync } from "node:fs";
import { renderToScreen } from "../../../packages/hqtui/src/testing.ts";
import { createState } from "../src/state.ts";
import { dashboardScreen, graphicsScreen, themesScreen, inputScreen, stressScreen, trafficScreen, sessionsScreen, networkScreen, servicesScreen, componentsScreen } from "../src/screens/index.ts";
const screens={dashboard:dashboardScreen,graphics:graphicsScreen,themes:themesScreen,input:inputScreen,stress:stressScreen,traffic:trafficScreen,sessions:sessionsScreen,network:networkScreen,services:servicesScreen,components:componentsScreen};
const root = new URL("../../../", import.meta.url);
const sample = JSON.parse(readFileSync(new URL("ports/rust/demo/src/sample.json", root), "utf8"));
const cases = [];
for (const [screen,draw] of Object.entries(screens)) {
for (const theme of ["dark", "dracula", "nord"]) {
  for (const [width,height] of [[80,30],[120,40],[168,46],[200,60]]) {
    const state=createState(structuredClone(sample),"simulated",[]);
    state.themeIndex=["dark","dracula","nord"].indexOf(theme);
    const frame=renderToScreen(({ui,theme})=>draw(ui,state,theme),{width,height,theme});
    const hashes=[];
    for(let y=0;y<height;y++) {
      let h=2166136261;
      const add=(v:number)=>{h=Math.imul(h^v,16777619)>>>0;};
      for(let x=0;x<width;x++) {
        const c=frame.cell(x,y);
        for(const b of new TextEncoder().encode(c.char)) add(b);
        add(0);
        for(const v of [c.fg,c.bg,c.attrs]) for(let i=0;i<4;i++) add((v>>>(i*8))&255);
      }
      hashes.push(h);
    }
    cases.push({screen,width,height,theme,text:frame.text(),hashes});
  }
}
}
writeFileSync(new URL("ports/conformance/fixtures/demo-parity.json",root),JSON.stringify(cases,null,2)+"\n");
console.log(`Generated ${cases.length} shared TypeScript screen reference cases.`);
