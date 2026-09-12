import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen } from "../src/testing.ts";
import { hoverBg } from "../src/widgets/table.ts";
import { resolveTheme } from "../src/theme.ts";
import { countClicks, DOUBLE_CLICK_MS } from "../src/ui.ts";
import { InputParser } from "../src/input.ts";
import type { MouseEvent } from "../src/input.ts";

/**
 * Everything a click can land on, driven through the same hit-test the app
 * uses. Before these, a status bar item, a modal button and a panel border
 * were all things a mouse could point at and nothing would answer.
 */

test("a status bar item with onPress claims exactly the cells it drew", () => {
  const pressed: string[] = [];
  const screen = renderToScreen(({ ui }) => {
    ui.statusBar({
      items: [
        { key: "F1", label: "Help", onPress: () => pressed.push("help") },
        { key: "q", label: "Quit" },
        { label: "Sync", onPress: () => pressed.push("sync") },
      ],
      right: [{ key: "?", label: "keys", onPress: () => pressed.push("keys") }],
    });
  }, { width: 40, height: 1 });

  // Only the two left items and the right item that asked are regions; the
  // one without a handler is not, so a click on it falls through.
  assert.equal(screen.regions.length, 3);

  const help = screen.find("Help")!;
  assert.ok(screen.click(help.x, help.y));
  assert.ok(screen.click(help.x - 3, help.y), "the key cap is part of the item");
  assert.deepEqual(pressed, ["help", "help"]);

  const quit = screen.find("Quit")!;
  assert.equal(screen.click(quit.x, quit.y), false, "an item with no handler is not clickable");

  const keys = screen.find("keys")!;
  assert.ok(screen.click(keys.x, keys.y));
  assert.deepEqual(pressed, ["help", "help", "keys"]);

  // The gap between two items belongs to neither.
  const sync = screen.find("Sync")!;
  assert.equal(screen.click(sync.x - 1, sync.y), false);
  assert.ok(screen.click(sync.x + 3, sync.y), "the last cell of the label still counts");
  assert.deepEqual(pressed, ["help", "help", "keys", "sync"]);
});

test("a modal's buttons press, its backdrop dismisses, and its body swallows", () => {
  const log: string[] = [];
  let behind = 0;
  const screen = renderToScreen(({ ui }) => {
    ui.table({
      rows: [{ n: "a" }, { n: "b" }, { n: "c" }],
      columns: [{ key: "n" }],
      header: false,
      onSelectRow: () => behind++,
    });
    ui.modal({
      title: "Sure?",
      message: "Delete it",
      width: 30,
      height: 7,
      onDismiss: () => log.push("dismiss"),
      buttons: [
        { label: "Yes", variant: "success", onPress: () => log.push("yes") },
        { label: "No", variant: "ghost", onPress: () => log.push("no") },
      ],
    });
  }, { width: 60, height: 20 });

  const yes = screen.find("Yes")!;
  const no = screen.find("No")!;
  assert.ok(screen.click(yes.x, yes.y));
  assert.ok(screen.click(no.x + 1, no.y));
  assert.deepEqual(log, ["yes", "no"]);

  // Inside the dialog but not on a button: taken, and nothing happens.
  const title = screen.find("Delete it")!;
  assert.ok(screen.click(title.x, title.y));
  assert.deepEqual(log, ["yes", "no"]);

  // Outside the dialog: the backdrop dismisses, and the table underneath,
  // which would otherwise have selected row 0, never hears about it.
  assert.ok(screen.click(0, 0));
  assert.deepEqual(log, ["yes", "no", "dismiss"]);
  assert.equal(behind, 0);
});

test("a modal with no onDismiss still keeps clicks off what it covers", () => {
  let behind = 0;
  const screen = renderToScreen(({ ui }) => {
    ui.table({ rows: [{ n: "a" }], columns: [{ key: "n" }], header: false, onSelectRow: () => behind++ });
    ui.modal({ title: "Wait", message: "Working" });
  }, { width: 40, height: 12 });
  assert.ok(screen.click(0, 0));
  assert.ok(screen.click(0, 1));
  assert.equal(behind, 0);
});

