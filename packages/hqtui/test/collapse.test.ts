import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToText } from "../src/testing.ts";
import { borderBits, borderGlyph, EDGE_DOWN, EDGE_LEFT, EDGE_RIGHT, EDGE_UP } from "../src/surface.ts";

function twoPanels(collapseBorders: boolean): string[] {
  return renderToText(
    ({ ui }) => {
      ui.row({ size: 3 }, (row) => {
        row.panel({ title: "A", size: 8 }, () => {});
        row.panel({ title: "B", size: 8 }, () => {});
      });
    },
    { width: 16, height: 3, collapseBorders },
  ).split("\n");
}

test("off by default, two panels keep their own borders", () => {
  const lines = twoPanels(false);
  assert.match(lines[0] ?? "", /╮╭/);
  assert.match(lines[1] ?? "", /││/);
  assert.match(lines[2] ?? "", /╯╰/);
});

test("collapsed, the shared edge becomes one line with junctions", () => {
  const lines = twoPanels(true);
  assert.match(lines[0] ?? "", /┬/);
  assert.doesNotMatch(lines[0] ?? "", /╮╭/);
  assert.doesNotMatch(lines[1] ?? "", /││/);
  assert.match(lines[2] ?? "", /┴/);
  assert.doesNotMatch(lines[2] ?? "", /╯╰/);
});

test("two fixed panels give a column back when they share an edge", () => {
  // Both panels asked for 8 columns and still get 8. What changes is that they
  // overlap by one, so the pair occupies 15 columns rather than 16.
  assert.equal((twoPanels(false)[0] ?? "").length, 16);
  const merged = twoPanels(true)[0] ?? "";
  assert.equal(merged.length, 15);
  // Exactly one seam, not one per border character along the top.
  assert.equal(merged.split("┬").length - 1, 1);
});

test("stacked panels collapse horizontally too", () => {
  const lines = renderToText(
    ({ ui }) => {
      ui.column({}, (col) => {
        col.panel({ title: "A", size: 3 }, () => {});
        col.panel({ title: "B", size: 3 }, () => {});
      });
    },
    { width: 12, height: 6, collapseBorders: true },
  ).split("\n");
  assert.ok(lines.some((line) => line.includes("├") && line.includes("┤")));
});

test("an explicit gap is respected rather than collapsed away", () => {
  const out = renderToText(
    ({ ui }) => {
      ui.row({ size: 3, gap: 1 }, (row) => {
        row.panel({ title: "A", size: 7 }, () => {});
        row.panel({ title: "B", size: 7 }, () => {});
      });
    },
    { width: 16, height: 3, collapseBorders: true },
  );
  assert.match(out.split("\n")[0] ?? "", /╮ ╭/);
});

test("only bordered siblings collapse", () => {
  // A panel beside plain text must not pull the text into its frame.
  const out = renderToText(
    ({ ui }) => {
      ui.row({ size: 3 }, (row) => {
        row.panel({ title: "A", size: 8 }, () => {});
        row.text("plain", { size: 8 });
      });
    },
    { width: 16, height: 3, collapseBorders: true },
  );
  assert.match(out, /plain/);
  assert.doesNotMatch(out.split("\n")[0] ?? "", /┬/);
});

test("edge bits round-trip through the glyph tables", () => {
  assert.equal(borderBits("┬".codePointAt(0) ?? 0), EDGE_LEFT | EDGE_RIGHT | EDGE_DOWN);
  assert.equal(borderBits("╯".codePointAt(0) ?? 0), EDGE_UP | EDGE_LEFT);
  assert.equal(borderBits("x".codePointAt(0) ?? 0), null);
  // A top-right meeting a top-left is the T that joins them.
  const union = (borderBits("╮".codePointAt(0) ?? 0) ?? 0) | (borderBits("╭".codePointAt(0) ?? 0) ?? 0);
  assert.equal(borderGlyph("rounded", union), "┬");
});

test("a wrapping column blocks the merge unless it says its edges are borders", () => {
  // The only way to put a stack of panels beside one tall panel is to wrap the
  // stack in a column, and a column is not itself bordered -- so the seam down
  // the middle of the screen was the one seam that could never merge.
  const render = (bordered: boolean) =>
    renderToText(
      ({ ui }) => {
        ui.row({ size: 6 }, (row) => {
          row.panel({ title: "A", size: 8 }, () => {});
          row.column({ size: 8, bordered }, (col) => {
            col.panel({ title: "B", size: 3 }, () => {});
            col.panel({ title: "C", size: 3 }, () => {});
          });
        });
      },
      { width: 16, height: 6, collapseBorders: true },
    ).split("\n");

  const plain = render(false);
  assert.match(plain[0] ?? "", /╮╭/);
  assert.match(plain[1] ?? "", /││/);

  const merged = render(true);
  assert.match(merged[0] ?? "", /┬/);
  assert.doesNotMatch(merged[0] ?? "", /╮╭/);
  assert.doesNotMatch(merged[1] ?? "", /││/);
});

test("a grid of panels merges its tracks, and one cell that is not a panel stops it", () => {
  const grid = (allPanels: boolean) =>
    renderToText(
      ({ ui }) => {
        ui.grid({ columns: 2, rows: 1 }, (g) => {
          g.panel({ title: "A" }, () => {});
          if (allPanels) g.panel({ title: "B" }, () => {});
          else g.cell({}, (c) => c.label("B"));
        });
      },
      { width: 16, height: 3, collapseBorders: true },
    ).split("\n");

  assert.match(grid(true)[0] ?? "", /┬/);
  assert.doesNotMatch(grid(true)[0] ?? "", /╮╭/);
  // A cell drawing no border would have a neighbour's line across its text.
  assert.doesNotMatch(grid(false)[0] ?? "", /┬/);
});

test("a panel with a background still merges, rather than filling the seam away", () => {
  // The fill runs before the border is drawn, so filling the whole rect wiped
  // the neighbour's border out of the shared column; the merge then found a
  // blank cell and overwrote it, leaving a corner where a junction belonged.
  const lines = renderToText(
    ({ ui }) => {
      ui.row({ size: 3 }, (row) => {
        row.panel({ title: "A", size: 8, background: "#202020" }, () => {});
        row.panel({ title: "B", size: 8, background: "#303030" }, () => {});
      });
    },
    { width: 16, height: 3, collapseBorders: true },
  ).split("\n");
  assert.match(lines[0] ?? "", /┬/);
  assert.doesNotMatch(lines[0] ?? "", /╮╭/);
  assert.match(lines[2] ?? "", /┴/);
});
