import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { App } from "../src/app.ts";

function fakeTty() {
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  // Swallow the escape sequences the terminal writes so they do not accumulate.
  (output as unknown as PassThrough).resume();
  Object.assign(output, { columns: 40, rows: 10 });
  return { input, output };
}

test("restarting an app does not double its input handling", async () => {
  const { input, output } = fakeTty();
  const app = new App({
    input,
    output,
    installExitHandlers: false,
    quitKeys: [],
    capabilities: { mouse: false },
    bracketedPaste: false,
    focusEvents: false,
  });
  app.render(({ ui }) => ui.text("x"));

  let keys = 0;
  app.on("key", () => keys++);

  // Three start/stop cycles. `Terminal.restore()` detaches from the stream but
  // keeps its listener sets, so an app that discarded its unsubscribes handled
  // each keystroke once more per cycle: 1, then 2, then 3.
  for (let cycle = 1; cycle <= 3; cycle++) {
    keys = 0;
    void app.start();
    (input as unknown as PassThrough).write("a");
    await new Promise((r) => setImmediate(r));
    app.stop();
    assert.equal(keys, 1, `cycle ${cycle} dispatched ${keys} events for one keypress`);
  }
});

test("stopping an app releases its terminal subscriptions", async () => {
  const { input, output } = fakeTty();
  const app = new App({
    input,
    output,
    installExitHandlers: false,
    quitKeys: [],
    capabilities: { mouse: false },
    bracketedPaste: false,
    focusEvents: false,
  });
  app.render(({ ui }) => ui.text("x"));

  let keys = 0;
  app.on("key", () => keys++);
  void app.start();
  app.stop();

  // Nothing is listening now, so a late chunk on the stream reaches no one.
  (input as unknown as PassThrough).write("z");
  await new Promise((r) => setImmediate(r));
  assert.equal(keys, 0);
});

test("a fatal error hands the decision to a host that has its own handler", async () => {
  // Counting listeners after `restore()` excludes hqtui's own — it is removed
  // by the cleanup handlers restore() runs — so one host handler read as none
  // and the library exited anyway, which was the whole point of the change.
  const { spawn } = await import("node:child_process");
  const program = (hosts: number) => `
    const { createApp } = await import(${JSON.stringify(new URL("../src/app.ts", import.meta.url).href)});
    const { PassThrough } = await import("node:stream");
    const input = new PassThrough(); const output = new PassThrough();
    let after = 0, armed = false;
    output.on("data", (c) => { if (armed) after += c.length; });
    Object.assign(output, { columns: 40, rows: 10 });
    ${Array.from({ length: hosts }, () => 'process.on("uncaughtException", () => {});').join("")}
    const app = await createApp({ input, output, quitKeys: [], fps: 120 });
    let n = 0;
    app.render(({ ui }) => ui.text("frame " + (n++)));
    void app.start();
    setImmediate(() => { armed = true; throw new Error("boom"); });
    setTimeout(() => { console.log("FRAMES_AFTER=" + (n - 1)); process.exit(0); }, 300);
  `;
  const run = (hosts: number) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", program(hosts)], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      const kill = setTimeout(() => child.kill("SIGKILL"), 15_000);
      child.on("exit", (code) => {
        clearTimeout(kill);
        resolve({ code, out });
      });
    });

  // With no host handler the library is the last resort and still exits.
  assert.equal((await run(0)).code, 1);

  // With one, the host decides — and the render loop stops rather than
  // painting into the shell the alternate screen just gave back.
  const handed = await run(1);
  assert.equal(handed.code, 0, "the library exited despite a host handler");
  assert.match(handed.out, /FRAMES_AFTER=0/, "the app kept rendering after teardown");
});
