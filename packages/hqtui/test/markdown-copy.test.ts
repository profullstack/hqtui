import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { App } from "../src/app.ts";
import { clipboardSequence } from "../src/markdown.ts";
import { renderToScreen } from "../src/testing.ts";

test("copy exports full semantic values and context, excluding clipped data rows", () => {
  const value = "Long value that cannot fit in this narrow summary pane";
  const screen = renderToScreen(({ ui }) => ui.panel({ title: "Status", subtitle: "30 days", footer: "Partial data" }, (p) => {
    p.text([{ text: "Connected ", bold: true }, { text: "but incomplete" }]);
    p.keyValues([{ label: "Provider:", value }, { label: "Error", value: "payouts: unavailable" }]);
    p.table({ columns: [{ key: "value", title: "Row" }], rows: [{ value: "DO NOT EXPORT ROWS" }] });
  }), { width: 38, height: 5, copyMarkdown: true, markdownContext: "CrawlProof · 1m · humans" });
  assert.equal(screen.copied.length, 0);
  const icon = screen.find("⧉ MD")!;
  assert.ok(icon);
  assert.ok(screen.click(icon.x, icon.y));
  assert.equal(screen.copied[0], `## Status\n\nCrawlProof · 1m · humans\n\n30 days\n\nConnected but incomplete\n\n- **Provider:** ${value}\n- **Error:** payouts: unavailable\n\nPartial data\n`);
  assert.ok(!screen.text().includes(value), "the export must not scrape the clipped frame");
});

test("copy icon is opt-in; data-only and disabled panels keep their headers", () => {
  for (const copyMarkdown of [undefined, false]) {
    const screen = renderToScreen(({ ui }) => ui.panel({ title: "Summary", copyMarkdown }, (p) => p.text("Info")));
    assert.ok(!screen.contains("⧉"));
  }
  const view = ({ ui }: Parameters<Parameters<typeof renderToScreen>[0]>[0]) => ui.panel({ title: "Rows", subtitle: "complete" }, (p) => p.table({ columns: [{ key: "id", title: "ID" }], rows: [{ id: "1" }] }));
  assert.equal(renderToScreen(view, { width: 30, copyMarkdown: true }).text(), renderToScreen(view, { width: 30 }).text());
  assert.ok(!renderToScreen(({ ui }) => ui.panel({ title: "Private", copyMarkdown: false }, (p) => p.text("Info")), { copyMarkdown: true }).contains("⧉"));
});

test("explicit Markdown is computed only on activation; right click does not copy", () => {
  let calls = 0;
  let value = "ready";
  const screen = renderToScreen(({ ui }) => ui.panel({ title: "Feature", copyMarkdown: () => { calls++; return `## Feature\n\n${value}\n`; } }));
  assert.equal(calls, 0);
  value = "updated";
  const icon = screen.find("⧉ MD")!;
  screen.click(icon.x, icon.y, { button: "right" });
  assert.equal(calls, 0);
  screen.click(icon.x, icon.y);
  assert.deepEqual(screen.copied, ["## Feature\n\nupdated\n"]);
});

test("nested summaries, graph summaries and Markdown punctuation remain readable", () => {
  const screen = renderToScreen(({ ui }) => ui.panel({ title: "a[b]", copyMarkdown: true }, (p) => {
    p.column({ size: 2 }, (child) => child.keyValues([{ label: "name_*", value: "<tag>\nnext" }]));
    p.graph({ series: [{ label: "income", values: [1, 4, 2] }], axisFormat: (n) => `$${n}` });
  }));
  const icon = screen.find("⧉ MD")!;
  screen.click(icon.x, icon.y);
  assert.match(screen.copied[0], /name\\_\\\*/);
  assert.ok(screen.copied[0].includes("\\<tag\\>\n  next"));
  assert.ok(screen.copied[0].includes("Latest: $2; min: $1; max: $4; 3 samples"));
});

test("nested grids preserve summary order and opt-outs exclude content from parent exports", () => {
  const screen = renderToScreen(({ ui }) => ui.panel({ title: "Outer", copyMarkdown: true }, (p) => {
    p.text("Before");
    p.grid({ columns: 2 }, (g) => {
      g.panel({ title: "Nested" }, (inner) => inner.text("Nested info"));
      g.panel({ title: "Private", copyMarkdown: false }, (inner) => inner.text("DO NOT EXPORT"));
    });
    p.text("After");
  }));
  const icon = screen.find("⧉ MD")!;
  screen.click(icon.x, icon.y);
  assert.match(screen.copied[0], /Before[\s\S]*Nested info[\s\S]*After/);
  assert.ok(!screen.copied[0].includes("DO NOT EXPORT"));
});

