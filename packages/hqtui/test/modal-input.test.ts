import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { App } from "../src/app.ts";
import { renderToScreen } from "../src/testing.ts";
import { themes } from "../src/theme.ts";

function harness() {
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
  return {
    app,
    async key(bytes: string) {
      input.write(bytes);
      await new Promise((resolve) => setTimeout(resolve, bytes === "\x1b" ? 60 : 0));
      app.frame();
    },
  };
}

test("dialog arrows and Tab navigate buttons and a checkbox without activating the background", async (t) => {
  const { app, key } = harness();
  t.after(() => app.stop());
  const pressed: string[] = [];
  let checked = false;
  const leaked: string[] = [];
  app.on("key", (event) => leaked.push(event.key));
  app.render(({ ui }) => {
    ui.button({ label: "Background", onPress: () => pressed.push("background") });
    ui.modal({
      height: 10,
      buttons: [
        { label: "Yes", onPress: () => pressed.push("yes") },
        { label: "No", onPress: () => pressed.push("no") },
      ],
    }, (body) => body.checkbox({ label: "Force", checked, onToggle: () => { checked = !checked; } }));
  });
  void app.start();
  await key("\x1b[C"); // right: No
  await key("\r");
  assert.deepEqual(pressed, ["no"]);
  await key("\t"); // checkbox
  await key(" ");
  assert.equal(checked, true);
  await key("\x1b[Z"); // Shift+Tab: No
  await key("\x1b[D"); // left: Yes
  await key("\r");
  await key("\x1b[A"); // up wraps to checkbox
  await key(" ");
  assert.equal(checked, false);
  await key("\x1b[B"); // down wraps to Yes
  await key("\r");
  assert.deepEqual(pressed, ["no", "yes", "yes"]);
  assert.deepEqual(leaked, []);
});

test("dismissal does not re-open a dialog and restores the previous background focus", async (t) => {
  const { app, key } = harness();
  t.after(() => app.stop());
  let open = false;
  const pressed: string[] = [];
  app.on("key", (event) => { if (event.name === "enter") open = true; });
  app.render(({ ui }) => {
    ui.buttons([
      { label: "First", onPress: () => pressed.push("first") },
      { label: "Second", onPress: () => pressed.push("second") },
    ]);
    if (open) ui.modal({
      buttons: [{ label: "Close", onPress: () => { open = false; } }],
      onDismiss: () => { open = false; },
    });
  });
  void app.start();
  await key("\t"); // remember the second background button
  open = true;
  app.frame();
  await key("\r");
  assert.equal(open, false, "the closing Enter leaked to the opener");
  assert.deepEqual(pressed, []);
  await key(" ");
  assert.deepEqual(pressed, ["second"]);
  open = true;
  app.frame();
  await key("\x1b");
  assert.equal(open, false);
});

test("only the top modal activates and its custom shortcuts stay out of app key handlers", async (t) => {
  const { app, key } = harness();
  t.after(() => app.stop());
  const calls: string[] = [];
  app.on("key", () => calls.push("app"));
  app.render(({ ui }) => {
    ui.modal({ buttons: [{ label: "Lower", onPress: () => calls.push("lower") }] });
    ui.modal({
      buttons: [{ label: "Upper", onPress: () => calls.push("upper") }],
      onKey: (event) => calls.push(event.key),
    });
  });
  void app.start();
  await key("\r");
  await key("n");
  assert.deepEqual(calls, ["upper", "n"]);
});

test("modal focus highlights follow the dialog's order even with controls underneath", () => {
  const draw = (focus: number) => renderToScreen(({ ui }) => {
    ui.button({ label: "Background" });
    ui.modal({ buttons: [
      { label: "Yes", variant: "success", onPress: () => {} },
      { label: "No", variant: "ghost", onPress: () => {} },
    ] });
  }, { width: 80, height: 24, focus, theme: themes.dark });
  const yes = draw(0);
  const no = draw(1);
  const yesAt = yes.find("Yes")!;
  const noAt = no.find("No")!;
  assert.equal(yes.cell(yesAt.x, yesAt.y).bg, themes.dark.success);
  assert.equal(no.cell(noAt.x, noAt.y).bg, themes.dark.muted);
  assert.notEqual(no.cell(yesAt.x, yesAt.y).bg, themes.dark.success);
});

test("replacing a dialog with fewer controls repaints its clamped focus without more input", async (t) => {
  const { app, key } = harness();
  t.after(() => app.stop());
  let result = false;
  app.render(({ ui }) => ui.modal({
    buttons: (result ? ["Close"] : ["Yes", "No", "Force"]).map((label) => ({ label, onPress: () => {} })),
  }));
  void app.start();
  await key("\x1b[Z"); // Force, index 2
  result = true;
  app.frame();
  const frame = app.stats.frame;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(app.stats.frame > frame, "Close stayed unfocused until another event");
});
