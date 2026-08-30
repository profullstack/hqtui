import { renderToHtml, themes, type Theme } from "@profullstack/hqtui";
import { createSystemSimulation } from "./simulation";

/**
 * Every terminal on this site is rendered by HQTUI itself at build time and
 * emitted as HTML — real frames from the real renderer, not screenshots.
 */
export interface TerminalOptions {
  width?: number;
  height?: number;
  theme?: Theme;
  fontSize?: number;
}

type View = Parameters<typeof renderToHtml>[0];

export function render(view: View, options: TerminalOptions = {}): string {
  return renderToHtml(view, {
    width: options.width ?? 100,
    height: options.height ?? 26,
    theme: options.theme ?? themes.dark,
    fontSize: options.fontSize ?? 13,
    padding: 18,
    className: "hqtui-screen",
  });
}

const simulation = createSystemSimulation({ seed: 20260830 });
for (let i = 0; i < 260; i++) simulation.update(0.1);
const sample = simulation.current();

export const demoData = sample;

/** The hero: a compact system dashboard. */
export const heroView: View = ({ ui, theme }) => {
  ui.row({ size: 1 }, (header) => {
    header.text(" hqtui.com", { fg: theme.title, bold: true, size: 14 });
    header.tabs({ tabs: ["1 dashboard", "2 components", "3 graphics"], active: 0 });
    header.text(`live  ${percent(sample.cpu.total)}  14:02:11 `, { fg: theme.success, align: "right" });
  });
  ui.spacer(1);
  ui.row({ size: "1fr", gap: 1 }, (row) => {
    row.panel({ title: "CPU Overview", subtitle: percent(sample.cpu.total), borderColor: theme.success }, (p) => {
      p.graph({ values: sample.cpu.history, min: 0, max: 100, fill: true, color: theme.success, size: "1fr" });
      p.meters(sample.cpu.cores.slice(0, 8).map((value, i) => ({ label: `P${i}`, value })), {
        columns: 2,
        labelWidth: 4,
        style: "segmented",
      });
    });
    row.panel({ title: "Memory", width: "0.7fr", borderColor: theme.warning }, (p) => {
      p.meter({ label: "Used", value: sample.memory.used / sample.memory.total, style: "segmented" });
      p.meter({ label: "Swap", value: sample.memory.swapUsed / sample.memory.swapTotal, style: "segmented" });
      p.spacer(1);
      p.keyValues([
        { label: "Total", value: gib(sample.memory.total) },
        { label: "Cached", value: gib(sample.memory.cached), color: theme.accent },
        { label: "Free", value: gib(sample.memory.free), color: theme.muted },
      ]);
      p.spacer("fill");
      p.sparkline({ label: "hist", values: sample.memory.history, color: theme.primary });
    });
    row.panel({ title: "Network", width: "0.8fr", borderColor: theme.primary }, (p) => {
      p.text(`↓ ${mbps(sample.network.downRate)}`, { fg: theme.primary, size: 1 });
      p.graph({ values: sample.network.downHistory, fill: true, color: theme.primary, min: 0 });
      p.text(`↑ ${mbps(sample.network.upRate)}`, { fg: theme.secondary, size: 1 });
      p.graph({ values: sample.network.upHistory, fill: true, color: theme.secondary, min: 0 });
    });
  });
  ui.spacer(1);
  ui.panel({ title: "Processes", size: 9, borderColor: theme.accent }, (p) => {
    p.table({
      rows: sample.processes.slice(0, 6),
      selected: 0,
      zebra: true,
      columns: [
        { key: "pid", title: "PID", width: 7, align: "right" },
        { key: "name", title: "Name", color: theme.primary },
        { key: "cpu", title: "CPU%", width: 6, align: "right", render: (r) => r.cpu.toFixed(1) },
        { key: "mem", title: "MEM%", width: 6, align: "right", render: (r) => r.mem.toFixed(1) },
        { key: "user", title: "User", width: 10, color: theme.muted },
        { key: "command", title: "Command", color: theme.muted },
      ],
    });
  });
  ui.spacer(1);
  ui.statusBar({
    items: [
      { key: "F1", label: "Help" },
      { key: "F2", label: "Theme" },
      { key: "F6", label: "Sort" },
      { key: "^K", label: "Palette" },
      { key: "q", label: "Quit" },
    ],
    right: [{ label: "0.29ms · 812 cells · 2.6KB" }],
  });
};

