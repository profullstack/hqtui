/** Build ports/cpp in Release first; run `bun apps/benchmark/src/compare-native-core.ts`.
 * Serial, alternating-order trials avoid benchmarking languages against each
 * other on the CPU simultaneously. Timing is descriptive, never a CI threshold.
 */
import { spawnSync } from "node:child_process";
import { cpus, platform, arch } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../../..");
const iterations = Number(process.argv[2] ?? 2000), trials = Number(process.argv[3] ?? 3);
assert.ok(Number.isInteger(iterations) && iterations >= 100 && iterations <= 1_000_000);
assert.ok(Number.isInteger(trials) && trials >= 1 && trials <= 20);
const suffix = platform() === "win32" ? ".exe" : "";
const commands: Record<string, string[]> = {
  c: [resolve(root, `ports/cpp/build-release/c/hqtui_c_bench${suffix}`), String(iterations)],
  cpp: [resolve(root, `ports/cpp/build-release/hqtui_cpp_bench${suffix}`), String(iterations)],
  typescript: [process.execPath, resolve(root, "apps/benchmark/src/native-core.ts"), String(iterations)],
};
type Result = { language: string; workload: string; ns_per_frame: number; bytes: number;
  changed_cells: number; warm_allocations: number | null; iterations: number; width: number; height: number };
const results: Result[] = [];
for (let trial = 0; trial < trials; trial++) {
  const names = Object.keys(commands);
  if (trial % 2) names.reverse();
  for (const language of names) {
    const [command, ...args] = commands[language];
    const run = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 300_000 });
    assert.equal(run.status, 0, `${language}: ${run.error ?? run.stderr}`);
    const rows: Result[] = run.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(rows.map(r => r.workload), ["unchanged", "sparse", "full"]);
    for (const row of rows) {
      assert.equal(row.language, language);
      assert.equal(row.width, 200); assert.equal(row.height, 50); assert.equal(row.iterations, iterations);
      if (language !== "typescript") assert.equal(row.warm_allocations, 0, "native warm-frame allocation regression");
    }
    results.push(...rows);
  }
}
const summary = ["unchanged", "sparse", "full"].map(workload => {
  const rows = results.filter(r => r.workload === workload);
  assert.equal(new Set(rows.map(r => r.bytes)).size, 1, "output byte-count mismatch");
  assert.equal(new Set(rows.map(r => r.changed_cells)).size, 1, "changed-cell mismatch");
  return { workload, bytes_per_trial: rows[0].bytes, changed_cells_per_trial: rows[0].changed_cells,
    median_ms_per_frame: Object.fromEntries(Object.keys(commands).map(language => {
      const times = rows.filter(r => r.language === language).map(r => r.ns_per_frame).sort((a,b) => a-b);
      const mid = Math.floor(times.length/2);
      const median = times.length % 2 ? times[mid] : (times[mid-1]+times[mid])/2;
      return [language, median/1e6];
    })) };
});
console.log(JSON.stringify({ measured_at: new Date().toISOString(), platform: platform(), arch: arch(),
  cpu: cpus()[0]?.model, runtime: process.versions.bun ? `Bun ${process.versions.bun}` : process.version,
  iterations, trials, width: 200, height: 50,
  scope: "in-memory ASCII cell updates, delta encoding and buffer copy; excludes collectors, widgets and terminal I/O",
  native_warm_allocations: 0, summary }, null, 2));