test("widgets built inside a modal still take their own clicks", () => {
  let row = -1;
  const screen = renderToScreen(({ ui }) => {
    ui.modal({ title: "Pick", width: 30, height: 8 }, (modal) => {
      modal.table({
        rows: [{ n: "alpha" }, { n: "beta" }],
        columns: [{ key: "n" }],
        header: false,
        onSelectRow: (r) => { row = r; },
      });
    });
  }, { width: 50, height: 16 });
  const beta = screen.find("beta")!;
  assert.ok(screen.click(beta.x, beta.y));
  assert.equal(row, 1);
});

test("a panel answers for the cells its children did not claim", () => {
  const log: string[] = [];
  const screen = renderToScreen(({ ui }) => {
    ui.panel({ title: " Files ", onClick: (_x, y) => log.push(`panel:${y}`) }, (panel) => {
      panel.table({
        rows: [{ n: "one" }, { n: "two" }],
        columns: [{ key: "n" }],
        header: false,
        size: 2,
        onSelectRow: (r) => log.push(`row:${r}`),
      });
    });
  }, { width: 30, height: 10 });

  // The title row is the panel's; a row of the table is the table's; the
  // empty space under a short table is the panel's again.
  assert.ok(screen.click(3, 0));
  const two = screen.find("two")!;
  assert.ok(screen.click(two.x, two.y));
  // "two" is drawn on screen row 2 (title row, then a row each), so four
  // rows below it is row 6 of the panel.
  assert.ok(screen.click(two.x, two.y + 4));
  assert.deepEqual(log, ["panel:0", "row:1", "panel:6"]);
});

test("a panel without onClick claims nothing", () => {
  const screen = renderToScreen(({ ui }) => {
    ui.panel({ title: " Quiet " }, (panel) => panel.text("hi"));
  }, { width: 20, height: 5 });
  assert.equal(screen.regions.length, 0);
  assert.equal(screen.click(1, 1), false);
});

test("a double-click on a row selects it and then activates it", () => {
  const log: string[] = [];
  const screen = renderToScreen(({ ui }) => {
    ui.table({
      rows: [{ n: "src" }, { n: "README" }],
      columns: [{ key: "n" }],
      header: false,
      onSelectRow: (r) => log.push(`select:${r}`),
      onActivateRow: (r) => log.push(`open:${r}`),
    });
  }, { width: 20, height: 4 });

  screen.click(0, 0);
  screen.click(0, 0, { clicks: 2 });
  assert.deepEqual(log, ["select:0", "select:0", "open:0"]);
});

test("onActivateRow alone is enough to make a table clickable", () => {
  let opened = -1;
  const screen = renderToScreen(({ ui }) => {
    ui.table({ rows: [{ n: "a" }, { n: "b" }], columns: [{ key: "n" }], onActivateRow: (r) => { opened = r; } });
  }, { width: 20, height: 4 });
  assert.equal(screen.regions.length, 1);
  // Row 0 is the header.
  screen.click(0, 2, { clicks: 2 });
  assert.equal(opened, 1);
  // A header click activates nothing.
  screen.click(0, 0, { clicks: 2 });
  assert.equal(opened, 1);
});

test("the wheel reaches the region under it through the test screen too", () => {
  let delta = 0;
  const screen = renderToScreen(({ ui }) => {
    ui.log({ entries: [{ message: "x" }], onScroll: (d) => { delta += d; } });
  }, { width: 20, height: 3 });
  assert.ok(screen.scroll(0, 0, 1));
  assert.ok(screen.scroll(0, 0, -1));
  assert.equal(delta, 0);
  assert.ok(screen.scroll(0, 0, 1));
  assert.equal(delta, 1);
});

