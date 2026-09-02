import type { Container, Theme } from "@profullstack/hqtui";
import { heatColor } from "@profullstack/hqtui";
import { focusPane, pane, scrollPane, type DemoState } from "../state.ts";
import { bitRate, byteRate, bytes, clock, duration, num, percent } from "../format.ts";

const TIME_LABELS = ["60s", "45s", "30s", "15s", "0s"];

function cpuPanel(ui: Container, state: DemoState, theme: Theme, coreColumns: number): void {
  const cpu = state.sample.cpu;
  ui.panel({ title: "CPU Overview", subtitle: percent(cpu.total) }, (p) => {
    p.label(`${cpu.model}   ${num(cpu.frequencyGhz, 1)} GHz`, { size: 1 });
    p.graph({ values: cpu.history, min: 0, max: 100, fill: true, color: theme.success, size: "1fr" });
    p.meters(
      cpu.cores.map((value, i) => ({ label: `P${i}`, value })),
      { columns: coreColumns, labelWidth: 4, valueWidth: 5, style: "segmented" },
    );
    p.divider();
    p.keyValues(
      [{
        label: "Load Avg",
        value: `${num(cpu.load[0], 2)}   ${num(cpu.load[1], 2)}   ${num(cpu.load[2], 2)}`,
        color: theme.warning,
      }],
      { size: 1 },
    );
  });
}

function memoryPanel(ui: Container, state: DemoState, theme: Theme): void {
  const memory = state.sample.memory;
  const used = memory.used / Math.max(1, memory.total);
  const swap = memory.swapTotal > 0 ? memory.swapUsed / memory.swapTotal : 0;
  ui.panel({ title: "Memory & Swap" }, (p) => {
    p.text(`Memory${" ".repeat(6)}${bytes(memory.used)} / ${bytes(memory.total)} (${percent(used)})`, {
      fg: theme.foreground,
      size: 1,
    });
    p.meter({ value: used, showValue: false, style: "segmented", size: 1 });
    p.spacer(1);
    p.keyValues([
      { label: "Used:", value: bytes(memory.used), color: theme.warning },
      { label: "Available:", value: bytes(memory.available), color: theme.success },
      { label: "Cached:", value: bytes(memory.cached), color: theme.accent },
      { label: "Buffers:", value: bytes(memory.buffers), color: theme.secondary },
      { label: "Free:", value: bytes(memory.free), color: theme.muted },
    ]);
    p.spacer("fill");
    p.divider();
    p.text(`Swap${" ".repeat(8)}${bytes(memory.swapUsed)} / ${bytes(memory.swapTotal)} (${percent(swap)})`, {
      fg: theme.foreground,
      size: 1,
    });
    p.meter({ value: swap, showValue: false, color: theme.secondary, heat: false, style: "segmented", size: 1 });
    p.keyValues([
      { label: "Used:", value: bytes(memory.swapUsed), color: theme.secondary },
      { label: "Free:", value: bytes(Math.max(0, memory.swapTotal - memory.swapUsed)), color: theme.muted },
    ]);
  });
}

function disksPanel(ui: Container, state: DemoState, theme: Theme): void {
  const disks = state.sample.disks;
  ui.panel({ title: "Disks" }, (p) => {
    if (disks.length === 0) {
      p.label("No disks reported");
      return;
    }
    disks.slice(0, 2).forEach((disk, i) => {
      const used = disk.total > 0 ? disk.used / disk.total : 0;
      p.text(`${disk.device} — ${bytes(disk.total)} (${disk.type})`, { fg: theme.foreground, size: 1 });
      p.text(`Used: ${bytes(disk.used)} (${percent(used)})`, { fg: theme.muted, size: 1 });
      p.meter({ value: used, showValue: false, style: "segmented", size: 1 });
      p.text(`Free: ${bytes(Math.max(0, disk.total - disk.used))}`, { fg: theme.muted, size: 1 });
      p.row({ size: 1 }, (r) => {
        r.text(`Read: ${byteRate(disk.readRate)}`, { fg: theme.success });
        r.text(`Write: ${byteRate(disk.writeRate)}`, { fg: theme.secondary, align: "right" });
      });
      p.multiGraph(
        [
          { values: disk.readHistory, color: theme.success, fill: true },
          { values: disk.writeHistory, color: theme.secondary, fill: true },
        ],
        { size: "1fr", min: 0 },
      );
      if (i === 0 && disks.length > 1) p.divider();
    });
  });
}

