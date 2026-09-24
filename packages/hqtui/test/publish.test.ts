import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkVersions,
  contentDigest,
  digestOfTarball,
  lookupPublished,
  lookupWithRetry,
  missingEntryPoints,
  parseArgs,
  publishAll,
  requiredEntryPoints,
  resolveAction,
  tarFiles,
  unresolvedImports,
  waitForAvailability,
  MANIFEST,
} from "../../../scripts/publish.mjs";

/**
 * The release saga lives in scripts/, not in the library, but it has nowhere
 * else to be tested: these are the only test directories CI runs, and the
 * publish workflow runs this one before it uploads anything. version.test.ts
 * already reaches out of the package for the same reason.
 *
 * Nothing here talks to a registry or to npm. The registry is a function and
 * so is npm, which is what makes the incident from issue #93 — library
 * published, demo not — reproducible as a test rather than as a post-mortem.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");

/* -------------------------------------------------------------------------- */
/* A tar writer, so the reader has something to read                           */
/* -------------------------------------------------------------------------- */

type Entry = { path: string; body: string; type?: string; mtime?: number };

function header(path: string, size: number, type: string, mtime: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(path.slice(0, 100), 0, 100, "utf8");
  h.write("0000644\0", 100, 8, "ascii");
  h.write("0000000\0", 108, 8, "ascii");
  h.write("0000000\0", 116, 8, "ascii");
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  h.write(`${mtime.toString(8).padStart(11, "0")}\0`, 136, 12, "ascii");
  h.write("        ", 148, 8, "ascii");
  h.write(type, 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return h;
}

function tar(entries: Entry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body, "utf8");
    chunks.push(header(entry.path, body.length, entry.type ?? "0", entry.mtime ?? 0));
    chunks.push(body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

/** A pax record is `<total byte length> key=value\n`, and the length counts itself. */
function paxRecord(key: string, value: string): string {
  const rest = ` ${key}=${value}\n`.length;
  let length = rest + 1;
  while (String(length).length + rest !== length) length = String(length).length + rest;
  return `${length} ${key}=${value}\n`;
}

const silently = async <T>(body: () => T | Promise<T>): Promise<T> => {
  const log = console.log;
  console.log = () => {};
  try {
    return await body();
  } finally {
    console.log = log;
  }
};

/* -------------------------------------------------------------------------- */
/* What is allowed to be published                                             */
/* -------------------------------------------------------------------------- */

test("the two packages must agree about the version", () => {
  assert.throws(
    () =>
      checkVersions({
        versions: { "packages/hqtui": "0.6.2", "apps/demo": "0.6.1" },
        event: "release",
        ref: "v0.6.2",
        distTag: "latest",
      }),
    /disagree about the version/,
  );
});

test("a release tag must name the version it publishes", () => {
  const versions = { "packages/hqtui": "0.6.2", "apps/demo": "0.6.2" };
  assert.equal(checkVersions({ versions, event: "release", ref: "v0.6.2" }).version, "0.6.2");
  assert.throws(
    () => checkVersions({ versions, event: "release", ref: "v0.6.3" }),
    /does not name the version/,
  );
  // A dispatch runs from a branch, so there is no tag to disagree with.
  assert.equal(checkVersions({ versions, event: "dispatch", ref: "main" }).version, "0.6.2");
});

test("a release goes out as 'latest', a prerelease as 'next'", () => {
  const release = { "packages/hqtui": "0.6.2", "apps/demo": "0.6.2" };
  const rc = { "packages/hqtui": "0.7.0-rc.1", "apps/demo": "0.7.0-rc.1" };

  assert.equal(checkVersions({ versions: release, event: "release", ref: "v0.6.2" }).distTag, "latest");
  assert.equal(checkVersions({ versions: rc, event: "release", ref: "v0.7.0-rc.1" }).distTag, "next");

  // Asking for it by hand is the only way to point `npm install` at an rc.
  assert.throws(
    () => checkVersions({ versions: rc, event: "release", ref: "v0.7.0-rc.1", distTag: "latest" }),
    /prerelease/,
  );
  assert.equal(
    checkVersions({ versions: release, event: "release", ref: "v0.6.2", distTag: "next" }).distTag,
    "next",
  );
});

/* -------------------------------------------------------------------------- */
/* Reading a tarball                                                           */
/* -------------------------------------------------------------------------- */

test("the tar reader returns regular files with their contents", () => {
  const files = tarFiles(
    tar([
      { path: "package/", body: "", type: "5" },
      { path: "package/package.json", body: '{"name":"x"}' },
      { path: "package/dist/index.js", body: "export const a = 1;\n" },
    ]),
  );
  assert.deepEqual(
    files.map((f) => f.path),
    ["package/package.json", "package/dist/index.js"],
  );
  assert.equal(files[1]?.data.toString("utf8"), "export const a = 1;\n");
});

test("a pax header renames the entry that follows it", () => {
  const long = `package/dist/${"nested/".repeat(15)}index.js`;
  const files = tarFiles(
    tar([
      { path: "package/PaxHeaders/0", body: paxRecord("path", long), type: "x" },
      { path: long.slice(0, 100), body: "ok" },
    ]),
  );
  assert.deepEqual(
    files.map((f) => f.path),
    [long],
  );
});

test("a repack that differs only in packing has the same content digest", () => {
  // The whole point of comparing contents rather than shasums: npm's tarball
  // bytes are not the artifact, the files inside are.
  const entries: Entry[] = [
    { path: "package/package.json", body: '{"name":"x"}' },
    { path: "package/dist/index.js", body: "export const a = 1;\n" },
  ];
  const first = tar(entries);
  const second = tar(entries.map((e) => ({ ...e, mtime: 1_700_000_000 })));
  assert.notEqual(first.toString("base64"), second.toString("base64"));
  assert.equal(digestOfTarball(first), digestOfTarball(second));
});

test("a changed file changes the content digest", () => {
  const before = tar([{ path: "package/dist/index.js", body: "export const a = 1;\n" }]);
  const after = tar([{ path: "package/dist/index.js", body: "export const a = 2;\n" }]);
  assert.notEqual(digestOfTarball(before), digestOfTarball(after));
});

test("the content digest does not depend on archive order", () => {
  const a = { path: "dist/a.js", data: Buffer.from("a") };
  const b = { path: "dist/b.js", data: Buffer.from("b") };
  assert.equal(contentDigest([a, b]), contentDigest([b, a]));
});

/* -------------------------------------------------------------------------- */
/* A tarball that is missing its build                                         */
/* -------------------------------------------------------------------------- */

test("the library's real entry points are all asked for", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "packages", "hqtui", "package.json"), "utf8"));
  const required = requiredEntryPoints(pkg);
  assert.ok(required.includes("dist/index.js"), `missing dist/index.js in ${required.join(", ")}`);
  assert.ok(required.includes("dist/index.d.ts"));
  assert.ok(required.includes("bin/hqtui.mjs"));
  assert.deepEqual(missingEntryPoints(pkg, ["package/README.md"]).includes("dist/index.js"), true);
  assert.deepEqual(missingEntryPoints(pkg, required.map((p) => `package/${p}`)), []);
});

