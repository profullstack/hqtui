/** A scrollable, selectable table driven by the keyboard. `bun examples/table.ts` */
import { createApp } from "@profullstack/hqtui";

const rows = Array.from({ length: 200 }, (_, i) => ({
  id: i + 1,
  name: `service-${String(i + 1).padStart(3, "0")}`,
  status: i % 7 === 0 ? "failed" : i % 3 === 0 ? "idle" : "active",
  latency: (Math.random() * 200).toFixed(1),
}));

let selected = 0;
let offset = 0;
const app = await createApp();

app.on("key", (event) => {
  if (event.name === "down") selected = Math.min(rows.length - 1, selected + 1);
  if (event.name === "up") selected = Math.max(0, selected - 1);
  if (selected < offset) offset = selected;
});

app.render(({ ui, theme, height }) => {
  const capacity = height - 4;
  if (selected >= offset + capacity) offset = selected - capacity + 1;

  ui.panel({ title: `Services (${selected + 1}/${rows.length})`, footer: "↑/↓ to move · q to quit" }, (p) => {
    p.table({
      rows,
      selected,
      offset,
      scrollbar: true,
      zebra: true,
      columns: [
        { key: "id", title: "#", width: 5, align: "right" },
        { key: "name", title: "Service", color: theme.primary },
        {
          key: "status",
          title: "Status",
          width: 8,
          color: (row) => (row.status === "failed" ? theme.danger : row.status === "idle" ? theme.warning : theme.success),
        },
        { key: "latency", title: "ms", width: 8, align: "right" },
      ],
    });
  });
});

await app.start();
