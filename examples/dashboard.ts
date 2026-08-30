/** A grid of live panels. `bun examples/dashboard.ts` */
import { createApp } from "@profullstack/hqtui";

const history: number[] = [];
const app = await createApp({ fps: 30 });

setInterval(() => {
  history.push(50 + Math.sin(Date.now() / 900) * 30 + Math.random() * 12);
  if (history.length > 300) history.shift();
  app.invalidate();
}, 100).unref();

app.render(({ ui, theme }) => {
  ui.grid({ columns: ["2fr", "1fr"], rows: ["1fr", 10], gap: 1, padding: 1 }, (grid) => {
    grid.panel({ title: "Throughput", subtitle: `${history.at(-1)?.toFixed(1) ?? "0"} req/s` }, (p) => {
      p.graph({ values: history, min: 0, max: 100, fill: true, axis: true });
    });
    grid.panel({ title: "Health" }, (p) => {
      p.meter({ label: "CPU", value: (history.at(-1) ?? 0) / 100 });
      p.meter({ label: "Memory", value: 0.42 });
      p.meter({ label: "Disk", value: 0.27 });
      p.spacer(1);
      p.keyValues([
        { label: "Region", value: "us-east-1" },
        { label: "Version", value: "0.1.0", color: theme.accent },
      ]);
    });
    grid.panel({ title: "Recent", colSpan: 2 }, (p) => {
      p.log({
        entries: [
          { time: "12:00:01", level: "INFO", message: "Deployment finished" },
          { time: "12:00:04", level: "WARN", message: "Cache miss rate above 10%" },
          { time: "12:00:09", level: "ERROR", message: "Upstream timeout" },
        ],
      });
    });
  });
});

await app.start();
