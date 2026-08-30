/** The smallest useful HQTUI program. `bun examples/hello.ts` */
import { createApp } from "@profullstack/hqtui";

const app = await createApp();

app.render(({ ui }) => {
  ui.panel({ title: "Hello" }, (panel) => {
    panel.text("Hello, terminal.");
    panel.label("Press q to quit.");
  });
});

await app.start();
