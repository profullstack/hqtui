import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { App } from "@profullstack/hqtui";
import { renderToScreen } from "@profullstack/hqtui/testing";
import { createSystemSimulation, type ProcessSample } from "../src/simulation.ts";
import { createState, pane, type DemoState } from "../src/state.ts";
import { closeKillDialog, confirmKillDialog, openKillDialog, renderKillDialog } from "../src/kill-dialog.ts";

function state(source = "linux /proc"): DemoState {
  const sample = createSystemSimulation({ seed: 1 }).current();
  const row: ProcessSample = {
    pid: 12345, name: "worker", command: "worker --test", user: "tester",
    cpu: 90, mem: 1, rss: 1024, threads: 1, state: "S",
  };
  sample.processes = [row, { ...row, pid: 12346, name: "other", cpu: 10 }];
  const demo = createState(sample, source, []);
  pane(demo, "dashboard.processes", sample.processes.length);
  return demo;
}

test("termination defaults to SIGTERM and retains the selected process across refresh sorting", () => {
  const demo = state();
  openKillDialog(demo);
  assert.equal(demo.killDialog?.force, false);
  const screen = renderToScreen(({ ui }) => renderKillDialog(ui, demo));
  assert.match(screen.text(), /\[ \] Force kill \(-9 \/ SIGKILL\)/);
  assert.match(screen.text(), /SIGTERM \(15\)/);
  demo.sample.processes[0].cpu = 0;
  demo.sample.processes[1].cpu = 99;
  const sent: unknown[] = [];
  confirmKillDialog(demo, (...args) => sent.push(args));
  confirmKillDialog(demo, (...args) => sent.push(args));
  assert.deepEqual(sent, [[12345, "SIGTERM"]], "redraws/repeated activation must not send twice");
  assert.match(demo.killDialog!.result!, /Sent SIGTERM/);
});

test("the force checkbox selects SIGKILL and resets when reopened", () => {
  const demo = state();
  openKillDialog(demo);
  const sent: unknown[] = [];
  const render = () => renderToScreen(({ ui }) => renderKillDialog(ui, demo, (...args) => sent.push(args)));
  let screen = render();
  const force = screen.find("Force kill")!;
  screen.click(force.x, force.y);
  assert.equal(demo.killDialog?.force, true);
  screen = render();
  assert.match(screen.text(), /\[✓\]/);
  const yes = screen.find("Yes")!;
  screen.click(yes.x, yes.y);
  assert.deepEqual(sent, [[12345, "SIGKILL"]]);
  closeKillDialog(demo);
  openKillDialog(demo);
  assert.equal(demo.killDialog?.force, false);
});

test("mouse No and backdrop cancel without sending a signal", () => {
  const demo = state();
  const send = () => assert.fail("cancel sent a signal");
  for (const cancel of ["No", "backdrop"]) {
    openKillDialog(demo);
    const screen = renderToScreen(({ ui }) => renderKillDialog(ui, demo, send));
    const at = cancel === "No" ? screen.find("No")! : { x: 0, y: 0 };
    screen.click(at.x, at.y);
    assert.equal(demo.showModal, false);
    confirmKillDialog(demo, send);
  }
});

test("simulation and fallback simulation never signal host PIDs", () => {
  for (const source of ["simulated", "simulated (freebsd not supported)"]) {
    for (const force of [false, true]) {
      const demo = state(source);
      openKillDialog(demo);
      demo.killDialog!.force = force;
      confirmKillDialog(demo, () => assert.fail("simulation sent a signal"));
      assert.match(demo.killDialog!.result!, /No real process was signalled/);
    }
  }
});

test("other screens, other panes and empty process lists do not open termination", () => {
  for (const setup of [
    (demo: DemoState) => { demo.screen = "services"; },
    (demo: DemoState) => { demo.focused.dashboard = "dashboard.logs"; },
    (demo: DemoState) => { demo.sample.processes = []; },
    (demo: DemoState) => { demo.filter = "no matching process"; },
  ]) {
    const demo = state();
    setup(demo);
    openKillDialog(demo);
    assert.equal(demo.showModal, false);
  }
});