test("a bin that imports a dist the tarball does not have is caught", () => {
  // This is the 0.1.10 shape exactly: apps/demo declares bin/hqtui-demo.mjs,
  // which is one `import "../dist/main.js"` line. The declared entry point can
  // be present in a tarball that installs nothing runnable.
  const bin = { path: "package/bin/hqtui-demo.mjs", data: Buffer.from('import "../dist/main.js";\n') };
  assert.deepEqual(unresolvedImports([bin]), ["bin/hqtui-demo.mjs imports ../dist/main.js"]);
  assert.deepEqual(
    unresolvedImports([bin, { path: "package/dist/main.js", data: Buffer.from("") }]),
    [],
  );
});

test("extensionless and index imports still resolve", () => {
  const files = [
    { path: "package/dist/index.js", data: Buffer.from('export * from "./widgets";\nimport "./util/index.js";\n') },
    { path: "package/dist/widgets.js", data: Buffer.from("") },
    { path: "package/dist/util/index.js", data: Buffer.from("") },
  ];
  assert.deepEqual(unresolvedImports(files), []);
});

/* -------------------------------------------------------------------------- */
/* Asking the registry                                                         */
/* -------------------------------------------------------------------------- */

const response = (status: number, body?: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => {
    if (body === undefined) throw new Error("not json");
    return body;
  },
});

