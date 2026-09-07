/**
 * Collapsed borders: `bun examples/collapse.ts`.
 *
 * Off by default, because it changes every layout that has two panels side by
 * side. Turn it on once for the whole screen and adjacent panels share an edge
 * instead of drawing two of them, the way CSS collapses table borders.
 *
 * Only panels collapse. A widget pressed against a panel edge keeps its own
 * shape, so a table does not grow junctions out of its rows.
 */
import { renderToText } from "@profullstack/hqtui";
import type { Container } from "@profullstack/hqtui";

const view = ({ ui }: { ui: Container }) => {
  ui.row({ size: 5 }, (row) => {
    row.panel({ title: "CPU" }, (p) => p.meter({ label: "all", value: 0.62 }));
    row.panel({ title: "Memory" }, (p) => p.meter({ label: "used", value: 0.31 }));
    row.panel({ title: "Disk" }, (p) => p.meter({ label: "root", value: 0.87 }));
  });
  ui.row({ size: 4 }, (row) => {
    row.panel({ title: "Network" }, (p) => p.sparkline({ values: [3, 7, 2, 9, 4, 8, 6], label: "rx " }));
    row.panel({ title: "Errors" }, (p) => p.text("none"));
  });
};

for (const collapseBorders of [false, true]) {
  console.log(collapseBorders ? "--- collapsed ---" : "--- default ---");
  console.log(renderToText(view, { width: 60, height: 9, collapseBorders }));
}