test("copy controls remain inside narrow/ASCII panes, and leave missing top borders alone", () => {
  for (const width of [9, 12, 18, 30]) {
    const screen = renderToScreen(({ ui }) => ui.panel({ title: "Long title with wide 字 glyphs", subtitle: "Subtitle", copyMarkdown: "# Summary" }), { width, height: 4, capabilities: { unicode: false } });
    const icon = screen.find(width >= 18 ? "C MD" : "C")!;
    assert.ok(icon);
    assert.equal(screen.cell(width - 1, 0).char, "╮");
    screen.click(icon.x, icon.y);
    assert.deepEqual(screen.copied, ["# Summary"]);
    assert.ok(screen.regions.every((r) => r.rect.x >= 0 && r.rect.x + r.rect.width <= width));
  }
  const borderless = renderToScreen(({ ui }) => ui.panel({ sides: ["bottom"], copyMarkdown: true }, (p) => p.text("Text")));
  assert.ok(!borderless.contains("⧉"));
});

test("modal help and standalone status controls export without closing the dialog", () => {
  let closed = false;
  const screen = renderToScreen(({ ui }) => {
    ui.copyButton({ markdown: "## Status\n\nReady" });
    ui.modal({ title: "Help", message: "Read this\nThen do that", onDismiss: () => { closed = true; } });
  }, { copyMarkdown: true });
  const icon = screen.regions.at(-1)!;
  screen.click(icon.rect.x, icon.rect.y);
  assert.equal(closed, false);
  assert.deepEqual(screen.copied, ["## Help\n\nRead this\nThen do that\n"]);
});

test("OSC 52 encodes UTF-8 and tmux wrapping without evaluating clipboard content", () => {
  const content = "## Status\n\n✓ Ready — $(do-not-run)";
  const encoded = Buffer.from(content).toString("base64");
  assert.equal(clipboardSequence(content), `\x1b]52;c;${encoded}\x07`);
  assert.equal(clipboardSequence(content, true), `\x1bPtmux;\x1b\x1b]52;c;${encoded}\x07\x1b\\`);
  assert.throws(() => clipboardSequence("x".repeat(100_000)), /limit/);
});

test("Tab/Enter copy once without leaking into row activation or Space shortcuts", async (t) => {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  Object.assign(output, { columns: 80, rows: 24 });
  const copied: string[] = [];
  const app = new App({ input: input as never, output: output as never, installExitHandlers: false, quitKeys: [], copyMarkdown: true, clipboard: (text) => { copied.push(text); } });
  t.after(() => app.stop());
  const keys: string[] = [];
  app.on("key", (e) => keys.push(e.name));
  app.render(({ ui }) => ui.panel({ title: "Info" }, (p) => p.text("Ready")));
  void app.start();
  const key = async (bytes: string) => { input.write(bytes); await new Promise((resolve) => setTimeout(resolve, 0)); app.frame(); };
  await key("\r");
  assert.deepEqual(keys, ["enter"], "ordinary row Enter must still work before the user focuses Copy");
  await key("\t");
  await key("\r");
  await key(" ");
  assert.deepEqual(keys, ["enter"]);
  assert.deepEqual(copied, ["## Info\n\nReady\n", "## Info\n\nReady\n"]);
  await key("\x1b[B");
  await key("\r");
  assert.deepEqual(keys, ["enter", "down", "enter"], "returning to row navigation releases copy focus");
  assert.equal(copied.length, 2);
});

test("clipboard failures are contained and shown instead of crashing the application", async (t) => {
  const output = new PassThrough();
  let drawn = "";
  output.on("data", (data) => { drawn += data.toString(); });
  Object.assign(output, { columns: 80, rows: 24 });
  const app = new App({ output: output as never, installExitHandlers: false, clipboard: () => { throw new Error("clipboard denied"); } });
  t.after(() => app.stop());
  await app.copyToClipboard("# Summary");
  app.frame();
  assert.ok(drawn.includes("Copy failed: clipboard denied"));
  await app.copyToClipboard(() => { throw new Error("summary failed"); });
  app.frame();
});
