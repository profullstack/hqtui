/** Matched workload for ports/c/tests/benchmark.c. Run with Bun or Node.
 * These are in-memory core costs, not full demo FPS or terminal throughput. */
import { FrameBuffer } from "../../../packages/hqtui/src/buffer.ts";
import { Encoder } from "../../../packages/hqtui/src/diff.ts";
import { rgb } from "../../../packages/hqtui/src/color.ts";

const iterations = Number(process.argv[2] ?? 2000);
if (!Number.isInteger(iterations) || iterations < 100 || iterations > 1_000_000) {
  throw new Error("iterations must be an integer between 100 and 1000000");
}
const width = 200, height = 50;
for (const [mode, workload] of ["unchanged", "sparse", "full"].entries()) {
  const a = new FrameBuffer(width, height), b = new FrameBuffer(width, height);
  const encoder = new Encoder({ colors: "truecolor" });
  const style = { fg: rgb(88, 166, 255), bg: rgb(5, 7, 10), attrs: 0 };
  let bytes = 0, changed = 0, start = 0;
  for (let tick = -100; tick < iterations; tick++) {
    if (tick === 0) start = performance.now();
    const count = mode === 0 ? 0 : mode === 1 ? 100 : width * height;
    for (let i = 0; i < count; i++) {
      const pos = mode === 1 ? i * 97 % (width * height) : i;
      b.setCell(pos % width, Math.floor(pos / width), 65 + (tick + 100 + i) % 26, style);
    }
    const out = encoder.encode(a, b, tick === -100);
    // This workload emits ASCII only: JS string length equals UTF-8 byte count.
    if (tick >= 0) { bytes += out.output.length; changed += out.changedCells; }
    a.copyFrom(b);
  }
  console.log(JSON.stringify({ language: "typescript", runtime: process.versions.bun ? "bun" : "node",
    workload, width, height, iterations, ns_per_frame: (performance.now() - start) * 1e6 / iterations,
    bytes, changed_cells: changed, warm_allocations: null }));
}
