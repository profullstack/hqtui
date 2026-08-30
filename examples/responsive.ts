/** One view, three layouts. Resize the terminal to see it switch. */
import { createApp } from "@profullstack/hqtui";

const app = await createApp();

app.render(({ ui, width, height }) => {
  ui.responsive({
    120: (wide) => {
      wide.row({ gap: 1, padding: 1 }, (r) => {
        r.panel({ title: "Sidebar", width: 30 }, (p) => p.text("wide layout"));
        r.panel({ title: "Main" }, (p) => p.text(`${width}×${height}`));
        r.panel({ title: "Details", width: 30 }, (p) => p.text("visible ≥ 120 cols"));
      });
    },
    80: (medium) => {
      medium.row({ gap: 1, padding: 1 }, (r) => {
        r.panel({ title: "Main" }, (p) => p.text(`${width}×${height}`));
        r.panel({ title: "Details", width: 26 }, (p) => p.text("medium layout"));
      });
    },
    0: (compact) => {
      compact.panel({ title: "Main" }, (p) => {
        p.text(`${width}×${height}`);
        p.label("compact layout");
      });
    },
  });
});

await app.start();