function systemPanel(ui: Container, state: DemoState, theme: Theme): void {
  const s = state.sample;
  ui.panel({ title: "System" }, (p) => {
    p.row({ size: 6, gap: 2, min: 6 }, (r) => {
      r.keyValues([
        { label: "OS:", value: s.system.os },
        { label: "Kernel:", value: s.system.kernel },
        { label: "Uptime:", value: duration(s.system.uptime) },
        { label: "Hostname:", value: s.system.hostname },
        { label: "Shell:", value: s.system.shell },
        { label: "Source:", value: state.source, color: theme.accent },
      ], { spread: false });
      r.keyValues([
        { label: "CPU:", value: percent(s.cpu.total), color: heatColor(theme, s.cpu.total) },
        { label: "Memory:", value: `${percent(s.memory.used / Math.max(1, s.memory.total))} (${bytes(s.memory.used)})`, color: theme.warning },
        { label: "Swap:", value: s.memory.swapTotal ? percent(s.memory.swapUsed / s.memory.swapTotal) : "—", color: theme.secondary },
        { label: "Load:", value: `${num(s.cpu.load[0], 2)} ${num(s.cpu.load[1], 2)} ${num(s.cpu.load[2], 2)}` },
        { label: "Processes:", value: String(s.system.processCount || s.processes.length) },
        { label: "Threads:", value: String(s.system.threadCount) },
      ], { spread: false });
    });
    p.panel({ title: "CPU History", size: "1fr", min: 5 }, (g) => {
      g.graph({ values: s.cpu.history, min: 0, max: 100, axis: true, fill: true, color: theme.success });
    });
    // Sub-panels need both width and height to be legible; otherwise they are
    // replaced by a single dense stat line.
    if (p.width >= 46 && p.height >= 16) {
      p.row({ size: 6, gap: 1 }, (r) => {
        r.panel({ title: "Quick Stats" }, (q) => {
          q.keyValues([
            { label: "Uptime", value: duration(s.system.uptime), color: theme.accent },
            { label: "Procs", value: String(s.system.processCount || s.processes.length), color: theme.accent },
            { label: "Threads", value: s.system.threadCount ? String(s.system.threadCount) : "—", color: theme.accent },
            // contextSwitches is cumulative since boot; the per-second rate is
            // what the label claims, and what the Services screen already uses.
            { label: "Ctx/s", value: `${(s.telemetry.kernel.contextSwitchRate / 1000).toFixed(1)}K`, color: theme.accent },
          ]);
        });
        r.panel({ title: "Memory" }, (q) => {
          q.text(percent(s.memory.used / Math.max(1, s.memory.total)), { fg: theme.warning, size: 1 });
          q.graph({ values: s.memory.history, min: 0, max: 100, fill: true, color: theme.primary });
        });
        r.panel({ title: "Temp", width: 14 }, (q) => {
          const temp = s.temperatures[0];
          q.gauge({
            value: temp ? Math.min(1, temp.value / (temp.max || 100)) : s.cpu.total,
            label: temp ? `${Math.round(temp.value)}°C` : percent(s.cpu.total),
          });
        });
      });
    } else {
      p.divider({ size: 1 });
      p.keyValues([
        { label: "Threads", value: String(s.system.threadCount), color: theme.accent },
        { label: "Ctx switches", value: `${(s.system.contextSwitches / 1000).toFixed(1)}K`, color: theme.accent },
      ], { size: 2 });
    }
  });
}

function processesPanel(ui: Container, state: DemoState, theme: Theme): void {
  const rows = visibleProcesses(state);
  ui.panel({
    title: `Processes (sorted by ${state.sort.toUpperCase()})`,
    subtitle: state.filter ? `filter: ${state.filter}` : undefined,
    focusable: true,
  }, (p) => {
    const procs = pane(state, "dashboard.processes", rows.length);
    p.table({
      rows,
      selected: procs.selected,
      offset: procs.offset,
      followSelection: true,
      onScroll: (delta) => scrollPane(procs, delta),
      onFocus: () => focusPane(state, "dashboard.processes"),
      onSelectRow: (row) => { procs.selected = procs.offset + row; },
      scrollbar: true,
      columns: [
        { key: "pid", title: "PID", width: 7, align: "right" },
        { key: "name", title: "Name", min: 8, color: theme.primary },
        { key: "cpu", title: "CPU%", width: 6, align: "right", render: (r) => num(r.cpu, 1), color: (r) => heatColor(theme, Math.min(1, r.cpu / 100)) },
        { key: "mem", title: "MEM%", width: 6, align: "right", render: (r) => num(r.mem, 1), color: theme.warning },
        { key: "rss", title: "RSS", width: 9, align: "right", render: (r) => bytes(r.rss, 0) },
        { key: "threads", title: "Threads", width: 7, align: "right" },
        { key: "state", title: "S", width: 2, color: (r) => (r.state === "R" ? theme.success : theme.muted) },
        { key: "user", title: "User", width: 10, color: theme.muted },
        { key: "command", title: "Command", min: 10, color: theme.muted },
      ],
    });
  });
}

