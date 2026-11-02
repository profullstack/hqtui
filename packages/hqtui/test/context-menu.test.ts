import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { App } from "../src/app.ts";
import { renderToScreen } from "../src/testing.ts";
import { tabMenuItems } from "../src/ui.ts";
import {
  contextMenuKey, contextMenuLayout, contextMenuStep, MENU_SEPARATOR, type ContextMenuItem,
} from "../src/widgets/context-menu.ts";
import type { KeyEvent } from "../src/input.ts";

const key = (name: string, extra: Partial<KeyEvent> = {}): KeyEvent =>
  ({ type: "key", name, key: name, ctrl: false, alt: false, shift: false, raw: "", ...extra });

const ITEMS: ContextMenuItem[] = [
  { label: "Reload from disk", hint: "ctrl+r" },
  MENU_SEPARATOR,
  { label: "Close tab" },
  { label: "Close all but this tab", disabled: true },
  { label: "Close all tabs" },
];

test("arrows skip separators and disabled items, and wrap", () => {
  assert.equal(contextMenuStep(ITEMS, -1, 1), 0, "down from nothing lands on the first item");
  assert.equal(contextMenuStep(ITEMS, -1, -1), 4, "up from nothing lands on the last item");
  assert.equal(contextMenuStep(ITEMS, 0, 1), 2, "the separator is skipped");
  assert.equal(contextMenuStep(ITEMS, 2, 1), 4, "the disabled item is skipped");
  assert.equal(contextMenuStep(ITEMS, 4, 1), 0, "wraps");
  assert.equal(contextMenuStep([MENU_SEPARATOR, { label: "x", disabled: true }], -1, 1), -1);
});

test("contextMenuKey: enter chooses, escape closes, a letter jumps", () => {
  assert.deepEqual(contextMenuKey(ITEMS, -1, key("down")), { selected: 0 });
  assert.deepEqual(contextMenuKey(ITEMS, 2, key("enter")), { selected: 2, activate: 2 });
  assert.deepEqual(contextMenuKey(ITEMS, -1, key("enter")), { selected: -1 }, "nothing highlighted, nothing chosen");
  assert.deepEqual(contextMenuKey(ITEMS, 2, key("escape")), { selected: 2, close: true });
  assert.equal(contextMenuKey(ITEMS, -1, key("c", { char: "c" })).selected, 2);
  assert.equal(contextMenuKey(ITEMS, 2, key("c", { char: "c" })).selected, 4, "the next match, past the disabled one");
  assert.equal(contextMenuKey(ITEMS, -1, key("end")).selected, 4);
});

test("the menu is clamped inside the screen: slides left, opens upward", () => {
  const open = contextMenuLayout(40, 12, { x: 38, y: 2, items: ITEMS });
  assert.ok(open.box.x + open.box.width <= 40, "never past the right edge");
  assert.equal(open.box.y, 2);
  assert.equal(open.box.height, ITEMS.length + 2);

  const low = contextMenuLayout(40, 12, { x: 3, y: 11, items: ITEMS });
  assert.equal(low.box.y + low.box.height - 1, 11, "opens upward from the bottom row");

  const tiny = contextMenuLayout(40, 4, { x: 0, y: 3, items: ITEMS });
  assert.equal(tiny.box.y, 0);
  assert.equal(tiny.box.height, 4);
  assert.equal(tiny.rows.length, 2, "only the rows that fit are laid out");
});

test("drawn menu: labels, hint, a separator joined to the frame, highlight", () => {
  const screen = renderToScreen(({ ui }) => { ui.text("background"); }, {
    width: 50, height: 12, contextMenu: { x: 4, y: 2, items: ITEMS, selected: 2 },
  });
  const reload = screen.find("Reload from disk")!;
  assert.ok(reload);
  assert.ok(screen.line(reload.y).includes("ctrl+r"));
  assert.ok(screen.line(reload.y + 1).includes("├"), "separator joins the left border");
  assert.ok(screen.line(reload.y + 1).includes("┤"), "and the right one");
  const close = screen.find("Close tab")!;
  assert.equal(screen.cell(close.x, close.y).bg, screen.cell(close.x + 1, close.y).bg);
  assert.notEqual(screen.cell(close.x, close.y).bg, screen.cell(reload.x, reload.y).bg, "the selected row is filled");
});

