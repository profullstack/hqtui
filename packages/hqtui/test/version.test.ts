import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../src/cli.ts";

/**
 * The published version is written out by hand in three places that no build
 * step touches. It has already gone stale once — 33a277f is "Site: correct the
 * version badge to 0.1.3" — and nothing stopped it happening again.
 *
 * The library cannot read package.json at run time to remove the duplication:
 * SECURITY.md states it reads no files, and that promise is worth more than the
 * duplication. So the copies stay and these tests tie them to the source.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const versionOf = (...parts: string[]): string =>
  JSON.parse(read(...parts, "package.json")).version;

/** Every version-shaped string a pattern finds, not just the first. */
function allMatches(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((m) => m[1]).filter((v): v is string => Boolean(v));
}

test("the CLI prints the library's published version", async () => {
  // Asserting on the VERSION constant alone would miss a `--version` branch
  // that prints something else, so this runs the command.
  const printed: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => void printed.push(args.join(" "));
  try {
    await main(["--version"]);
  } finally {
    console.log = log;
  }
  assert.equal(printed.join("\n").trim(), versionOf("packages", "hqtui"));
});

test("every version string in the CLI source matches package.json", () => {
  // Quotes, backticks and a type annotation are all legitimate ways to write
  // it, and a second stale copy elsewhere in the file must not hide.
  const found = allMatches(
    read("packages", "hqtui", "src", "cli.ts"),
    /VERSION(?::\s*string)?\s*=\s*["'`]([^"'`]+)["'`]/g,
  );
  assert.ok(found.length > 0, "cli.ts no longer declares a VERSION");
  for (const v of found) assert.equal(v, versionOf("packages", "hqtui"), `cli.ts has ${v}`);
});

test("every version the demo prints matches its package.json", () => {
  const found = allMatches(
    read("apps", "demo", "src", "main.ts"),
    /hqtui-demo\s+([0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9.+-]*)/g,
  );
  assert.ok(found.length > 0, "apps/demo/src/main.ts no longer prints a version");
  for (const v of found) assert.equal(v, versionOf("apps", "demo"), `main.ts has ${v}`);
});

test("every version badge on the site matches the library", () => {
  const found = allMatches(
    read("apps", "web", "app", "page.tsx"),
    /\bv([0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9.+-]*)/g,
  );
  assert.ok(found.length > 0, "the site no longer shows a version badge");
  for (const v of found) assert.equal(v, versionOf("packages", "hqtui"), `page.tsx has ${v}`);
});

/**
 * Whether `version` satisfies `range`, for the range forms this repo uses.
 * Returns null for anything else so the caller fails loudly rather than
 * guessing — the previous version of this test skipped the operator entirely
 * and read `~`, `<` and `=` all as a caret.
 */
function satisfies(version: string, range: string): boolean | null {
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed.startsWith("workspace:")) return true;
  const m = /^(\^|~)?([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(trimmed);
  if (!m) return null;
  const [, op, ma, mi, pa] = m;
  const [major, minor, patch] = version.split(".").map(Number);
  const [rMajor, rMinor, rPatch] = [Number(ma), Number(mi), Number(pa)];
  if (major !== rMajor) return false;
  const atLeast = minor > rMinor || (minor === rMinor && patch >= rPatch);
  if (!atLeast) return false;
  if (!op) return minor === rMinor && patch === rPatch;
  // Below 1.0.0 a caret locks the minor, exactly as a tilde does.
  if (op === "~" || rMajor === 0) return minor === rMinor;
  return true;
}

test("the demo's dependency range admits the library in this tree", () => {
  const library = versionOf("packages", "hqtui");
  const range = JSON.parse(read("apps", "demo", "package.json")).dependencies["@profullstack/hqtui"];
  const ok = satisfies(library, range);
  assert.notEqual(ok, null, `unsupported range "${range}" — teach satisfies() about it`);
  assert.equal(ok, true, `apps/demo requires "${range}", which ${library} does not satisfy`);
});

test("the range check knows what a caret means below 1.0.0", () => {
  // ^0.1.9 is >=0.1.9 <0.2.0, not >=0.1.9 <1.0.0.
  assert.equal(satisfies("0.1.9", "^0.1.9"), true);
  assert.equal(satisfies("0.1.10", "^0.1.9"), true);
  assert.equal(satisfies("0.2.0", "^0.1.9"), false);
  assert.equal(satisfies("0.1.8", "^0.1.9"), false);
  assert.equal(satisfies("1.0.0", "^0.1.9"), false);
  assert.equal(satisfies("0.2.0", "~0.1.9"), false);
  assert.equal(satisfies("1.3.0", "^1.2.0"), true);
  assert.equal(satisfies("0.1.9", "0.1.9"), true);
  assert.equal(satisfies("0.1.9", "workspace:*"), true);
  // Anything unrecognised is reported, not assumed.
  assert.equal(satisfies("0.1.9", "<0.1.0"), null);
  assert.equal(satisfies("0.1.9", "=0.1.3"), null);
  assert.equal(satisfies("0.1.9", "^0.1.9 || ^0.2.0"), null);
});
