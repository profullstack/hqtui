import type { Container, Theme } from "@profullstack/hqtui";
import { cursor, type DemoState } from "../state.ts";
import { bytes, num, percent } from "../format.ts";

function rate(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K/s`;
  return `${value.toFixed(0)}/s`;
}

/** Services, containers, kernel counters, filesystems and hardware sensors. */
export function servicesScreen(ui: Container, state: DemoState, theme: Theme): void {
  const t = state.sample.telemetry;
  const failed = t.services.filter((s) => s.active === "failed");

  ui.row({ size: "1fr", gap: 1 }, (row) => {
    row.panel({
      title: "Services",
      subtitle: failed.length ? `${failed.length} failed` : `${t.services.length} units`,
      subtitleColor: failed.length ? theme.danger : theme.muted,
      borderColor: failed.length ? theme.danger : theme.success,
    }, (p) => {
      if (t.services.length === 0) {
        p.label("systemd not available on this host.");
        return;
      }
      p.table({
        rows: t.services,
        selected: cursor(state).selected,
        offset: cursor(state).offset,
        followSelection: true,
        zebra: true,
        scrollbar: true,
        columns: [
          { key: "name", title: "Unit", min: 18, color: theme.primary },
          {
            key: "active",
            title: "Active",
            width: 10,
            color: (row) =>
              row.active === "failed" ? theme.danger : row.active === "active" ? theme.success : theme.muted,
          },
          { key: "sub", title: "Sub", width: 10, color: theme.muted },
          { key: "description", title: "Description", min: 16, color: theme.muted },
        ],
      });
    });

    row.column({ width: "0.85fr", gap: 1 }, (column) => {
      column.panel({ title: "Kernel", size: 11, borderColor: theme.accent }, (p) => {
        const k = t.kernel;
        p.keyValues([
          { label: "Context switches", value: rate(k.contextSwitchRate), color: theme.accent },
          { label: "Interrupts", value: rate(k.interruptRate), color: theme.accent },
          { label: "Forks", value: rate(k.forkRate), color: theme.accent },
          { label: "Procs running", value: String(k.procsRunning), color: theme.success },
          { label: "Procs blocked", value: String(k.procsBlocked), color: k.procsBlocked ? theme.warning : theme.muted },
          { label: "Open file descriptors", value: k.openFiles.toLocaleString(), color: theme.primary },
          { label: "Entropy available", value: String(k.entropy), color: k.entropy < 200 ? theme.warning : theme.success },
          { label: "Page in / out", value: `${(k.pageIn / 1000).toFixed(0)}K / ${(k.pageOut / 1000).toFixed(0)}K`, color: theme.muted },
        ]);
      });

      column.panel({ title: "Containers", size: 9, borderColor: theme.primary }, (p) => {
        if (t.containers.length === 0) {
          p.label("No running containers.");
          p.label("(docker not installed or not reachable)", { size: 1 });
          return;
        }
        p.table({
          rows: t.containers,
          zebra: true,
          columns: [
            { key: "name", title: "Name", min: 12, color: theme.primary },
            { key: "image", title: "Image", min: 14, color: theme.muted },
            { key: "status", title: "Status", min: 12, color: theme.success },
          ],
        });
      });

      column.panel({ title: "Hardware", size: "1fr", borderColor: theme.warning }, (p) => {
        const rows: { label: string; value: string; color?: number }[] = [];
        if (t.power) {
          rows.push(
            { label: "Battery", value: `${t.power.battery}% (${t.power.timeRemaining})`, color: theme.success },
            { label: "AC", value: t.power.acConnected ? "connected" : "on battery", color: theme.muted },
            { label: "Draw", value: `${num(t.power.powerDraw, 1)} W`, color: theme.warning },
          );
        }
        for (const gpu of t.gpus) {
          rows.push(
            { label: gpu.name, value: `${percent(gpu.utilization)} · ${gpu.temperature}°C`, color: theme.accent },
            { label: "GPU memory", value: `${bytes(gpu.memoryUsed)} / ${bytes(gpu.memoryTotal)}`, color: theme.muted },
          );
        }
        if (rows.length === 0) {
          p.label("No battery or GPU telemetry on this host.");
          return;
        }
        p.keyValues(rows);
      });
    });
  });

  ui.panel({ title: "Filesystems", size: 10, borderColor: theme.secondary }, (p) => {
    if (t.filesystems.length === 0) {
      p.label("No filesystems reported.");
      return;
    }
    p.table({
      rows: t.filesystems,
      zebra: true,
      columns: [
        { key: "mount", title: "Mount", min: 14, color: theme.primary },
        { key: "device", title: "Device", min: 12, color: theme.muted },
        { key: "type", title: "Type", width: 8, color: theme.muted },
        { key: "size", title: "Size", width: 10, align: "right", render: (r) => bytes(r.size, 0) },
        { key: "used", title: "Used", width: 10, align: "right", render: (r) => bytes(r.used, 0) },
        {
          key: "pct",
          title: "Use%",
          width: 6,
          align: "right",
          render: (r) => (r.size ? percent(r.used / r.size) : "-"),
          color: (r) => (r.size && r.used / r.size > 0.9 ? theme.danger : theme.warning),
        },
        {
          key: "inodes",
          title: "Inodes",
          width: 16,
          align: "right",
          render: (r) => (r.inodesTotal ? `${percent(r.inodesUsed / r.inodesTotal)} of ${(r.inodesTotal / 1e6).toFixed(1)}M` : "-"),
          color: theme.muted,
        },
      ],
    });
  });
}
