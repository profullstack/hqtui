#!/usr/bin/env node
/**
 * The two-package release, as a saga that can be resumed.
 *
 * Run 33854645746 published `@profullstack/hqtui@0.1.10`, then failed on the
 * demo. The registry kept the library, the GitHub release stayed public, and a
 * whole-workflow retry could not get past the library again: npm answers a
 * second upload of a published version with "You cannot publish over the
 * previously published versions". Recovery meant burning 0.1.11 on a release
 * nobody had shipped.
 *
 * Two irreversible uploads cannot be made atomic, so this makes them
 * resumable instead:
 *
 *   1. `pack` builds both tarballs before either is uploaded, and records the
 *      exact bytes. A build failure now happens while nothing is public.
 *   2. `publish` asks the registry about each version first and classifies the
 *      answer. A verified match is skipped, an absent version is uploaded, and
 *      anything else — a different artifact under the same version, or a
 *      registry that will not say — fails without touching the registry.
 *   3. `publish` then waits for both versions to be readable before it exits
 *      zero, which is what lets the workflow leave a draft release drafted
 *      until the registry work is actually done.
 *
 * Skipping is decided on content, not on the name alone. `dist.shasum` is
 * compared first; if it differs the published tarball is downloaded and
 * compared file by file, because two packs of one commit can differ in gzip
 * bytes without differing in what they install. Only a real content difference
 * is a conflict.
 *
 * Everything above the CLI at the bottom is pure enough to test, and
 * packages/hqtui/test/publish.test.ts does.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/** Published together, from one commit, library first: the demo depends on it. */
export const PACKAGES = [
  { dir: "packages/hqtui", label: "library" },
  { dir: "apps/demo", label: "demo" },
];

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
export const MANIFEST = "release-manifest.json";

/**
 * The types are JSDoc because this file is plain JavaScript: the workflow runs
 * it with bare `node`, before anything in the repository has been built.
 *
 * @typedef {{ path: string, data: Buffer }} TarFile
 * @typedef {{ state: "present", shasum: string, tarball?: string }} OnRegistry
 * @typedef {{ state: "absent" }
 *   | OnRegistry
 *   | { state: "indeterminate", reason: string }} Published
 * @typedef {{ action: "publish" | "skip" | "compare" | "fail", reason: string }} Decision
 * @typedef {{ name: string, version: string, registry?: string, fetchImpl?: typeof fetch }} Query
 * @typedef {(command: string, args: string[], cwd: string) => string} RunNpm
 * @typedef {(ms: number) => Promise<void>} Sleep
 */

const ROOT = resolve(import.meta.dirname, "..");

const log = (...parts) => console.log(...parts);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/* -------------------------------------------------------------------------- */
/* What is allowed to be published at all                                       */
/* -------------------------------------------------------------------------- */

/**
 * Nothing tied the release tag to what actually gets published, so a tag could
 * ship a version it does not name. This runs on every trigger: a dispatch
 * publishes just as readily as a release, and gating the check on the event
 * left that path unchecked.
 *
 * Returns the agreed version and the dist-tag it will publish under; throws
 * with the reason if there is not one.
 *
 * @param {{ versions: Record<string, string>, event: string, ref: string, distTag?: string }} options
 * @returns {{ version: string, distTag: string }}
 */
export function checkVersions({ versions, event, ref, distTag = "" }) {
  const names = Object.keys(versions);
  const agreed = versions[names[0]];
  for (const name of names) {
    if (versions[name] !== agreed) {
      const lines = names.map((n) => `  ${n.padEnd(15)} ${versions[n]}`);
      throw new Error(
        ["the packages disagree about the version being published:", ...lines].join("\n"),
      );
    }
  }

  // A prerelease must not become what `npm install` resolves to. Left to
  // itself it goes out under 'next'; asking for 'latest' by hand is the only
  // way to get this wrong, and it is refused.
  const prerelease = agreed.includes("-");
  const tag = distTag || (prerelease ? "next" : "latest");
  if (prerelease && tag === "latest") {
    throw new Error(
      `${agreed} is a prerelease and would be published as 'latest'.\n` +
        "re-run without a dist-tag to publish it as 'next'.",
    );
  }

  // A tag names the version it publishes. On a dispatch `ref` is a branch, so
  // there is nothing to compare it against.
  if (event === "release") {
    const tagged = ref.replace(/^v/, "");
    if (tagged !== agreed) {
      throw new Error(
        `release tag '${ref}' does not name the version it would publish (${agreed})`,
      );
    }
  }

  return { version: agreed, distTag: tag };
}

