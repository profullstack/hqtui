/** Clickable buttons and a scrollable list. `bun examples/mouse.ts` */
import { createApp } from "@profullstack/hqtui";

let count = 0;
let scroll = 0;
const app = await createApp();

app.render(({ ui, theme }) => {
  ui.panel({ title: "Mouse", footer: "click the buttons · scroll the list" }, (p) => {
    p.text(`Clicked ${count} times`, { fg: theme.accent, size: 1 });
    p.spacer(1);
    p.buttons([
      { label: "Increment", variant: "success", onPress: () => { count++; } },
      { label: "Reset", variant: "danger", onPress: () => { count = 0; } },
    ]);
    p.spacer(1);
    p.draw((surface) => {
      for (let i = 0; i < surface.height; i++) {
        surface.text(0, i, `row ${scroll + i}`, { fg: theme.muted });
      }
    });
  });
});

app.on("mouse", (event) => {
  if (event.action === "scroll") scroll = Math.max(0, scroll + event.scroll);
});

await app.start();
