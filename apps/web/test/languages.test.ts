import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LANGUAGES, PORTS } from "../lib/languages.ts";

const root = resolve(import.meta.dirname, "../../..");

test("every supported language has interactive and pinned mise demo commands", () => {
  assert.deepEqual(LANGUAGES.map(({ id }) => id), ["typescript", "rust", "go", "python", "zig"]);
  for (const language of LANGUAGES) {
    assert.ok(language.interactiveDemo.length > 0, language.id);
    assert.match(language.miseDemo, /mise exec \w+@\d+\.\d+\.\d+ -- /);
    assert.ok(!language.interactiveDemo.includes("screenshot"));
  }
});

test("native demo commands point to dashboard and screenshot examples in the checkout", () => {
  const files: Record<string, string[]> = {
    rust: ["examples/dashboard.rs", "examples/screenshot.rs"],
    go: ["examples/dashboard/main.go", "examples/screenshot/main.go"],
    python: ["examples/dashboard.py", "examples/screenshot.py"],
    zig: ["examples/dashboard.zig", "examples/screenshot.zig"],
  };
  for (const port of PORTS) {
    assert.ok(port.interactiveDemo.startsWith(`(cd hqtui/ports/${port.id} && `));
    assert.ok(port.interactiveDemo.endsWith(")"), "subshell preserves the user's directory");
    assert.match(port.interactiveDemo, /dashboard/);
    assert.equal(port.demo, port.interactiveDemo);
    assert.match(port.snapshotDemo!, /dashboard.*--snapshot/);
    for (const file of files[port.id]) assert.ok(existsSync(resolve(root, "ports", port.id, file)), file);
  }
});

test("docs show demos and mise alternatives at the existing native language anchors", () => {
  const page = readFileSync(resolve(root, "apps/web/app/docs/page.tsx"), "utf8");
  assert.ok(page.includes("id={port.id}"));
  assert.ok(page.includes("command={port.interactiveDemo}"));
  assert.ok(page.includes("command={port.miseDemo}"));
  assert.ok(page.includes("Headless screenshot"));
  assert.ok(page.includes("generated sample data"));
});
