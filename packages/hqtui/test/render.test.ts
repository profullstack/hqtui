import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen, renderToText, renderToHtml } from "../src/testing.ts";
import { themes } from "../src/theme.ts";
import { hex } from "../src/color.ts";

test("hello world renders inside a panel", () => {
  const text = renderToText(({ ui }) => {
    ui.panel({ title: "Hello" }, (p) => p.text("Hello, terminal."));
  }, { width: 30, height: 5 });
  assert.ok(text.includes("Hello, terminal."));
  assert.ok(text.includes("╭"), "expected a rounded border by default");
  assert.ok(text.split("\n").every((line) => line.length <= 30));
});

test("nothing is drawn outside the screen", () => {
  const screen = renderToScreen(({ ui }) => {
    ui.panel({ title: "A very long title that will not fit at all" }, (p) => {
      p.text("x".repeat(500));
    });
  }, { width: 20, height: 6 });
  for (const line of screen.text().split("\n")) assert.ok(line.length <= 20);
});

test("a grid places panels in the cells it was given", () => {
  const screen = renderToScreen(({ ui }) => {
    ui.grid({ columns: 2, rows: 1 }, (g) => {
      g.panel({ title: "Left" });
      g.panel({ title: "Right" });
    });
  }, { width: 40, height: 5 });
  const left = screen.find("Left");
  const right = screen.find("Right");
  assert.ok(left && right);
  assert.ok(right!.x > left!.x, "the second panel should sit to the right");
  assert.equal(left!.y, right!.y);
});

test("colSpan makes a panel span both columns", () => {
  const screen = renderToScreen(({ ui }) => {
    ui.grid({ columns: 2, rows: 2 }, (g) => {
      g.panel({ title: "Top" });
      g.panel({ title: "Side" });
      g.panel({ title: "Wide", colSpan: 2 });
    });
  }, { width: 40, height: 10 });
  const wide = screen.find("Wide");
  assert.ok(wide);
  assert.equal(screen.line(wide!.y).length, 40);
});

test("a meter fills proportionally", () => {
  const empty = renderToText(({ ui }) => ui.meter({ value: 0, label: "CPU" }), { width: 20, height: 1 });
  const full = renderToText(({ ui }) => ui.meter({ value: 1, label: "CPU" }), { width: 20, height: 1 });
  assert.ok(empty.includes("0%"));
  assert.ok(full.includes("100%"));
  assert.ok((full.match(/█/g) ?? []).length > (empty.match(/█/g) ?? []).length);
});

test("a table aligns columns and honours selection", () => {
  const screen = renderToScreen(({ ui }) => {
    ui.table({
      rows: [{ pid: 1, name: "init" }, { pid: 4242, name: "bun" }],
      columns: [
        { key: "pid", title: "PID", width: 6, align: "right" },
        { key: "name", title: "Name" },
      ],
      selected: 1,
    });
  }, { width: 24, height: 4 });
  assert.ok(screen.contains("PID"));
  assert.ok(screen.contains("4242"));
  const selected = screen.find("bun");
  assert.ok(selected);
  assert.equal(screen.cell(0, selected!.y).bg, themes.dark.selection);
});

test("a graph draws braille pixels", () => {
  const values = Array.from({ length: 50 }, (_, i) => Math.sin(i / 4) * 50 + 50);
  const text = renderToText(({ ui }) => ui.graph({ values, min: 0, max: 100 }), { width: 40, height: 6 });
  assert.ok(/[⠀-⣿]/.test(text), "expected braille glyphs");
});

test("a graph degrades to block glyphs when braille is off", () => {
  const values = Array.from({ length: 20 }, (_, i) => i);
  const text = renderToText(({ ui }) => ui.graph({ values, mode: "block" }), { width: 20, height: 4 });
  assert.ok(!/[⠀-⣿]/.test(text));
  assert.ok(/[█▁-▇]/.test(text));
});

test("themes change colors without changing layout", () => {
  const view = ({ ui }: { ui: any }) => ui.panel({ title: "T" }, (p: any) => p.text("body"));
  const dark = renderToScreen(view, { width: 20, height: 4, theme: "dark" });
  const nord = renderToScreen(view, { width: 20, height: 4, theme: "nord" });
  assert.equal(dark.text(), nord.text());
  assert.notEqual(dark.cell(0, 0).bg, nord.cell(0, 0).bg);
});

test("the dark theme is the default", () => {
  const screen = renderToScreen(({ ui }) => ui.text("x"), { width: 5, height: 1 });
  assert.equal(screen.cell(0, 0).bg, themes.dark.background);
});

test("a modal draws on top of the content behind it", () => {
  const screen = renderToScreen(({ ui }) => {
    ui.panel({ title: "Behind" }, (p) => p.text("background content"));
    ui.modal({ title: "Confirm", message: "Are you sure?", buttons: [{ label: "Yes" }, { label: "No" }] });
  }, { width: 50, height: 14 });
  assert.ok(screen.contains("Confirm"));
  assert.ok(screen.contains("Are you sure?"));
  assert.ok(screen.contains("Yes"));
});

test("responsive picks a layout by width", () => {
  const view = ({ ui }: { ui: any }) =>
    ui.responsive({
      100: (wide: any) => wide.text("WIDE LAYOUT"),
      0: (narrow: any) => narrow.text("COMPACT"),
    });
  assert.ok(renderToText(view, { width: 120, height: 3 }).includes("WIDE LAYOUT"));
  assert.ok(renderToText(view, { width: 40, height: 3 }).includes("COMPACT"));
});

test("tiny terminals do not throw", () => {
  for (const [w, h] of [[1, 1], [2, 2], [5, 3], [0, 0]]) {
    assert.doesNotThrow(() => {
      renderToText(({ ui }) => {
        ui.grid({ columns: 3, rows: 3 }, (g) => {
          g.panel({ title: "A" }, (p) => p.meter({ value: 0.5, label: "x" }));
          g.panel({ title: "B" }, (p) => p.graph({ values: [1, 2, 3] }));
        });
      }, { width: w, height: h });
    }, `crashed at ${w}x${h}`);
  }
});

test("HTML output carries the cell colors", () => {
  const html = renderToHtml(({ ui }) => ui.text("colored", { fg: hex("#ff0000") }), { width: 10, height: 1 });
  assert.ok(html.includes("#ff0000"));
  assert.ok(html.startsWith("<pre"));
});

test("escape hatch drawing reaches the buffer", () => {
  const screen = renderToScreen(({ ui }) => {
    ui.draw((surface) => surface.text(0, 0, "raw"));
  }, { width: 10, height: 2 });
  assert.ok(screen.contains("raw"));
});