test("presses are counted into clicks by time, row and button", () => {
  const first = { at: 1000, x: 5, y: 3, button: "left" };
  assert.equal(countClicks(null, first), 1);
  const one = { ...first, clicks: 1 };
  // Same cell, inside the window: a double-click.
  assert.equal(countClicks(one, { at: 1000 + DOUBLE_CLICK_MS, x: 5, y: 3, button: "left" }), 2);
  // A column either way is the hand slipping, not a different target.
  assert.equal(countClicks(one, { at: 1100, x: 6, y: 3, button: "left" }), 2);
  // Two columns is a different target.
  assert.equal(countClicks(one, { at: 1100, x: 7, y: 3, button: "left" }), 1);
  // Another row, another button, or too slow: back to one.
  assert.equal(countClicks(one, { at: 1100, x: 5, y: 4, button: "left" }), 1);
  assert.equal(countClicks(one, { at: 1100, x: 5, y: 3, button: "right" }), 1);
  assert.equal(countClicks(one, { at: 1000 + DOUBLE_CLICK_MS + 1, x: 5, y: 3, button: "left" }), 1);
  // A third press keeps counting, so a triple-click is distinguishable.
  assert.equal(countClicks({ ...one, clicks: 2 }, { at: 1200, x: 5, y: 3, button: "left" }), 3);
});

test("the parser reports every press as a single click", () => {
  const [event] = new InputParser().parse("\x1b[<0;10;5M") as MouseEvent[];
  assert.equal(event.clicks, 1);
});

test("a hovered row is lit, and the pointer reaches onHoverRow", () => {
  const seen: (number | null)[] = [];
  const theme = resolveTheme(undefined);
  const screen = renderToScreen(({ ui }) => {
    ui.table({
      rows: [{ n: "a" }, { n: "b" }, { n: "c" }],
      columns: [{ key: "n" }],
      selected: 0,
      hovered: 1,
      onHoverRow: (row) => seen.push(row),
    });
  }, { width: 20, height: 5 });
  // Row 0 is the header; body row 1 is "b", drawn on screen row 2.
  assert.equal(screen.cell(0, 2).bg, hoverBg(theme));
  assert.equal(screen.cell(0, 1).bg, theme.selection, "selection wins over hover");
  assert.equal(screen.cell(0, 3).bg, theme.background);
  assert.ok(screen.hover(0, 3));
  assert.ok(screen.hover(0, 0));
  assert.deepEqual(seen, [2, null]);
});

test("a tree reports every row it drew, and lights the hovered one", () => {
  const drawn: [string, number, number][] = [];
  const theme = resolveTheme(undefined);
  const screen = renderToScreen(({ ui }) => {
    ui.tree({
      nodes: [
        { label: "src", expanded: true, children: [{ label: "a.ts" }, { label: "b.ts" }] },
        { label: "README" },
      ],
      selected: 3,
      hovered: 1,
      onRow: (node, index, y) => drawn.push([node.label, index, y]),
    });
  }, { width: 20, height: 4 });
  assert.deepEqual(drawn, [["src", 0, 0], ["a.ts", 1, 1], ["b.ts", 2, 2], ["README", 3, 3]]);
  assert.equal(screen.cell(0, 1).bg, hoverBg(theme));
  assert.equal(screen.cell(0, 3).bg, theme.selection);
});

test("a tree can scroll with a bar, and onRow tells where the window starts", () => {
  const drawn: number[] = [];
  const nodes = Array.from({ length: 12 }, (_, i) => ({ label: `row-${i}` }));
  const screen = renderToScreen(({ ui }) => {
    ui.tree({ nodes, selected: 9, followSelection: true, scrollbar: true, onRow: (_n, i) => drawn.push(i) });
  }, { width: 20, height: 4 });
  assert.deepEqual(drawn, [6, 7, 8, 9]);
  assert.ok(screen.contains("row-9"));
  assert.ok(!screen.contains("row-0"));
});