/* -------------------------------------------------------------------------- */
/* Reading a packed tarball                                                     */
/* -------------------------------------------------------------------------- */

const readField = (buf, off, len) => {
  const nul = buf.indexOf(0, off);
  const end = nul === -1 || nul > off + len ? off + len : nul;
  return buf.toString("utf8", off, end);
};

const readOctal = (buf, off, len) => {
  const text = buf
    .toString("ascii", off, off + len)
    .replace(/\0.*$/, "")
    .trim();
  return text === "" ? 0 : Number.parseInt(text, 8);
};

/** pax records are `<byte length> <key>=<value>\n`, repeated. */
function parsePax(buf) {
  const out = {};
  let off = 0;
  while (off < buf.length) {
    const space = buf.indexOf(0x20, off);
    if (space === -1) break;
    const length = Number.parseInt(buf.toString("ascii", off, space), 10);
    if (!Number.isInteger(length) || length <= 0 || off + length > buf.length) break;
    const record = buf.toString("utf8", space + 1, off + length).replace(/\n$/, "");
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    off += length;
  }
  return out;
}

/**
 * The regular files in a gzipped tar, in archive order.
 *
 * `tar -tzf` would do this in one line, but the tests for it run on Windows
 * too, and a few hundred lines of tarball is not worth a dependency in a
 * repository that has none.
 *
 * @param {Uint8Array} gzipped
 * @returns {TarFile[]}
 */
export function tarFiles(gzipped) {
  const buf = gunzipSync(gzipped);
  const files = [];
  let off = 0;
  let pax = null;
  let longName = null;

  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((byte) => byte === 0)) break;

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0);
    const start = off + 512;
    const data = buf.subarray(start, start + size);
    off = start + Math.ceil(size / 512) * 512;

    if (type === "x" || type === "X") {
      pax = parsePax(data);
      continue;
    }
    if (type === "L") {
      longName = data.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    // A global header, or a long *link* name, applies to nothing we collect.
    if (type === "g" || type === "K") continue;

    let path = readField(header, 0, 100);
    const prefix = readField(header, 345, 155);
    if (prefix) path = `${prefix}/${path}`;
    if (longName) path = longName;
    if (pax?.path) path = pax.path;
    longName = null;
    pax = null;

    if (type === "0" || type === "\0") files.push({ path, data });
  }

  return files;
}

/**
 * A digest of what a tarball installs, ignoring how it was packed.
 *
 * Two packs of the same commit can differ byte for byte — a different npm, a
 * different gzip level — while installing exactly the same files. Comparing
 * names and contents is the difference between "the registry already has this
 * release" and "the registry has something else under this version".
 *
 * @param {TarFile[]} files
 * @returns {string}
 */
