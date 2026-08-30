/** Braille, block and ASCII rendering side by side. `bun examples/graph.ts` */
import { createApp } from "@profullstack/hqtui";

const values = Array.from({ length: 400 }, (_, i) => Math.sin(i / 12) * 40 + 50);
const app = await createApp();

app.render(({ ui, theme }) => {
  ui.column({ gap: 1, padding: 1 }, (column) => {
    column.panel({ title: "braille — 2×4 pixels per cell" }, (p) =>
      p.graph({ values, min: 0, max: 100, fill: true, color: theme.accent }));
    column.panel({ title: "block" }, (p) =>
      p.graph({ values, min: 0, max: 100, mode: "block", colors: theme.heat }));
    column.panel({ title: "ascii" }, (p) =>
      p.graph({ values, min: 0, max: 100, mode: "ascii" }));
  });
});

await app.start();
