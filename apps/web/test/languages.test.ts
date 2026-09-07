import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LANGUAGES, PORTS, LAUNCHER, latestDemo } from "../lib/languages.ts";

const root = resolve(import.meta.dirname, "../../..");

test("every supported language has latest-source vanilla and mise demo commands", () => {
  assert.deepEqual(LANGUAGES.map(({ id }) => id), ["cpp", "typescript", "rust", "go", "python", "zig"]);
  for (const language of LANGUAGES) {
    assert.ok(language.interactiveDemo.length > 0, language.id);
    assert.ok(language.interactiveDemo.startsWith(`curl -fsSL ${LAUNCHER} | sh -s -- --system ${language.id}`));
    assert.ok(language.miseDemo.startsWith(`curl -fsSL ${LAUNCHER} | sh -s -- --mise ${language.id}`));
    assert.ok(!language.interactiveDemo.includes("screenshot"));
  }
});

test("native updater commands retain full-dashboard source entrypoints", () => {
  const files: Record<string, string[]> = {
    cpp: ["demo/main.cpp", "demo/dashboard.cpp"],
    rust: ["examples/dashboard.rs", "examples/screenshot.rs"],
    go: ["examples/dashboard/main.go", "examples/screenshot/main.go"],
    python: ["examples/dashboard.py", "examples/screenshot.py"],
    zig: ["examples/dashboard.zig", "examples/screenshot.zig"],
  };
  for (const port of PORTS) {
    assert.equal(port.demo, port.interactiveDemo);
    assert.equal(port.snapshotDemo, `${port.demo} --snapshot`);
    for (const file of files[port.id]) assert.ok(existsSync(resolve(root, "ports", port.id, file)), file);
  }
});

test("the homepage also exposes both vanilla and mise commands", () => {
  const page = readFileSync(resolve(root, "apps/web/app/page.tsx"), "utf8");
  assert.ok(page.includes("command={language.demo}"));
  assert.ok(page.includes("command={language.miseDemo}"));
  assert.throws(() => latestDemo("c"), /Unsupported/);
  assert.ok(existsSync(resolve(root, "apps/web/public/demo.sh")));
});

test("docs show demos and mise alternatives at the existing native language anchors", () => {
  const page = readFileSync(resolve(root, "apps/web/app/docs/page.tsx"), "utf8");
  assert.ok(page.includes("id={port.id}"));
  assert.ok(page.includes("command={port.interactiveDemo}"));
  assert.ok(page.includes("command={port.miseDemo}"));
  assert.ok(page.includes("Headless screenshot"));
  assert.ok(page.includes("generated sample data"));
  assert.ok(page.includes('LANGUAGES.find(({ id }) => id === "typescript")'));
  assert.ok(page.includes("command={TYPESCRIPT.interactiveDemo}"));
  assert.ok(page.includes("command={TYPESCRIPT.miseDemo}"));
});