function networkPanel(ui: Container, state: DemoState, theme: Theme): void {
  const net = state.sample.network;
  ui.panel({ title: "Network" }, (p) => {
    p.row({ size: 1 }, (r) => {
      r.text(`Download: ${bitRate(net.downRate)}`, { fg: theme.primary });
      r.text(`Upload: ${bitRate(net.upRate)}`, { fg: theme.secondary, align: "right" });
    });
    p.graph({ values: net.downHistory, fill: true, color: theme.primary, min: 0, size: "1fr", axis: true, axisFormat: (v) => bitRate(v).replace(" ", "") });
    p.graph({ values: net.upHistory, fill: true, color: theme.secondary, min: 0, size: "1fr", axis: true, axisFormat: (v) => bitRate(v).replace(" ", "") });
    p.divider();
    p.row({ size: 3, gap: 2 }, (r) => {
      r.keyValues([
        { label: "Total:", value: bytes(net.downTotal), color: theme.primary },
        { label: "Current:", value: bitRate(net.downRate), color: theme.primary },
        { label: "Peak:", value: bitRate(net.downPeak), color: theme.primary },
      ], { spread: false });
      r.keyValues([
        { label: "Total:", value: bytes(net.upTotal), color: theme.secondary },
        { label: "Current:", value: bitRate(net.upRate), color: theme.secondary },
        { label: "Peak:", value: bitRate(net.upPeak), color: theme.secondary },
      ], { spread: false });
    });
  });
}

function diskUsagePanel(ui: Container, state: DemoState, theme: Theme): void {
  const disks = state.sample.disks;
  ui.panel({ title: "Disk Usage", subtitle: disks[0]?.device }, (p) => {
    disks.forEach((disk) => {
      const used = disk.total > 0 ? disk.used / disk.total : 0;
      p.meter({
        value: used,
        text: `${percent(used)} ${bytes(disk.used, 0)} / ${bytes(disk.total, 0)}`,
        style: "segmented",
        size: 1,
      });
      p.label(`${disk.mount} (${disk.device})`, { size: 1 });
    });
    p.spacer(1);
    p.panel({ title: "I/O Summary", size: "1fr" }, (io) => {
      io.row({ gap: 2 }, (r) => {
        r.column({}, (c) => {
          c.text(`Read: ${byteRate(disks[0]?.readRate ?? 0)}`, { fg: theme.success, size: 1 });
          c.graph({ values: disks[0]?.readHistory ?? [], color: theme.success, fill: true, min: 0 });
        });
        r.column({}, (c) => {
          c.text(`Write: ${byteRate(disks[0]?.writeRate ?? 0)}`, { fg: theme.secondary, size: 1 });
          c.graph({ values: disks[0]?.writeHistory ?? [], color: theme.secondary, fill: true, min: 0 });
        });
      });
    });
  });
}

function temperaturesPanel(ui: Container, state: DemoState, theme: Theme): void {
  const temps = state.sample.temperatures;
  ui.panel({ title: "Temperatures" }, (p) => {
    if (temps.length === 0) {
      p.text("No thermal sensors on this host.", { fg: theme.muted, size: 1 });
      if (state.sensorNote) p.label(state.sensorNote, { wrap: true });
      p.spacer(1);
      p.label("Run with --sim to see this panel populated.", { wrap: true });
      return;
    }
    temps.slice(0, 10).forEach((temp) => {
      p.row({ size: 1 }, (r) => {
        r.text(temp.label, { fg: theme.muted, width: 16 });
        r.heatBar({ value: Math.min(1, temp.value / (temp.max || 100)) });
        r.text(`${Math.round(temp.value)}°C`, { fg: heatColor(theme, temp.value / (temp.max || 100)), width: 6, align: "right" });
      });
    });
  });
}