function tabsView(log: string[], extra: ContextMenuItem[] = []) {
  return ({ ui }: { ui: Parameters<Parameters<typeof renderToScreen>[0]>[0]["ui"] }) => {
    ui.tabs({
      tabs: ["README.md", "notes.md", "todo.md"],
      active: 0,
      onSelect: (i) => log.push(`select ${i}`),
      onClose: (i) => log.push(`close ${i}`),
      onCloseOthers: (i) => log.push(`others ${i}`),
      onCloseAll: () => log.push("all"),
      menu: extra,
    });
  };
}

test("right-click on a tab opens the default close actions under it", () => {
  const log: string[] = [];
  const first = renderToScreen(tabsView(log), { width: 60, height: 12 });
  const notes = first.find("notes.md")!;
  assert.ok(first.click(notes.x, notes.y, { button: "right" }));
  assert.deepEqual(log, [], "a right-click does not select the tab");
  const menu = first.menu!;
  assert.ok(menu, "a menu was opened");
  assert.deepEqual(menu.items.map((i) => i.label), ["Close tab", "Close all but this tab", "Close all tabs"]);
  assert.equal(menu.y, notes.y + 1, "just under the tab row");

  const second = renderToScreen(tabsView(log), { width: 60, height: 12, contextMenu: menu });
  const others = second.find("Close all but this tab")!;
  assert.ok(second.click(others.x, others.y));
  assert.deepEqual(log, ["others 1"], "the action names the right-clicked tab");
  assert.equal(second.menu, null, "choosing closes the menu");
});

test("extra items come first, then a rule, then the close actions", () => {
  const log: string[] = [];
  const reload = { label: "Reload from disk", onSelect: () => log.push("reload") };
  const items = tabMenuItems(0, 3, { onClose: () => {}, onCloseAll: () => {}, menu: [reload] });
  assert.deepEqual(items.map((i) => i.separator ? "---" : i.label), ["Reload from disk", "---", "Close tab", "Close all tabs"]);
  assert.equal(tabMenuItems(0, 1, { onCloseOthers: () => {} })[0].disabled, true, "nothing else to close");
  assert.deepEqual(tabMenuItems(0, 3, { menu: (i) => [{ label: `tab ${i}` }] }).map((i) => i.label), ["tab 0"]);

  const first = renderToScreen(tabsView(log, [reload]), { width: 60, height: 12 });
  const todo = first.find("todo.md")!;
  first.click(todo.x, todo.y, { button: "right" });
  const second = renderToScreen(tabsView(log, [reload]), { width: 60, height: 12, contextMenu: first.menu });
  const at = second.find("Reload from disk")!;
  second.click(at.x, at.y);
  assert.deepEqual(log, ["reload"]);
});

test("middle-click closes a tab; left-click still selects", () => {
  const log: string[] = [];
  const screen = renderToScreen(tabsView(log), { width: 60, height: 12 });
  const todo = screen.find("todo.md")!;
  screen.click(todo.x, todo.y, { button: "middle" });
  screen.click(todo.x, todo.y);
  assert.deepEqual(log, ["close 2", "select 2"]);
  assert.equal(screen.menu, null);
});

test("tabs with no close callbacks or menu keep the old right-click behaviour", () => {
  const log: string[] = [];
  const screen = renderToScreen(({ ui }) => {
    ui.tabs({ tabs: ["a", "b"], active: 0, onSelect: (i) => log.push(`select ${i}`) });
  }, { width: 30, height: 4 });
  const b = screen.find("b")!;
  screen.click(b.x, b.y, { button: "right" });
  assert.deepEqual(log, ["select 1"]);
  assert.equal(screen.menu, null);
});

test("disabled items and separators cannot be clicked; outside closes", () => {
  const log: string[] = [];
  const items: ContextMenuItem[] = [
    { label: "Copy", onSelect: () => log.push("copy") },
    MENU_SEPARATOR,
    { label: "Paste", disabled: true, onSelect: () => log.push("paste") },
  ];
  const screen = renderToScreen(() => {}, { width: 40, height: 10, contextMenu: { x: 2, y: 1, items } });
  const paste = screen.find("Paste")!;
  screen.click(paste.x, paste.y);
  assert.deepEqual(log, []);
  assert.ok(screen.menu, "still open");
  screen.click(paste.x, paste.y - 1);
  assert.ok(screen.menu, "the rule is part of the menu");
  screen.click(39, 9);
  assert.equal(screen.menu, null, "a click outside closes it");
});

