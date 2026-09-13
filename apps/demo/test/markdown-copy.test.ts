import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen } from "@profullstack/hqtui/testing";
import { createSystemSimulation } from "../src/simulation.ts";
import { createState } from "../src/state.ts";
import { dashboardScreen } from "../src/screens/dashboard.ts";

test("demo summary panes export system facts without process or journal rows", () => {
  const sample = createSystemSimulation({ seed: 1 }).current();
  sample.system.hostname = "test-host";
  sample.processes[0].command = "DO NOT EXPORT PROCESS ROW";
  const state = createState(sample, "simulated", []);
  const screen = renderToScreen(({ ui, theme }) => dashboardScreen(ui, state, theme), {
    width: 180, height: 52, copyMarkdown: true,
    markdownContext: "HQTUI demo · test-host · dashboard\nSource: simulated · live",
  });
  for (const r of screen.regions) screen.click(r.rect.x, r.rect.y);
  const system = screen.copied.find((text) => text.startsWith("## System"));
  assert.ok(system);
  assert.ok(system.includes("**Hostname:** test-host"));
  assert.ok(system.includes("**Source:** simulated"));
  assert.ok(system.includes("HQTUI demo · test-host"));
  assert.ok(screen.copied.some((text) => text.startsWith("## CPU Overview")));
  assert.ok(!screen.copied.join("\n").includes("DO NOT EXPORT PROCESS ROW"));
  assert.ok(!screen.copied.some((text) => /^## (Processes|Journal)/.test(text)));
});