function sensorsPanel(ui: Container, state: DemoState, theme: Theme): void {
  ui.panel({ title: "Sensors" }, (p) => {
    const sensors = state.sample.sensors;
    if (sensors.length === 0) {
      p.text("No hardware sensors on this host.", { fg: theme.muted, size: 1 });
      if (state.sensorNote) p.label(state.sensorNote, { wrap: true });
      p.spacer(1);
      p.label("Probed: /sys/class/hwmon, thermal zones, lm-sensors,", { size: 1 });
      p.label("power supplies and nvidia-smi.", { size: 1 });
      return;
    }
    p.keyValues(sensors.map((s) => ({ label: s.label, value: s.value, color: theme.accent })));
  });
}

function logsPanel(ui: Container, state: DemoState): void {
  ui.panel({ title: "Logs" }, (p) => {
    const logs = pane(state, "dashboard.logs", state.sample.logs.length, "log");
    p.log({
      entries: state.sample.logs.map((l) => ({
        time: l.time,
        level: l.level,
        message: l.message,
        meta: `{${l.meta}}`,
      })),
      // Lines scrolled back from the newest; 0 keeps it tailing.
      fromEnd: logs.offset,
      scrollbar: true,
      onScroll: (delta) => scrollPane(logs, -delta),
      onFocus: () => focusPane(state, "dashboard.logs"),
    });
  });
}

export function visibleProcesses(state: DemoState): DemoState["sample"]["processes"] {
  const filter = state.filter.toLowerCase();
  const rows = filter
    ? state.sample.processes.filter((p) => p.name.toLowerCase().includes(filter) || p.command.toLowerCase().includes(filter))
    : state.sample.processes;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (state.sort) {
      case "mem": return b.mem - a.mem;
      case "pid": return a.pid - b.pid;
      case "name": return a.name.localeCompare(b.name);
      default: return b.cpu - a.cpu;
    }
  });
  return sorted;
}

/** The reference dashboard. Three layouts, chosen by terminal width. */
export function dashboardScreen(ui: Container, state: DemoState, theme: Theme): void {
  ui.responsive({
    150: (wide) => {
      // The System column holds nested panels, so it gets the extra width —
      // and extra height whenever the terminal is tall enough to spare it.
      wide.row({ size: wide.height >= 44 ? 19 : 16, gap: 1 }, (r) => {
        r.column({ width: "1fr" }, (c) => cpuPanel(c, state, theme, 2));
        r.column({ width: "0.95fr" }, (c) => memoryPanel(c, state, theme));
        r.column({ width: "0.95fr" }, (c) => disksPanel(c, state, theme));
        r.column({ width: "1.35fr" }, (c) => systemPanel(c, state, theme));
      });
      wide.row({ size: "1fr", gap: 1 }, (r) => {
        r.column({ width: "2fr" }, (c) => processesPanel(c, state, theme));
        r.column({ width: "1.2fr" }, (c) => networkPanel(c, state, theme));
        r.column({ width: "1.2fr" }, (c) => diskUsagePanel(c, state, theme));
      });
      wide.row({ size: 12, gap: 1 }, (r) => {
        temperaturesPanel(r, state, theme);
        sensorsPanel(r, state, theme);
        r.column({ width: "1.6fr" }, (c) => logsPanel(c, state));
      });
    },
    100: (medium) => {
      medium.row({ size: 14, gap: 1 }, (r) => {
        cpuPanel(r, state, theme, 2);
        memoryPanel(r, state, theme);
        systemPanel(r, state, theme);
      });
      medium.row({ size: "1fr", gap: 1 }, (r) => {
        r.column({ width: "1.6fr" }, (c) => processesPanel(c, state, theme));
        r.column({}, (c) => networkPanel(c, state, theme));
      });
      medium.row({ size: 10, gap: 1 }, (r) => {
        temperaturesPanel(r, state, theme);
        logsPanel(r, state);
      });
    },
    0: (compact) => {
      compact.row({ size: 10, gap: 1 }, (r) => {
        cpuPanel(r, state, theme, 1);
        memoryPanel(r, state, theme);
      });
      compact.column({ size: "1fr" }, (c) => processesPanel(c, state, theme));
      compact.row({ size: 8, gap: 1 }, (r) => networkPanel(r, state, theme));
    },
  });
}
