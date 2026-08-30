/** A confirmation dialog over live content. `bun examples/modal.ts` */
import { createApp } from "@profullstack/hqtui";

let open = false;
const app = await createApp({ quitKeys: ["ctrl+c"] });

app.on("key", (event) => {
  if (event.name === "enter") open = true;
  else if (event.name === "escape" || event.name === "y" || event.name === "n") open = false;
  else if (event.name === "q" && !open) app.quit();
});

app.render(({ ui }) => {
  ui.panel({ title: "Background" }, (p) => {
    p.text("Press Enter to open the dialog.");
    p.label("Esc, y or n closes it. q quits.");
  });
  if (open) {
    ui.modal({
      title: "Confirm Action",
      message: "Are you sure you want to terminate process 48231 (bun)?",
      buttons: [{ label: "Yes", variant: "success", focused: true }, { label: "No", variant: "ghost" }],
    });
  }
});

await app.start();
