import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToText } from "@profullstack/hqtui/testing";
import { createCollector } from "../src/system/index.ts";
import { createState, type DemoState } from "../src/state.ts";
import * as screens from "../src/screens/index.ts";

/**
 * The `c` key is the only way most people will ever see what collapsed borders
 * do, so it has to be bound, advertised in the status bar, and explained in the
 * help. Losing any one of the three makes the feature invisible again.
 */
const main = readFileSync(join(import.meta.dirname, "..", "src", "main.ts"), "utf8");

test("c is bound and toggles the app's collapse setting", () => {
  assert.match(main, /case "c":/);
  assert.match(main, /app\.setCollapseBorders\(state\.collapsed\)/);
});

test("the status bar shows collapse and reflects whether it is on", () => {
  assert.match(main, /key: "c", label: "Collapse", active: app\.collapseBorders/);
});

test("the help screen mentions it", () => {
  assert.match(main, /c collapses adjacent panel borders/);
});

/**
 * The three tests above only read the source, which is how the key spent its
 * whole life bound to a flag that changed nothing: the library merges a seam
 * only where two bordered siblings already touch, and every screen laid its
 * panels out a column apart. These render both ways and compare the pixels.
 */
const collector = await createCollector({ real: false, seed: 20260830 });
for (let i = 0; i < 30; i++) await collector.refresh(0.1);

function frame(
  screen: (ui: never, state: DemoState, theme: never) => void,
  state: DemoState,
  width: number,
): string {
  return renderToText(
    ({ ui, theme, height }) => {
      ui.column({ size: height }, (body) => screen(body as never, state, theme as never));
    },
    { width, height: 46, collapseBorders: state.collapsed },
  );
}

const SCREENS = {
  dashboard: screens.dashboardScreen,
  traffic: screens.trafficScreen,
  sessions: screens.sessionsScreen,
  network: screens.networkScreen,
  services: screens.servicesScreen,
  components: screens.componentsScreen,
  graphics: screens.graphicsScreen,
  input: screens.inputScreen,
  stress: screens.stressScreen,
} as const;

// 180 and 90 straddle the dashboard's responsive breakpoints, so both its wide
// and its compact layout are covered.
for (const [name, screen] of Object.entries(SCREENS)) {
  for (const width of [180, 120, 90]) {
    test(`${name} at ${width} columns looks different once collapsed`, () => {
      const state = createState(collector.current(), collector.source, collector.unavailable);
      const open = frame(screen as never, state, width);
      state.collapsed = true;
      const merged = frame(screen as never, state, width);
      assert.notEqual(merged, open, "pressing c changed nothing on this screen");
      // A merged seam is a junction glyph, not just panels shifted over.
      assert.match(merged, /[┬┴├┤┼]/);
    });
  }
}

test("collapsing is off until the key is pressed", () => {
  const state = createState(collector.current(), collector.source, collector.unavailable);
  assert.equal(state.collapsed, false);
  assert.doesNotMatch(frame(screens.dashboardScreen as never, state, 180), /[┬┴┼]/);
});