test("the registry's answers are classified, not guessed", async () => {
  const ask = (impl: unknown) =>
    lookupPublished({ name: "@profullstack/hqtui", version: "0.1.10", fetchImpl: impl as typeof fetch });

  assert.deepEqual(await ask(async () => response(404)), { state: "absent" });

  assert.deepEqual(await ask(async () => response(200, { dist: { shasum: "abc", tarball: "t" } })), {
    state: "present",
    shasum: "abc",
    tarball: "t",
  });

  // A registry that is down must never read as "nothing published here".
  assert.equal((await ask(async () => response(503))).state, "indeterminate");
  assert.equal((await ask(async () => response(200, { dist: {} }))).state, "indeterminate");
  assert.equal(
    (
      await ask(async () => {
        throw new Error("ECONNRESET");
      })
    ).state,
    "indeterminate",
  );
});

test("the request asks for the version, with the scope escaped", async () => {
  let asked = "";
  await lookupPublished({
    name: "@profullstack/hqtui",
    version: "0.6.2",
    fetchImpl: (async (url: string) => {
      asked = url;
      return response(404);
    }) as unknown as typeof fetch,
  });
  assert.equal(asked, "https://registry.npmjs.org/@profullstack%2fhqtui/0.6.2");
});

test("only indeterminate answers are retried", async () => {
  let calls = 0;
  const flaky = (async () => {
    calls += 1;
    return calls < 3 ? response(500) : response(200, { dist: { shasum: "abc" } });
  }) as unknown as typeof fetch;

  const found = await lookupWithRetry(
    { name: "x", version: "1.0.0", fetchImpl: flaky },
    { attempts: 4, delay: 0, sleep: async () => {} },
  );
  assert.equal(found.state, "present");
  assert.equal(calls, 3);

  calls = 0;
  await lookupWithRetry(
    { name: "x", version: "1.0.0", fetchImpl: (async () => response(404)) as unknown as typeof fetch },
    { attempts: 4, delay: 0, sleep: async () => {} },
  );
  assert.equal(calls, 0, "a 404 is a fact, not a flake");
});

test("each registry answer maps to one action", () => {
  assert.equal(resolveAction({ published: { state: "absent" }, shasum: "a" }).action, "publish");
  assert.equal(resolveAction({ published: { state: "present", shasum: "a" }, shasum: "a" }).action, "skip");
  assert.equal(resolveAction({ published: { state: "present", shasum: "b" }, shasum: "a" }).action, "compare");
  assert.equal(
    resolveAction({ published: { state: "indeterminate", reason: "503" }, shasum: "a" }).action,
    "fail",
  );
});

test("a published version has to become readable, and be the one we sent", async () => {
  let calls = 0;
  const appearing = (async () => {
    calls += 1;
    return calls < 3 ? response(404) : response(200, { dist: { shasum: "abc" } });
  }) as unknown as typeof fetch;

  const found = await waitForAvailability({
    name: "x",
    version: "1.0.0",
    shasum: "abc",
    fetchImpl: appearing,
    sleep: async () => {},
  });
  assert.equal(found.shasum, "abc");

  await assert.rejects(
    waitForAvailability({
      name: "x",
      version: "1.0.0",
      shasum: "abc",
      fetchImpl: (async () => response(200, { dist: { shasum: "different" } })) as unknown as typeof fetch,
      sleep: async () => {},
    }),
    /not the abc this run verified/,
  );

  await assert.rejects(
    waitForAvailability({
      name: "x",
      version: "1.0.0",
      fetchImpl: (async () => response(404)) as unknown as typeof fetch,
      attempts: 2,
      sleep: async () => {},
    }),
    /did not become readable/,
  );
});

/* -------------------------------------------------------------------------- */
/* The incident, as a test                                                     */
/* -------------------------------------------------------------------------- */

