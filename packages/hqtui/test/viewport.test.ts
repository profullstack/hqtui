import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { App } from "../src/app.ts";
import { Terminal } from "../src/terminal.ts";

/** A terminal whose output we can read back, since the escapes are the contract. */
function fakeTty(columns = 20, rows = 10) {
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  let written = "";
  (output as unknown as PassThrough).on("data", (chunk) => { written += String(chunk); });
  Object.assign(output, { columns, rows });
  return { input, output, read: () => written, clear: () => { written = ""; } };
}

const options = {
  installExitHandlers: false,
  quitKeys: [] as string[],
  capabilities: { mouse: false, synchronizedOutput: false },
  bracketedPaste: false,
  focusEvents: false,
} as const;

test("viewport: fullscreen is still the default, alternate screen and all", () => {
  const tty = fakeTty();
  const terminal = new Terminal({ ...tty, installExitHandlers: false });
  assert.deepEqual(terminal.viewport, { mode: "fullscreen" });
  assert.deepEqual(terminal.viewportRect(), { x: 0, y: 0, width: 20, height: 10 });
  terminal.enter();
  assert.ok(tty.read().includes("\x1b[?1049h"), "took the alternate screen");
  terminal.restore();
});

test("viewport: inline neither takes the alternate screen nor clears what is there", () => {
  const tty = fakeTty();
  const terminal = new Terminal({
    ...tty,
    installExitHandlers: false,
    viewport: { mode: "inline", height: 3 },
  });
  terminal.enter();
  const out = tty.read();
  // The whole point is that the user's terminal survives.
  assert.ok(!out.includes("\x1b[?1049h"), "must not take the alternate screen");
  assert.ok(!out.includes("\x1b[2J"), "must not clear the screen");
  // Three rows reserved: two newlines to make the room, then back to the top.
  assert.ok(out.includes("\n\n"), "reserved its rows");
  assert.ok(out.includes("\x1b[2A"), "walked back to the first of them");
  assert.ok(out.endsWith("\x1b[0m\x1b7"), "reset the pen, then saved the anchor");
  terminal.restore();
});

test("viewport: inline asks for no more rows than the terminal has", () => {
  const tty = fakeTty(20, 4);
  const terminal = new Terminal({
    ...tty,
    installExitHandlers: false,
    viewport: { mode: "inline", height: 40 },
  });
  // A strip taller than the screen would scroll itself away every frame.
  assert.equal(terminal.viewportRect().height, 4);
});

test("viewport: leaving an inline app puts the cursor below its last frame", () => {
  const tty = fakeTty();
  const terminal = new Terminal({
    ...tty,
    installExitHandlers: false,
    viewport: { mode: "inline", height: 3 },
  });
  terminal.enter();
  tty.clear();
  terminal.restore();
  const out = tty.read();
  assert.ok(out.startsWith("\x1b8"), "went back to the anchor first");
  assert.equal((out.match(/\n/g) ?? []).length, 3, "then down past all three rows");
});

test("viewport: a fixed region is clamped to the terminal it is placed in", () => {
  const tty = fakeTty(20, 10);
  const terminal = new Terminal({
    ...tty,
    installExitHandlers: false,
    viewport: { mode: "fixed", x: 15, y: 8, width: 30, height: 30 },
  });
  assert.deepEqual(terminal.viewportRect(), { x: 15, y: 8, width: 5, height: 2 });
});

test("viewport: an app draws into its viewport, not the whole screen", async () => {
  const tty = fakeTty(20, 10);
  const app = new App({ ...tty, ...options, viewport: { mode: "inline", height: 3 } });
  app.render(({ ui }) => ui.text("hello"));
  assert.equal(app.height, 3, "the buffer is the strip, not the screen");
  assert.equal(app.width, 20);
  void app.start();
  await new Promise((r) => setImmediate(r));
  app.stop();
});

