/**
 * Reproducible renderer benchmarks.
 *
 *   bun run bench
 *
 * Everything is measured against a fixed 160x50 grid (8,000 cells) so numbers
 * are comparable between machines and across releases.
 */
import {
  Encoder, FrameBuffer, BrailleCanvas, createSurface, solve, themes,
  renderToScreen, hex, stringWidth,
} from "@profullstack/hqtui";

const WIDTH = 160;
const HEIGHT = 50;
const CELLS = WIDTH * HEIGHT;

interface Result {
  name: string;
  meanMs: number;
  p95Ms: number;
  opsPerSecond: number;
  note: string;
}

function bench(name: string, iterations: number, fn: (i: number) => void, note = ""): Result {
  // Warm up so we measure steady state, not the JIT.
  for (let i = 0; i < Math.min(50, iterations); i++) fn(i);
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn(i);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    name,
    meanMs: mean,
    p95Ms: samples[Math.floor(samples.length * 0.95)],
    opsPerSecond: 1000 / mean,
    note,
  };
}

function fill(buffer: FrameBuffer, seed: number): void {
  const fg = hex("#58a6ff");
  for (let y = 0; y < buffer.height; y++) {
    buffer.write(0, y, `row ${y} ${"x".repeat(120)} ${seed}`, { fg });
  }
}

function changeFraction(buffer: FrameBuffer, fraction: number, seed: number): void {
  const count = Math.round(CELLS * fraction);
  for (let i = 0; i < count; i++) {
    const index = (i * 7919 + seed) % CELLS;
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    buffer.setCell(x, y, 65 + ((i + seed) % 26), { fg: hex("#5fff87") });
  }
}

const results: Result[] = [];

// --- renderer ---------------------------------------------------------------
{
  const prev = new FrameBuffer(WIDTH, HEIGHT);
  const next = new FrameBuffer(WIDTH, HEIGHT);
  fill(prev, 0);
  fill(next, 0);
  const encoder = new Encoder({ colors: "truecolor" });

  results.push(bench("renderer.frame.unchanged", 500, () => {
    encoder.encode(prev, next);
  }, "0% changed"));

  for (const fraction of [0.01, 0.1, 0.5, 1]) {
    const a = new FrameBuffer(WIDTH, HEIGHT);
    const b = new FrameBuffer(WIDTH, HEIGHT);
    fill(a, 0);
    fill(b, 0);
    const enc = new Encoder({ colors: "truecolor" });
    let bytes = 0;
    const result = bench(`renderer.frame.${Math.round(fraction * 100)}pct`, 300, (i) => {
      changeFraction(b, fraction, i);
      bytes = enc.encode(a, b).output.length;
      a.copyFrom(b);
    }, "");
    result.note = `${bytes} bytes/frame`;
    results.push(result);
  }

  const full = new FrameBuffer(WIDTH, HEIGHT);
  fill(full, 1);
  const empty = new FrameBuffer(WIDTH, HEIGHT);
  results.push(bench("renderer.repaint.full", 200, () => {
    new Encoder({ colors: "truecolor" }).encode(empty, full, true);
  }, "8,000 cells"));
}

// --- framebuffer ------------------------------------------------------------
{
  const buffer = new FrameBuffer(WIDTH, HEIGHT);
  results.push(bench("buffer.writeScreen", 500, (i) => fill(buffer, i), "50 rows of text"));
  results.push(bench("buffer.clear", 2000, () => buffer.clear(hex("#05070a"))));
}

// --- graphics ---------------------------------------------------------------
{
  const canvas = new BrailleCanvas(80, 20);
  const points: [number, number][] = Array.from({ length: 160 }, (_, i) => [i, Math.round(Math.sin(i / 8) * 30 + 40)]);
  results.push(bench("graphics.braille.polyline", 2000, () => {
    canvas.clear();
    canvas.polyline(points);
  }, "160 points"));

  const values = Array.from({ length: 320 }, (_, i) => Math.sin(i / 9) * 50 + 50);
  results.push(bench("graphics.graph.braille", 500, () => {
    renderToScreen(({ ui }) => ui.graph({ values, min: 0, max: 100, fill: true }), { width: 80, height: 20 });
  }, "80x20 filled area"));
}

// --- layout + widgets -------------------------------------------------------
{
  const constraints = Array.from({ length: 12 }, (_, i) => ({ size: i % 3 === 0 ? "1fr" : `${10 + i}` }));
  results.push(bench("layout.solve", 20000, () => solve(WIDTH, constraints, 1), "12 tracks"));

  const rows = Array.from({ length: 60 }, (_, i) => ({
    pid: 1000 + i, name: `process-${i}`, cpu: (i % 100) / 2, mem: (i % 40) / 3,
  }));
  const columns = [
    { key: "pid", title: "PID", width: 8, align: "right" as const },
    { key: "name", title: "Name" },
    { key: "cpu", title: "CPU%", width: 7, align: "right" as const },
    { key: "mem", title: "MEM%", width: 7, align: "right" as const },
  ];
  results.push(bench("widgets.table", 500, () => {
    renderToScreen(({ ui }) => ui.table({ rows, columns, zebra: true }), { width: 100, height: 40 });
  }, "60 rows x 4 columns"));

  results.push(bench("widgets.dashboard", 200, () => {
    renderToScreen(({ ui }) => {
      ui.grid({ columns: 3, rows: 2, gap: 1 }, (grid) => {
        for (let i = 0; i < 6; i++) {
          grid.panel({ title: `Panel ${i}` }, (p) => {
            p.meter({ label: "cpu", value: 0.5 });
            p.graph({ values: [1, 5, 3, 8, 2, 9, 4], min: 0, max: 10 });
          });
        }
      });
    }, { width: WIDTH, height: HEIGHT });
  }, "6 panels, 160x50"));
}

// --- text -------------------------------------------------------------------
{
  const text = "The quick brown fox 日本語テスト 👩‍💻 jumps over the lazy dog";
  results.push(bench("text.stringWidth", 20000, () => stringWidth(text), "mixed width + emoji"));
}

const pad = Math.max(...results.map((r) => r.name.length));
console.log(`\nHQTUI benchmarks — ${WIDTH}x${HEIGHT} (${CELLS.toLocaleString()} cells)`);
console.log(`runtime: ${typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`}  platform: ${process.platform}\n`);
console.log(`${"benchmark".padEnd(pad)}  ${"mean".padStart(9)}  ${"p95".padStart(9)}  ${"ops/s".padStart(10)}   note`);
console.log("─".repeat(pad + 40));
for (const r of results) {
  console.log(
    `${r.name.padEnd(pad)}  ${`${r.meanMs.toFixed(3)}ms`.padStart(9)}  ${`${r.p95Ms.toFixed(3)}ms`.padStart(9)}  ${r.opsPerSecond.toFixed(0).padStart(10)}   ${r.note}`,
  );
}
console.log();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ width: WIDTH, height: HEIGHT, platform: process.platform, results }, null, 2));
}