/** A packed release on disk: two tarballs and the manifest `pack` writes. */
function packedRelease(bodies: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hqtui-release-"));
  const packages = [
    { dir: "packages/hqtui", label: "library", name: "@profullstack/hqtui" },
    { dir: "apps/demo", label: "demo", name: "@profullstack/hqtui-demo" },
  ].map((pkg, index) => {
    const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-0.1.10.tgz`;
    const gzipped = tar([{ path: "package/dist/index.js", body: bodies[pkg.name] ?? `pkg ${index}\n` }]);
    writeFileSync(join(dir, tarball), gzipped);
    return {
      ...pkg,
      version: "0.1.10",
      tarball,
      shasum: `sha-${index}`,
      contentDigest: digestOfTarball(gzipped),
    };
  });
  writeFileSync(join(dir, MANIFEST), JSON.stringify({ version: "0.1.10", distTag: "latest", packages }));
  return { dir, packages };
}

test("recovery publishes only the package that is missing", async () => {
  // Run 33854645746: the library went out, the demo did not. Re-running the
  // whole workflow used to die on the library, which is why 0.1.10 was
  // abandoned for 0.1.11.
  const { dir, packages } = packedRelease();
  const published = new Map([[packages[0]!.name, packages[0]!.shasum]]);
  const uploaded: string[] = [];

  const registry = (async (url: string) => {
    const name = decodeURIComponent(new URL(url).pathname.split("/").slice(1, -1).join("/"));
    const shasum = published.get(name);
    return shasum ? response(200, { dist: { shasum } }) : response(404);
  }) as unknown as typeof fetch;

  const plan = await silently(() =>
    publishAll({
      from: dir,
      fetchImpl: registry,
      sleep: async () => {},
      runNpm: (_cmd: string, args: string[]) => {
        const tarball = args[1] ?? "";
        const entry = packages.find((p) => tarball.endsWith(p.tarball))!;
        uploaded.push(entry.name);
        published.set(entry.name, entry.shasum);
        return "";
      },
    }),
  );

  assert.deepEqual(
    plan.map((step) => step.decision.action),
    ["skip", "publish"],
  );
  assert.deepEqual(uploaded, ["@profullstack/hqtui-demo"], "the library must not be uploaded twice");
});

test("a version already published with different contents stops the run before any upload", async () => {
  const { dir, packages } = packedRelease();
  const uploaded: string[] = [];

  const registry = (async (url: string) => {
    if (url.endsWith(".tgz")) {
      // Same version on the registry, different build inside it.
      return {
        status: 200,
        ok: true,
        arrayBuffer: async () => tar([{ path: "package/dist/index.js", body: "something else\n" }]),
      };
    }
    const name = decodeURIComponent(new URL(url).pathname.split("/").slice(1, -1).join("/"));
    return name === packages[0]!.name
      ? response(200, { dist: { shasum: "not-ours", tarball: "https://registry.npmjs.org/x.tgz" } })
      : response(404);
  }) as unknown as typeof fetch;

  await assert.rejects(
    silently(() =>
      publishAll({
        from: dir,
        fetchImpl: registry,
        sleep: async () => {},
        runNpm: (_cmd: string, args: string[]) => {
          uploaded.push(args[1] ?? "");
          return "";
        },
      }),
    ),
    /different contents under this version/,
  );
  assert.deepEqual(uploaded, [], "nothing may be uploaded once a conflict is known");
});

test("a repacked but identical artifact is skipped rather than fought over", async () => {
  const { dir, packages } = packedRelease();
  const remote = readFileSync(join(dir, packages[0]!.tarball));
  const uploaded: string[] = [];
  // The library is on the registry from a pack that gzipped differently.
  const published = new Map([[packages[0]!.name, "packed-by-another-npm"]]);

  const registry = (async (url: string) => {
    if (url.endsWith(".tgz")) {
      return { status: 200, ok: true, arrayBuffer: async () => remote };
    }
    const name = decodeURIComponent(new URL(url).pathname.split("/").slice(1, -1).join("/"));
    const shasum = published.get(name);
    return shasum
      ? response(200, { dist: { shasum, tarball: "https://registry.npmjs.org/x.tgz" } })
      : response(404);
  }) as unknown as typeof fetch;

  const plan = await silently(() =>
    publishAll({
      from: dir,
      fetchImpl: registry,
      sleep: async () => {},
      runNpm: (_cmd: string, args: string[]) => {
        const tarball = args[1] ?? "";
        const entry = packages.find((p) => tarball.endsWith(p.tarball))!;
        uploaded.push(entry.name);
        published.set(entry.name, entry.shasum);
        return "";
      },
    }),
  );

  assert.equal(plan[0]?.decision.action, "skip");
  assert.equal(uploaded.length, 1, "only the demo is uploaded");
});

test("an unreadable registry fails the run instead of guessing", async () => {
  const { dir } = packedRelease();
  const uploaded: string[] = [];

  await assert.rejects(
    silently(() =>
      publishAll({
        from: dir,
        fetchImpl: (async () => response(500)) as unknown as typeof fetch,
        sleep: async () => {},
        runNpm: (_cmd: string, args: string[]) => {
          uploaded.push(args[1] ?? "");
          return "";
        },
      }),
    ),
    /did not give a usable answer/,
  );
  assert.deepEqual(uploaded, []);
});

/* -------------------------------------------------------------------------- */
/* Reading the flags the workflow passes                                        */
/* -------------------------------------------------------------------------- */

test("an empty flag value stays empty instead of becoming the string 'true'", () => {
  // v0.7.0 shipped under the dist-tag `true`. The workflow passes
  // `--tag "$DIST_TAG"` on every trigger and DIST_TAG is empty unless someone
  // names one, so an empty value has to read as empty.
  assert.deepEqual(parseArgs(["--tag", ""]), { tag: "" });
  assert.deepEqual(parseArgs(["--tag", "next"]), { tag: "next" });
  assert.deepEqual(parseArgs(["--dry-run"]), { "dry-run": "true" });
  assert.deepEqual(parseArgs(["--from", "", "--dry-run"]), { from: "", "dry-run": "true" });
  assert.deepEqual(parseArgs(["--out", "--dry-run"]), { out: "true", "dry-run": "true" });
});

test("an empty dist-tag from the workflow publishes as latest, never as 'true'", () => {
  // The whole path, from the flags the workflow passes to the tag npm is given.
  const flags = parseArgs(["pack", "--out", "/tmp/x", "--event", "release", "--ref", "v1.2.3", "--tag", ""]);
  const { distTag } = checkVersions({
    versions: { "packages/hqtui": "1.2.3", "apps/demo": "1.2.3" },
    event: flags.event ?? "",
    ref: flags.ref ?? "",
    distTag: flags.tag ?? "",
  });
  assert.equal(distTag, "latest");
});

test("a provenance publish gets minutes, not seconds, to become readable", () => {
  // npm accepts a provenance publish and processes it asynchronously: on
  // v0.7.0 the library took 7m30s to appear. Under a minute of patience failed
  // a release that had succeeded, so the default budget has to stay generous.
  const waited: number[] = [];
  return assert
    .rejects(
      waitForAvailability({
        name: "x",
        version: "1.0.0",
        fetchImpl: (async () => response(404)) as unknown as typeof fetch,
        sleep: async (ms: number) => void waited.push(ms),
      }),
      /did not become readable/,
    )
    .then(() => {
      const total = waited.reduce((sum, ms) => sum + ms, 0);
      assert.ok(
        total >= 300_000,
        `gives up after ${total}ms, which is less than the five minutes npm can take`,
      );
    });
});

/* -------------------------------------------------------------------------- */
/* The workflow actually uses it                                               */
/* -------------------------------------------------------------------------- */

test("the publish workflow goes through the saga, not straight at npm", () => {
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "publish.yml"), "utf8");

  assert.match(workflow, /scripts\/publish\.mjs pack/);
  assert.match(workflow, /scripts\/publish\.mjs publish/);

  // A draft release triggers nothing — GitHub does not run workflows for the
  // `created` activity type on drafts — so the tag push is what starts a
  // release, and it is the only path that can announce one afterwards.
  assert.match(workflow, /tags: \["v\*"\]/);

  // The announcement has to come after the uploads it is announcing.
  const uploads = workflow.indexOf("publish.mjs publish");
  const announce = workflow.indexOf("Announce the release");
  assert.ok(uploads > 0 && announce > uploads, "the release is announced before it is published");

  // An unconditional `npm publish` of a directory is the thing that could not
  // be retried. Packing and publishing a recorded tarball is the replacement.
  const bare = workflow
    .split("\n")
    .filter((line) => /npm publish/.test(line) && !/publish\.mjs/.test(line));
  assert.deepEqual(bare, [], "publish.yml calls npm publish directly again");
});
