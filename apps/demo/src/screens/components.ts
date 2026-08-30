import type { Container, Theme } from "@profullstack/hqtui";
import { focusPane, pane, scrollPane, type DemoState } from "../state.ts";
import { bytes, percent } from "../format.ts";

const FILES = [
  { name: "src", size: "4.2 KB", type: "dir", modified: "2m ago" },
  { name: "test", size: "1.1 KB", type: "dir", modified: "5m ago" },
  { name: "package.json", size: "1.2 KB", type: "file", modified: "10m ago" },
  { name: "README.md", size: "3.4 KB", type: "file", modified: "1h ago" },
  { name: "bun.lockb", size: "12 KB", type: "file", modified: "1h ago" },
];

const TREE = [
  {
    label: "systemd",
    expanded: true,
    values: [{ text: "1.3", width: 6 }, { text: "0.1", width: 6 }],
    children: [
      { label: "bash", values: [{ text: "0.1", width: 6 }, { text: "0.2", width: 6 }] },
      {
        label: "bun",
        expanded: true,
        values: [{ text: "32.8", width: 6 }, { text: "4.2", width: 6 }],
        children: [
          { label: "bun:worker", values: [{ text: "12.4", width: 6 }, { text: "1.8", width: 6 }] },
          { label: "bun:worker", values: [{ text: "8.7", width: 6 }, { text: "1.3", width: 6 }] },
        ],
      },
      {
        label: "node",
        expanded: true,
        values: [{ text: "18.1", width: 6 }, { text: "2.1", width: 6 }],
        children: [{ label: "node:worker", values: [{ text: "6.1", width: 6 }, { text: "0.8", width: 6 }] }],
      },
      { label: "postgres", values: [{ text: "6.7", width: 6 }, { text: "1.8", width: 6 }] },
    ],
  },
];