test("hover moves the highlight", () => {
  const screen = renderToScreen(() => {}, { width: 40, height: 10, contextMenu: { x: 2, y: 1, items: ITEMS } });
  const close = screen.find("Close all tabs")!;
  screen.hover(close.x, close.y);
  assert.equal(screen.menu?.selected, 4);
});

test("contextArea: right-click anywhere inside opens its menu, left clicks pass through", () => {
  const log: string[] = [];
  const view = ({ ui }: { ui: Parameters<Parameters<typeof renderToScreen>[0]>[0]["ui"] }) => {
    ui.panel({ title: "Files", onClick: () => log.push("panel") }, (p) => {
      p.contextArea({ menu: (x, y) => [{ label: `New file at ${x},${y}` }] }, (area) => {
        area.list({ size: 2, items: [{ label: "a.txt" }, { label: "b.txt" }], onSelectRow: (r) => log.push(`row ${r}`) });
      });
    });
  };
  const screen = renderToScreen(view, { width: 40, height: 10 });
  const b = screen.find("b.txt")!;
  screen.click(b.x, b.y);
  assert.deepEqual(log, ["row 1"], "the list still gets left clicks");
  screen.click(b.x, b.y, { button: "right" });
  assert.ok(screen.menu, "a right-click on the list opens the area's menu");
  assert.equal(screen.menu!.x, b.x);
  assert.equal(screen.menu!.y, b.y);
  assert.match(screen.menu!.items[0].label, /^New file at \d+,1$/);

  const empty = renderToScreen(view, { width: 40, height: 10 });
  empty.click(5, 6);
  assert.deepEqual(log, ["row 1", "panel"], "a left click on empty space reaches the panel underneath");
});

test("a right-click on a dialog does not open the menu behind it", () => {
  const screen = renderToScreen(({ ui }) => {
    ui.contextArea({ menu: [{ label: "Behind" }] });
    ui.modal({ title: "Dialog", message: "hello", width: 20 });
  }, { width: 40, height: 12 });
  const hello = screen.find("hello")!;
  screen.click(hello.x, hello.y, { button: "right" });
  assert.equal(screen.menu, null);
  screen.click(0, 0, { button: "right" });
  assert.equal(screen.menu, null, "not on the backdrop either");
});

function harness() {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  Object.assign(output, { columns: 60, rows: 16 });
  const app = new App({
    input: input as unknown as NodeJS.ReadStream,
    output: output as unknown as NodeJS.WriteStream,
    installExitHandlers: false,
    quitKeys: [],
  });
  return {
    app,
    async send(bytes: string) {
      input.write(bytes);
      await new Promise((resolve) => setTimeout(resolve, bytes === "\x1b" ? 60 : 0));
      app.frame();
    },
  };
}

// SGR mouse: button 2 is right, 1 is middle; columns and rows are 1-based.
const sgr = (button: number, x: number, y: number) => `\x1b[<${button};${x + 1};${y + 1}M`;

test("in the app: right-click a tab, arrow down, Enter runs the action", async (t) => {
  const { app, send } = harness();
  t.after(() => app.stop());
  let tabs = ["one.md", "two.md", "three.md"];
  const leaked: string[] = [];
  app.on("key", (event) => leaked.push(event.key));
  app.render(({ ui }) => {
    ui.tabs({
      tabs,
      active: 0,
      onClose: (i) => { tabs = tabs.filter((_, j) => j !== i); },
      onCloseOthers: (i) => { tabs = [tabs[i]]; },
      onCloseAll: () => { tabs = []; },
    });
  });
  void app.start();
  app.frame();
  await send(sgr(2, 10, 0)); // right-click "two.md"
  assert.ok(app.contextMenu, "the menu is open");
  assert.equal(app.contextMenu!.selected, -1);
  await send("\x1b[B"); // down: Close tab
  await send("\x1b[B"); // down: Close all but this tab
  assert.equal(app.contextMenu!.selected, 1);
  await send("\r");
  assert.equal(app.contextMenu, null);
  assert.deepEqual(tabs, ["two.md"]);
  assert.deepEqual(leaked, [], "menu keys never reach the app");

  await send(sgr(2, 3, 0));
  assert.ok(app.contextMenu);
  await send("\x1b");
  assert.equal(app.contextMenu, null, "Escape closes it");
  assert.deepEqual(tabs, ["two.md"]);

  await send(sgr(1, 3, 0)); // middle-click
  assert.deepEqual(tabs, []);
});
