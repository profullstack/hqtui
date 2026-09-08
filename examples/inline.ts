/**
 * An inline viewport: `bun examples/inline.ts`.
 *
 * The shape `npm`, `cargo`, `docker pull` and every installer use. A few live
 * rows sit in the normal flow of the command line, finished work scrolls away
 * above them into the terminal's scrollback, and when the process exits the
 * shell holds a readable transcript instead of a blanked alternate screen.
 *
 * Nothing here clears the screen, and your prompt comes back below the last
 * frame rather than on top of it. Run it after something else and you will see
 * that output still there.
 */
import { createApp } from "@profullstack/hqtui";

const steps = [
  "resolve dependencies",
  "compile core",
  "compile widgets",
  "link",
  "run tests",
];

const app = await createApp({
  // Three rows of live UI. Everything else belongs to the shell.
  viewport: { mode: "inline", height: 3 },
  quitKeys: [],
  alwaysRender: true,
  fps: 20,
});

let done = 0;
let spinner = 0;
const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

app.render(({ ui, theme }) => {
  ui.text(`building  ${done}/${steps.length}`, { fg: theme.primary, bold: true });
  ui.meter({ label: "", value: done / steps.length });
  ui.text(
    done < steps.length ? `${frames[spinner % frames.length]} ${steps[done]}` : "done",
    { fg: theme.muted },
  );
});

void app.start();

const timer = setInterval(() => {
  spinner++;
  if (spinner % 8 !== 0) return;

  // The finished line goes into the scrollback, permanently. The live rows
  // below it keep redrawing where they are.
  app.insertBefore(1, (ui) => {
    ui.text(`  ✓ ${steps[done]}`);
  });
  done++;

  if (done >= steps.length) {
    clearInterval(timer);
    setTimeout(() => app.stop(), 300);
  }
}, 60);
