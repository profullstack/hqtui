import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The `c` key is the only way most people will ever see what collapsed borders
 * do, so it has to be bound, advertised in the status bar, and explained in the
 * help. Losing any one of the three makes the feature invisible again.
 */
const main = readFileSync(join(import.meta.dirname, "..", "src", "main.ts"), "utf8");

test("c is bound and toggles the app's collapse setting", () => {
  assert.match(main, /case "c":/);
  assert.match(main, /setCollapseBorders\(!app\.collapseBorders\)/);
});

test("the status bar shows collapse and reflects whether it is on", () => {
  assert.match(main, /key: "c", label: "Collapse", active: app\.collapseBorders/);
});

test("the help screen mentions it", () => {
  assert.match(main, /c collapses adjacent panel borders/);
});
