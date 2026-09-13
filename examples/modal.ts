/** A confirmation dialog over live content. `bun examples/modal.ts` */
import { createApp } from "@profullstack/hqtui";

let open = false;
let result = "No action taken yet.";
function answer(accepted: boolean): void {
  result = accepted ? "Confirmed." : "Cancelled.";
  open = false;
}
const app = await createApp({ quitKeys: ["ctrl+c"] });

app.on("key", (event) => {
  if (event.name === "enter") open = true;
  else if (event.name === "q" && !open) app.quit();
});

app.render(({ ui }) => {
  ui.panel({ title: "Background" }, (p) => {
    p.text("Press Enter to open the dialog.");
    p.label("Tab/arrows select, Enter activates, Esc cancels. q quits.");
    p.text(result);
  });
  if (open) {
    ui.modal({
      title: "Confirm Action",
      message: "Apply this change?",
      buttons: [
        { label: "Yes", variant: "success", onPress: () => answer(true) },
        { label: "No", variant: "ghost", onPress: () => answer(false) },
      ],
      onDismiss: () => answer(false),
      onKey: (event) => {
        if (event.key === "y") answer(true);
        else if (event.key === "n") answer(false);
      },
    });
  }
});

await app.start();