/** Widget catalogue, used on the showcase page. */
export const widgetsView: View = ({ ui, theme }) => {
  ui.row({ size: "1fr", gap: 1 }, (row) => {
    row.column({ gap: 1 }, (left) => {
      left.panel({ title: "Meters & Gauges", size: 10, borderColor: theme.success }, (p) => {
        p.meter({ label: "cpu", value: 0.22 });
        p.meter({ label: "mem", value: 0.58 });
        p.meter({ label: "disk", value: 0.87 });
        p.spacer(1);
        p.row({ size: "1fr", gap: 2 }, (r) => {
          r.gauge({ value: 0.57, label: "57°C" });
          r.donut({ segments: [{ value: 27 }, { value: 73 }] });
        });
      });
      left.panel({ title: "Controls", size: 8, borderColor: theme.primary }, (p) => {
        p.row({ size: 1, gap: 1 }, (r) => {
          r.button({ label: "Primary", width: 11, size: 11, focused: true });
          r.button({ label: "Success", width: 11, size: 11, variant: "success" });
          r.button({ label: "Danger", width: 10, size: 10, variant: "danger" });
          r.spacer("fill");
        });
        p.spacer(1);
        p.row({ size: 1, gap: 2 }, (r) => {
          r.select({ value: "Tokyo Night", width: 18, size: 18 });
          r.checkbox({ label: "Toggle", checked: true, variant: "toggle", size: 12 });
          r.checkbox({ label: "Check", checked: true, size: 12 });
          r.spacer("fill");
        });
        p.spacer(1);
        p.textInput({ label: "Filter", value: "postgres", focused: true });
      });
      left.panel({ title: "Log Viewer", size: "1fr", borderColor: theme.danger }, (p) => {
        p.log({
          entries: [
            { time: "15:34:12", level: "INFO", message: "Server started on port 3000" },
            { time: "15:34:13", level: "INFO", message: "Database connected" },
            { time: "15:34:14", level: "WARN", message: "Cache miss for key: user:123" },
            { time: "15:34:15", level: "ERROR", message: "Failed to fetch user: timeout" },
            { time: "15:34:16", level: "INFO", message: "Retrying in 2 seconds..." },
            { time: "15:34:19", level: "DEBUG", message: "Response time: 142ms" },
          ],
        });
      });
    });
    row.column({ gap: 1 }, (right) => {
      right.panel({ title: "Process Tree", size: 11, borderColor: theme.secondary }, (p) => {
        p.tree({
          nodes: [{
            label: "systemd",
            expanded: true,
            values: [{ text: "1.3", width: 5 }],
            children: [
              { label: "bash", values: [{ text: "0.1", width: 5 }] },
              {
                label: "bun",
                expanded: true,
                values: [{ text: "32.8", width: 5 }],
                children: [
                  { label: "bun:worker", values: [{ text: "12.4", width: 5 }] },
                  { label: "bun:worker", values: [{ text: "8.7", width: 5 }] },
                ],
              },
              { label: "postgres", values: [{ text: "6.7", width: 5 }] },
            ],
          }],
          selected: 2,
        });
      });
      right.panel({ title: "Graphs", size: "1fr", borderColor: theme.accent }, (p) => {
        p.multiGraph(
          [
            { values: sample.cpu.history, color: theme.primary, label: "cpu" },
            { values: sample.memory.history, color: theme.success, label: "mem" },
          ],
          { min: 0, max: 100, legend: true, axis: true },
        );
      });
      right.panel({ title: "Temperatures", size: 8, borderColor: theme.warning }, (p) => {
        sample.temperatures.slice(0, 5).forEach((temp) => {
          p.row({ size: 1 }, (r) => {
            r.text(temp.label, { fg: theme.muted, width: 15 });
            r.heatBar({ value: temp.value / 100 });
            r.text(`${Math.round(temp.value)}°C`, { width: 6, align: "right", fg: theme.warning });
          });
        });
      });
    });
  });
};

/** The `createApp()` hello-world, rendered exactly as the snippet produces it. */
export const helloView: View = ({ ui }) => {
  ui.panel({ title: "Hello" }, (panel) => {
    panel.text("Hello, terminal.");
    panel.label("Press q to quit.");
  });
};

/** A single themed panel, used by the theme gallery. */
export function themeView(themeName: string): View {
  return ({ ui, theme }) => {
    ui.panel({ title: theme.name }, (p) => {
      p.row({ size: 1, gap: 1 }, (r) => {
        r.badge({ text: "primary", color: theme.primary, size: 10 });
        r.badge({ text: "ok", color: theme.success, size: 5 });
        r.badge({ text: "warn", color: theme.warning, variant: "subtle", size: 7 });
        r.badge({ text: "err", color: theme.danger, variant: "outline", size: 6 });
        r.spacer("fill");
      });
      p.spacer(1);
      p.meter({ label: "cpu", value: 0.62 });
      p.meter({ label: "mem", value: 0.38 });
      p.spacer(1);
      p.graph({ values: sample.cpu.history, min: 0, max: 100, fill: true, color: theme.graph[0] });
      p.draw((surface) => {
        theme.graph.forEach((color, i) => {
          for (let x = 0; x < 3; x++) surface.char(i * 4 + x, 0, "█", { fg: color });
        });
      }, { size: 1 });
    });
  };
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
function gib(value: number): string {
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}
function mbps(bytesPerSecond: number): string {
  return `${((bytesPerSecond * 8) / 1e6).toFixed(1)} Mb/s`;
}