/** Every widget in the library, in one screen. Also the interaction sandbox. */
export function componentsScreen(ui: Container, state: DemoState, theme: Theme): void {
  ui.row({ size: "1fr", gap: 1 }, (row) => {
    row.column({ gap: 1 }, (left) => {
      left.panel({ title: "Buttons & Inputs", size: 13 }, (p) => {
        p.row({ size: 1, gap: 1 }, (r) => {
          r.button({ label: "Primary", width: 11, size: 11, onPress: () => { state.showModal = true; } });
          r.button({ label: "Success", width: 11, size: 11, variant: "success" });
          r.button({ label: "Warning", width: 11, size: 11, variant: "warning" });
          r.button({ label: "Danger", width: 10, size: 10, variant: "danger" });
          r.spacer("fill");
        });
        p.spacer(1);
        p.row({ size: 1, gap: 2 }, (r) => {
          r.select({
            value: ["Dark", "Dracula", "Nord", "Tokyo Night"][state.selectIndex] ?? "Dark",
            width: 20,
            size: 20,
            open: state.selectOpen,
            options: ["Dark", "Dracula", "Nord", "Tokyo Night"],
            selectedIndex: state.selectIndex,
            onOpen: () => { state.selectOpen = !state.selectOpen; },
          });
          r.checkbox({
            label: "Toggle",
            checked: state.toggle,
            variant: "toggle",
            size: 12,
            onToggle: () => { state.toggle = !state.toggle; },
          });
          r.checkbox({
            label: "Checkbox",
            checked: state.checkbox,
            size: 14,
            onToggle: () => { state.checkbox = !state.checkbox; },
          });
          r.spacer("fill");
        });
        p.spacer(1);
        p.textInput({ label: "Search", value: state.inputValue, placeholder: "type to filter…", size: 1 });
        p.spacer(1);
        p.meter({ label: "Slider", value: state.slider, style: "smooth", heat: false, color: theme.primary });
        p.progress({ label: "Progress", value: 37, max: 120, showCount: true });
      });

      left.panel({ title: "Table Widget", size: "1fr" }, (p) => {
        const files = pane(state, "components.files", FILES.length);
        p.table({
          rows: FILES,
          selected: files.selected,
          offset: files.offset,
          followSelection: true,
          onScroll: (delta) => scrollPane(files, delta),
          onFocus: () => focusPane(state, "components.files"),
          onSelectRow: (row) => { files.selected = files.offset + row; },
          zebra: true,
          columns: [
            { key: "name", title: "Name", min: 10, color: theme.primary },
            { key: "size", title: "Size", width: 9, align: "right" },
            { key: "type", title: "Type", width: 6 },
            { key: "modified", title: "Modified", width: 10, align: "right", color: theme.muted },
          ],
        });
      });

      left.panel({ title: "Log Viewer", size: 11 }, (p) => {
        const clogs = pane(state, "components.logs", state.sample.logs.length, "log");
        p.log({
          entries: state.sample.logs.map((l) => ({ time: l.time, level: l.level, message: l.message, meta: `{${l.meta}}` })),
          // Lines scrolled back from the newest; 0 keeps it tailing.
          fromEnd: clogs.offset,
          scrollbar: true,
          onScroll: (delta) => scrollPane(clogs, -delta),
          onFocus: () => focusPane(state, "components.logs"),
        });
      });
    });

    row.column({ gap: 1 }, (right) => {
      right.panel({ title: "Process Tree", size: 13 }, (p) => {
        p.row({ size: 1 }, (r) => {
          r.text("Name", { fg: theme.muted, bold: true });
          r.text("CPU%   MEM%", { fg: theme.muted, bold: true, align: "right" });
        });
        const tree = pane(state, "components.tree", 8);
        p.tree({
          nodes: TREE,
          selected: tree.selected,
          offset: tree.offset,
          followSelection: true,
          onScroll: (delta) => scrollPane(tree, delta),
          onFocus: () => focusPane(state, "components.tree"),
        });
      });

      right.panel({ title: "Sparklines & Gauges", size: 12 }, (p) => {
        p.sparkline({ label: "CPU ", values: state.sample.cpu.history, text: percent(state.sample.cpu.total), color: theme.success });
        p.sparkline({ label: "Mem ", values: state.sample.memory.history, text: percent(state.sample.memory.used / state.sample.memory.total), color: theme.warning });
        p.sparkline({ label: "Net ", values: state.sample.network.downHistory, text: bytes(state.sample.network.downRate) + "/s", color: theme.primary });
        p.spacer(1);
        p.row({ size: "1fr", gap: 2 }, (r) => {
          r.gauge({ value: state.sample.cpu.total, label: percent(state.sample.cpu.total) });
          r.donut({
            segments: [
              { value: state.sample.memory.used, color: theme.primary, label: "Used" },
              { value: state.sample.memory.available, color: theme.warning, label: "Free" },
            ],
          });
        });
      });

      right.panel({ title: "Lists & Badges", size: "1fr" }, (p) => {
        p.row({ size: 1, gap: 1 }, (r) => {
          r.badge({ text: "active", color: theme.success, size: 10 });
          r.badge({ text: "idle", color: theme.warning, variant: "subtle", size: 8 });
          r.badge({ text: "failed", color: theme.danger, variant: "outline", size: 10 });
          r.spacer("fill");
        });
        p.spacer(1);
        const paths = pane(state, "components.list", 4);
        p.list({
          items: [
            { label: "apps/demo", color: theme.primary },
            { label: "packages/hqtui" },
            { label: "apps/web" },
            { label: "docs" },
          ],
          selected: paths.selected,
          offset: paths.offset,
          followSelection: true,
          onScroll: (delta) => scrollPane(paths, delta),
          onFocus: () => focusPane(state, "components.list"),
          onSelectRow: (row) => { paths.selected = paths.offset + row; },
          bullet: "▸",
          scrollbar: true,
        });
      });
    });
  });
}