test("invalid, vanished and changed process targets are rejected", () => {
  for (const pid of [0, -1, 1.5, NaN]) {
    const demo = state();
    demo.sort = "name";
    demo.sample.processes = [{ ...demo.sample.processes[0], pid }];
    openKillDialog(demo);
    confirmKillDialog(demo, () => assert.fail("invalid PID was signalled"));
    assert.match(demo.killDialog!.result!, /invalid process ID/);
  }
  for (const change of [
    (demo: DemoState) => { demo.sample.processes = []; },
    (demo: DemoState) => { demo.sample.processes[0].command = "different worker"; },
  ]) {
    const demo = state();
    openKillDialog(demo);
    change(demo);
    confirmKillDialog(demo, () => assert.fail("stale target was signalled"));
    assert.match(demo.killDialog!.result!, /exited or changed/);
  }
});

test("signal failures stay visible in the dialog", () => {
  for (const [code, message] of [["EPERM", /Permission denied/], ["ESRCH", /already exited/], ["EINVAL", /Could not send SIGTERM/]] as const) {
    const demo = state();
    openKillDialog(demo);
    confirmKillDialog(demo, () => { throw Object.assign(new Error("signal failed"), { code }); });
    assert.equal(demo.showModal, true);
    const screen = renderToScreen(({ ui }) => renderKillDialog(ui, demo));
    assert.match(screen.text(), message);
    assert.ok(screen.find("Close"));
  }
});

test("keyboard No, Force, Yes and Escape work through the demo's real modal", async (t) => {
  const demo = state();
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  Object.assign(output, { columns: 80, rows: 24 });
  const app = new App({
    input: input as unknown as NodeJS.ReadStream,
    output: output as unknown as NodeJS.WriteStream,
    installExitHandlers: false,
    quitKeys: [],
  });
  t.after(() => app.stop());
  const sent: unknown[] = [];
  app.on("key", (event) => {
    if (event.key === "enter") openKillDialog(demo);
    if (event.key === "space") demo.paused = !demo.paused;
    if (event.key === "tab") demo.screen = "services";
  });
  app.render(({ ui }) => {
    ui.button({ label: "Background", onPress: () => assert.fail("background activated") });
    renderKillDialog(ui, demo, (...args) => sent.push(args));
  });
  openKillDialog(demo);
  void app.start();
  const key = async (bytes: string) => {
    input.write(bytes);
    await new Promise((resolve) => setTimeout(resolve, bytes === "\x1b" ? 60 : 0));
    app.frame();
  };
  await key("\x1b[C");
  await key("\r");
  assert.equal(demo.showModal, false);
  assert.deepEqual(sent, []);
  openKillDialog(demo);
  app.frame();
  await key("\x1b[Z"); // Yes -> Force
  await key(" ");
  assert.equal(demo.killDialog?.force, true);
  assert.equal(demo.paused, false);
  await key("\t"); // Force -> Yes
  assert.equal(demo.screen, "dashboard");
  await key("\r");
  assert.deepEqual(sent, [[12345, "SIGKILL"]]);
  await key("\r"); // close result
  assert.equal(demo.showModal, false);
  openKillDialog(demo);
  app.frame();
  assert.equal(demo.killDialog?.force, false);
  await key("n");
  assert.equal(demo.showModal, false);
  openKillDialog(demo);
  app.frame();
  await key("\x1b");
  assert.equal(demo.showModal, false);
  assert.deepEqual(sent, [[12345, "SIGKILL"]]);
});

test("the process dialog survives a 1x1 terminal", () => {
  const demo = state();
  openKillDialog(demo);
  assert.doesNotThrow(() => renderToScreen(({ ui }) => renderKillDialog(ui, demo), { width: 1, height: 1 }));
});

for (const force of [false, true]) {
  test(`a disposable child receives ${force ? "SIGKILL" : "SIGTERM and cleans up"}`, { skip: process.platform === "win32", timeout: 5000 }, async (t) => {
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => { console.log('cleaned'); process.exit(0); }); console.log('ready'); setInterval(() => {}, 1000);"], { stdio: ["ignore", "pipe", "pipe"] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    await once(child.stdout, "data");
    const demo = state();
    demo.sample.processes[0].pid = child.pid!;
    openKillDialog(demo);
    demo.killDialog!.force = force;
    const exited = once(child, "exit");
    confirmKillDialog(demo);
    const [code, signal] = await exited;
    assert.equal(code, force ? null : 0);
    assert.equal(signal, force ? "SIGKILL" : null);
    assert.equal(output.includes("cleaned"), !force);
  });
}