export function contentDigest(files) {
  const lines = files
    .map(({ path, data }) => `${createHash("sha256").update(data).digest("hex")}  ${path}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** The npm tarball prefix, so digests compare `dist/index.js`, not `package/dist/index.js`. */
const stripPrefix = (path) => path.replace(/^package\//, "");

export const digestOfTarball = (gzipped) =>
  contentDigest(tarFiles(gzipped).map(({ path, data }) => ({ path: stripPrefix(path), data })));

/* -------------------------------------------------------------------------- */
/* A tarball that is missing its build is not a release                         */
/* -------------------------------------------------------------------------- */

/**
 * Every path package.json promises a consumer: `main`, `types`, each `bin`,
 * and every file an `exports` subpath resolves to.
 *
 * Publishing a tarball skips `prepublishOnly`, which is the point — the build
 * happens once, before anything is uploaded — but it also removes the accident
 * that used to build the demo on its way out the door. This is the check that
 * replaces it, and it is stricter: it asks for the files, not for the script.
 */
export function requiredEntryPoints(pkg) {
  const paths = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.startsWith(".")) {
      paths.add(value.replace(/^\.\//, ""));
    }
  };

  add(pkg.main);
  add(pkg.types);
  if (typeof pkg.bin === "string") add(pkg.bin);
  else for (const target of Object.values(pkg.bin ?? {})) add(target);

  const walk = (node) => {
    if (typeof node === "string") add(node);
    else if (node && typeof node === "object") for (const child of Object.values(node)) walk(child);
  };
  walk(pkg.exports);

  return [...paths];
}

export function missingEntryPoints(pkg, filePaths) {
  const present = new Set(filePaths.map(stripPrefix));
  return requiredEntryPoints(pkg).filter((path) => !present.has(path));
}

const RELATIVE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*|\bexport\s+\*\s+from\s*)["'](\.[^"']*)["']|\bimport\(\s*["'](\.[^"']*)["']\s*\)/g;

/** `a/b/../c.js` without touching the filesystem: tarball paths are already posix. */
function resolveInTarball(fromDir, specifier) {
  const parts = [...fromDir.split("/").filter(Boolean), ...specifier.split("/")];
  const out = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * Relative imports inside the tarball that the tarball does not contain.
 *
 * `bin/hqtui-demo.mjs` is one line — `import "../dist/main.js"` — so the demo's
 * declared entry point can be present in a tarball that installs nothing
 * runnable. That is exactly how 0.1.10 got as far as it did. Following the
 * imports is what turns "the file package.json names exists" into "the package
 * runs".
 *
 * @param {TarFile[]} files
 * @returns {string[]}
 */
export function unresolvedImports(files) {
  const present = new Set(files.map(({ path }) => stripPrefix(path)));
  const missing = [];

  for (const { path, data } of files) {
    const name = stripPrefix(path);
    if (!/\.(?:js|mjs|cjs)$/.test(name)) continue;
    const dir = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
    const source = data.toString("utf8");

    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1] ?? match[2];
      const target = resolveInTarball(dir, specifier);
      const candidates = [target, `${target}.js`, `${target}/index.js`];
      if (!candidates.some((candidate) => present.has(candidate))) {
        missing.push(`${name} imports ${specifier}`);
      }
    }
  }

  return missing;
}

/* -------------------------------------------------------------------------- */
/* Asking the registry what it already has                                      */
/* -------------------------------------------------------------------------- */

export const versionUrl = (registry, name, version) =>
  `${registry.replace(/\/$/, "")}/${name.replace("/", "%2f")}/${encodeURIComponent(version)}`;

/**
 * One of three answers, never a guess:
 *
 *   absent        — the registry says this version does not exist
 *   present       — the registry described it, and said what it hashes to
 *   indeterminate — anything else, including a 5xx or a socket that closed
 *
 * "Indeterminate" is a distinct state on purpose. Treating an unreachable
 * registry as absent is how you publish twice; treating it as present is how
 * you skip a package that never shipped.
 *
 * @param {Query} options
 * @returns {Promise<Published>}
 */
export async function lookupPublished({
  name,
  version,
  registry = DEFAULT_REGISTRY,
  fetchImpl = fetch,
}) {
  let res;
  try {
    res = await fetchImpl(versionUrl(registry, name, version), {
      headers: { accept: "application/json" },
    });
  } catch (err) {
    return { state: "indeterminate", reason: `request failed: ${err.message}` };
  }

  if (res.status === 404) return { state: "absent" };
  if (!res.ok) return { state: "indeterminate", reason: `registry answered ${res.status}` };

  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { state: "indeterminate", reason: `unreadable response: ${err.message}` };
  }

  const shasum = body?.dist?.shasum;
  if (typeof shasum !== "string" || shasum === "") {
    return { state: "indeterminate", reason: "the response carries no dist.shasum" };
  }
  return { state: "present", shasum, tarball: body?.dist?.tarball };
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Retry only the indeterminate answers: absent and present are facts.
 *
 * @param {Query} opts
 * @param {{ attempts?: number, delay?: number, sleep?: Sleep }} [retry]
 * @returns {Promise<Published>}
 */
export async function lookupWithRetry(opts, { attempts = 4, delay = 2000, sleep = wait } = {}) {
  /** @type {Published} */
  let last = { state: "indeterminate", reason: "the registry was never asked" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await lookupPublished(opts);
    if (last.state !== "indeterminate") return last;
    if (attempt < attempts) await sleep(delay * attempt);
  }
  return last;
}

/**
 * What to do about one package, given what the registry has and what we packed.
 *
 * `compare` means the version exists under different bytes, which is not yet a
 * verdict — the caller fetches the published tarball and compares contents.
 *
 * @param {{ published: Published, shasum: string }} options
 * @returns {Decision}
 */
export function resolveAction({ published, shasum }) {
  if (published.state === "absent") return { action: "publish", reason: "not on the registry" };
  if (published.state === "present") {
    return published.shasum === shasum
      ? { action: "skip", reason: "already published, identical tarball" }
      : { action: "compare", reason: "already published under a different shasum" };
  }
  return {
    action: "fail",
    reason: `the registry did not give a usable answer (${published.reason})`,
  };
}

/**
 * After an upload, the version has to become readable before the release is
 * finished.
 *
 * @param {Query & { shasum?: string, attempts?: number, delay?: number, sleep?: Sleep }} options
 * @returns {Promise<OnRegistry>}
 */
export async function waitForAvailability({
  name,
  version,
  shasum = "",
  registry = DEFAULT_REGISTRY,
  fetchImpl = fetch,
  attempts = 10,
  delay = 5000,
  sleep = wait,
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const found = await lookupPublished({ name, version, registry, fetchImpl });
    if (found.state === "present") {
      if (shasum && found.shasum !== shasum) {
        throw new Error(
          `${name}@${version} is on the registry as ${found.shasum}, not the ${shasum} this run verified`,
        );
      }
      return found;
    }
    if (attempt < attempts) await sleep(delay);
  }
  throw new Error(`${name}@${version} did not become readable on ${registry}`);
}

/* -------------------------------------------------------------------------- */
/* The two commands                                                             */
/* -------------------------------------------------------------------------- */

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  return result.stdout;
}

/**
 * @param {{ out: string, root?: string, event?: string, ref?: string, distTag?: string }} options
 */
export function packAll({ root = ROOT, out, event = "", ref = "", distTag = "" }) {
  const dirs = PACKAGES.map(({ dir, label }) => ({
    dir,
    label,
    pkg: readJson(join(root, dir, "package.json")),
  }));

  const versions = Object.fromEntries(dirs.map(({ dir, pkg }) => [dir, pkg.version]));
  const { version, distTag: tag } = checkVersions({ versions, event, ref, distTag });
  log(`packing ${version} for dist-tag '${tag}'`);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const packages = dirs.map(({ dir, label, pkg }) => {
    const stdout = run("npm", ["pack", "--json", "--pack-destination", resolve(out)], join(root, dir));
    const [packed] = JSON.parse(stdout);
    const gzipped = readFileSync(join(out, packed.filename));
    const files = tarFiles(gzipped);

    const missing = missingEntryPoints(
      pkg,
      files.map((file) => file.path),
    );
    if (missing.length > 0) {
      throw new Error(
        `${packed.name} packed without ${missing.join(", ")} — the build did not produce what package.json promises`,
      );
    }

    const dangling = unresolvedImports(files);
    if (dangling.length > 0) {
      throw new Error(
        [`${packed.name} packed with imports it does not contain:`, ...dangling.map((d) => `  ${d}`)].join("\n"),
      );
    }

    log(`  ${label}: ${packed.filename} (${files.length} files, shasum ${packed.shasum})`);
    return {
      dir,
      label,
      name: packed.name,
      version: packed.version,
      tarball: packed.filename,
      shasum: packed.shasum,
      integrity: packed.integrity,
      contentDigest: digestOfTarball(gzipped),
    };
  });

  const manifest = { version, distTag: tag, packages };
  writeFileSync(join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * @param {{ from: string, distTag?: string, dryRun?: boolean, registry?: string,
 *   fetchImpl?: typeof fetch, runNpm?: RunNpm, sleep?: Sleep }} options
 * @returns {Promise<{ entry: any, decision: Decision, published: Published }[]>}
 */
export async function publishAll({
  from,
  distTag = "",
  dryRun = false,
  registry = DEFAULT_REGISTRY,
  fetchImpl = fetch,
  runNpm = run,
  sleep = wait,
}) {
  const manifest = readJson(join(from, MANIFEST));
  const tag = distTag || manifest.distTag;

  // Every decision is made before any upload, so a conflict on the demo keeps
  // the library from going out: the ordering the first incident did not have.
  const plan = [];
  for (const entry of manifest.packages) {
    const published = await lookupWithRetry(
      { name: entry.name, version: entry.version, registry, fetchImpl },
      { sleep },
    );
    let decision = resolveAction({ published, shasum: entry.shasum });

    if (decision.action === "compare") {
      log(`${entry.name}@${entry.version}: ${decision.reason}, comparing contents`);
      const res = await fetchImpl(
        published.tarball ?? versionUrl(registry, entry.name, entry.version),
      );
      if (!res.ok) {
        decision = { action: "fail", reason: `could not read the published tarball (${res.status})` };
      } else {
        const remote = digestOfTarball(Buffer.from(await res.arrayBuffer()));
        decision =
          remote === entry.contentDigest
            ? { action: "skip", reason: "already published, same contents repacked" }
            : { action: "fail", reason: "the registry has different contents under this version" };
      }
    }

    log(`${entry.name}@${entry.version}: ${decision.action} (${decision.reason})`);
    plan.push({ entry, decision, published });
  }

  const conflicts = plan.filter(({ decision }) => decision.action === "fail");
  if (conflicts.length > 0) {
    throw new Error(
      conflicts
        .map(({ entry, decision }) => `${entry.name}@${entry.version}: ${decision.reason}`)
        .join("\n"),
    );
  }

  for (const { entry, decision } of plan) {
    if (decision.action !== "publish") continue;
    const args = [
      "publish",
      resolve(from, entry.tarball),
      "--access",
      "public",
      "--provenance",
      "--tag",
      tag,
    ];
    if (dryRun) args.push("--dry-run");
    log(`publishing ${entry.name}@${entry.version} as '${tag}'`);
    runNpm("npm", args, resolve(from));
  }

  if (dryRun) return plan;

  for (const { entry, decision, published } of plan) {
    const shasum = decision.action === "publish" ? entry.shasum : published.shasum;
    await waitForAvailability({
      name: entry.name,
      version: entry.version,
      shasum,
      registry,
      fetchImpl,
      sleep,
    });
    log(`verified ${entry.name}@${entry.version} is readable on the registry`);
  }

  return plan;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                          */
/* -------------------------------------------------------------------------- */

export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
    else flags[key] = "true";
  }
  return flags;
}

const USAGE =
  "usage: publish.mjs pack|publish [--out dir] [--from dir] [--tag latest] [--event release] [--ref v0.0.0] [--dry-run]";

async function main(argv) {
  const [command, ...rest] = argv;
  const flags = parseArgs(rest);
  const out = resolve(flags.out ?? join(ROOT, ".release-artifacts"));

  if (command === "pack") {
    packAll({ out, event: flags.event ?? "", ref: flags.ref ?? "", distTag: flags.tag ?? "" });
    return;
  }

  if (command === "publish") {
    await publishAll({
      from: resolve(flags.from ?? out),
      distTag: flags.tag,
      dryRun: flags["dry-run"] === "true",
    });
    return;
  }

  throw new Error(USAGE);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
