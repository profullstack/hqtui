import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen } from "../src/index.ts";
import { dataGridCellAt, dataGridLayout, dataGridWidths, type DataGridOptions } from "../src/widgets/data-grid.ts";

const columns = [{ title: "name" }, { title: "city" }, { title: "age", align: "right" as const }];
const rows = [
  ["Ada", "London", "36"],
  ["Grace", "Arlington", "85"],
  ["Linus", "Helsinki", "54"],
];

const grid = (options: Partial<DataGridOptions> = {}, width = 40, height = 6) =>
  renderToScreen(({ ui }) => ui.dataGrid({ columns, rows, ...options }), { width, height });

test("dataGrid: a header, a row-number gutter and one line per row", () => {
  const screen = grid();
  assert.match(screen.line(0), /#\s+name\s+│\s*city\s+│\s+age│/);
  assert.match(screen.line(1), /^\s*1 Ada\s+│London\s+│\s+36│/);
  assert.match(screen.line(3), /^\s*3 Linus/);
});

test("dataGrid: order shows a sorted view and the gutter keeps each row's own number", () => {
  const screen = grid({ order: [2, 0], sort: { column: 0, descending: true } });
  assert.match(screen.line(0), /name ▼/);
  assert.match(screen.line(1), /^\s*3 Linus/);
  assert.match(screen.line(2), /^\s*1 Ada/);
  assert.equal(screen.line(3).trim(), "");
});

test("dataGrid: widths are the widest sampled value, capped", () => {
  assert.deepEqual(dataGridWidths(columns, rows), [6, 9, 5]);
  const long = [["x".repeat(200), "a", "1"]];
  assert.equal(dataGridWidths(columns, long, { maxColumnWidth: 12 })[0], 12);
  assert.equal(dataGridWidths([{ title: "n", width: 3 }], long)[0], 3);
});

test("dataGrid: the layout scrolls just far enough to show the cursor column", () => {
  const widths = [10, 10, 10, 10, 10];
  const start = dataGridLayout(25, widths, { gutter: 3 });
  assert.equal(start.columnOffset, 0);
  assert.deepEqual(start.more, { left: false, right: true });
  const right = dataGridLayout(25, widths, { gutter: 3, selectedColumn: 3 });
  assert.equal(right.columnOffset, 2);
  assert.ok(right.slots.some((slot) => slot.index === 3 && slot.width === 10));
  // Coming back left, the cursor column becomes the first one.
  assert.equal(dataGridLayout(25, widths, { gutter: 3, selectedColumn: 1, columnOffset: 3 }).columnOffset, 1);
  // Never scrolled past where the last column is already in view.
  assert.equal(dataGridLayout(25, widths, { columnOffset: 4 }).columnOffset, 3);
});

test("dataGrid: a cell maps back from a screen column", () => {
  const layout = dataGridLayout(40, [6, 9, 5], { gutter: 3 });
  assert.equal(dataGridCellAt(layout, 0), -1);
  assert.equal(dataGridCellAt(layout, 3), 0);
  assert.equal(dataGridCellAt(layout, 9), -1, "the separator is not a cell");
  assert.equal(dataGridCellAt(layout, 10), 1);
});

test("dataGrid: rows follow the cursor down", () => {
  const many = Array.from({ length: 50 }, (_, i) => [`n${i}`, "c", String(i)]);
  let frame: { rowOffset: number; capacity: number } | undefined;
  const screen = renderToScreen(
    ({ ui }) => ui.dataGrid({ columns, rows: many, selectedRow: 30, selectedColumn: 0, onLayout: (f) => (frame = f) }),
    { width: 40, height: 6 },
  );
  assert.equal(frame?.capacity, 5);
  assert.equal(frame?.rowOffset, 26);
  assert.match(screen.line(5), /^\s*31 n30/);
});

test("dataGrid: clicks land on cells, double-clicks activate, the header sorts", () => {
  const events: string[] = [];
  const screen = renderToScreen(
    ({ ui }) =>
      ui.dataGrid({
        columns,
        rows,
        onSelectCell: (row, column) => events.push(`select ${row},${column}`),
        onActivateCell: (row, column) => events.push(`open ${row},${column}`),
        onHeaderClick: (column) => events.push(`sort ${column}`),
      }),
    { width: 40, height: 6 },
  );
  assert.ok(screen.click(11, 2));
  assert.ok(screen.click(4, 3, { clicks: 2 }));
  assert.ok(screen.click(21, 0));
  assert.ok(screen.click(4, 5), "a click below the last row is swallowed, not misread");
  assert.deepEqual(events, ["select 1,1", "select 2,0", "open 2,0", "sort 2"]);
});

test("dataGrid: a multi-line cell shows its first line and a marker", () => {
  const screen = grid({ rows: [["two\nlines", "x", "1"]] });
  assert.match(screen.line(1), /two↵/);
});