test("viewport: an inline frame is addressed from its saved anchor", async () => {
  const tty = fakeTty(20, 10);
  const app = new App({ ...tty, ...options, viewport: { mode: "inline", height: 2 } });
  let label = "hello";
  app.render(({ ui }) => ui.text(label));
  void app.start();
  await new Promise((r) => setImmediate(r));

  tty.clear();
  label = "goodbye";
  app.frame();
  const frame = tty.read();
  app.stop();

  // Absolute addressing is exactly what an inline strip cannot use: it does not
  // know its screen row, and a scroll moves it without saying so. Every jump in
  // a frame is measured from the saved anchor instead.
  assert.ok(frame.startsWith("\x1b8\x1b7\r"), `frame did not start at the anchor: ${JSON.stringify(frame)}`);
  assert.ok(!/\x1b\[\d+;\d+H/.test(frame), `frame used absolute addressing: ${JSON.stringify(frame)}`);
  assert.ok(frame.includes("goodbye"));
});

test("viewport: a fixed region offsets its addressing instead", async () => {
  const tty = fakeTty(40, 10);
  const app = new App({
    ...tty,
    ...options,
    viewport: { mode: "fixed", x: 4, y: 6, width: 10, height: 2 },
  });
  app.render(({ ui }) => ui.text("hi"));
  void app.start();
  await new Promise((r) => setImmediate(r));
  const out = tty.read();
  app.stop();
  // Row 7, column 5 in one-based terms: the region's own (0, 0).
  assert.ok(out.includes("\x1b[7;5H"), `expected the region's origin: ${JSON.stringify(out)}`);
});

test("viewport: insertBefore writes above the strip and leaves it anchored", async () => {
  const tty = fakeTty(20, 10);
  const app = new App({ ...tty, ...options, viewport: { mode: "inline", height: 2 } });
  app.render(({ ui }) => ui.text("live"));
  void app.start();
  await new Promise((r) => setImmediate(r));
  tty.clear();

  app.insertBefore(1, (ui) => ui.text("done"));
  const out = tty.read();
  app.stop();

  assert.ok(out.includes("done"), "the line was written");
  assert.ok(out.includes("live"), "and the strip was repainted after it");
  assert.ok(out.indexOf("done") < out.indexOf("live"), "the finished line goes above");
  // Re-anchored: the strip has to be findable again after the terminal may
  // have scrolled it.
  assert.ok(out.includes("\x1b7"), "saved the new anchor");
});

test("viewport: insertBefore is a no-op where there is no above", async () => {
  const tty = fakeTty(20, 10);
  const app = new App({ ...tty, ...options });
  app.render(({ ui }) => ui.text("live"));
  void app.start();
  await new Promise((r) => setImmediate(r));
  tty.clear();

  // A fullscreen app owns every row it can see; there is nothing to insert into.
  app.insertBefore(1, (ui) => ui.text("done"));
  assert.ok(!tty.read().includes("done"));
  app.stop();
});

test("viewport: every restore re-arms the save it just spent", async () => {
  const tty = fakeTty(24, 10);
  const app = new App({ ...tty, ...options, viewport: { mode: "inline", height: 3 } });
  let n = 0;
  app.render(({ ui }) => {
    ui.text(`step ${n}`);
    ui.meter({ label: "x", value: n / 5 });
    ui.text("working");
  });
  void app.start();
  await new Promise((r) => setImmediate(r));

  for (; n < 4; n++) {
    app.insertBefore(1, (ui) => ui.text(`ok ${n}`));
    app.frame();
  }
  const out = tty.read();
  app.stop();

  // DECRC pops the saved position in some terminals rather than peeking at it.
  // Spend the save without putting it back and the next restore sends the
  // cursor to the top of the user's screen -- which is where the whole strip
  // then redraws itself, over their shell. Every restore must re-arm.
  const restores = [...out.matchAll(/\x1b8/g)].map((m) => m.index ?? 0);
  assert.ok(restores.length > 4, `expected several restores, got ${restores.length}`);
  for (const at of restores) {
    // A pen reset may sit between the two; nothing that moves the cursor may.
    const after = out.slice(at + 2, at + 12);
    assert.ok(
      after.startsWith("\x1b7") || after.startsWith("\x1b[0m\x1b7"),
      `restore at ${at} left the save spent: ${JSON.stringify(out.slice(at, at + 14))}`,
    );
  }

  // And the finished lines are all there, in order.
  const order = ["ok 0", "ok 1", "ok 2", "ok 3"].map((line) => out.indexOf(line));
  assert.ok(order.every((at) => at >= 0), `a line went missing: ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "lines arrived out of order");
});
