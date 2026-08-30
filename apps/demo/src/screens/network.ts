import type { Container, Theme } from "@profullstack/hqtui";
import { focusPane, pane, scrollPane, type DemoState } from "../state.ts";
import { byteRate, bytes } from "../format.ts";

/** Interfaces, live throughput, open connections and listening ports. */
export function networkScreen(ui: Container, state: DemoState, theme: Theme): void {
  const t = state.sample.telemetry;
  const active = t.interfaces.filter((i) => i.rxTotal > 0 || i.state === "up");
  const shown = (active.length ? active : t.interfaces).slice(0, 3);

  ui.row({ size: 13, gap: 1 }, (row) => {
    if (shown.length === 0) {
      row.panel({ title: "Interfaces" }, (p) => p.label("No interfaces reported."));
      return;
    }
    shown.forEach((iface, index) => {
      const color = [theme.primary, theme.success, theme.secondary][index % 3];
      row.panel({
        title: `${iface.name} (${iface.state})`,
        subtitle: iface.ip,
        borderColor: color,
      }, (p) => {
        p.row({ size: 1 }, (r) => {
          r.text(`↓ ${byteRate(iface.rxRate)}`, { fg: theme.primary });
          r.text(`↑ ${byteRate(iface.txRate)}`, { fg: theme.secondary, align: "right" });
        });
        p.graph({
          series: [
            { values: iface.rxHistory, color: theme.primary, fill: true },
            { values: iface.txHistory, color: theme.secondary, fill: true },
          ],
          min: 0,
          size: "1fr",
        });
        p.divider();
        p.keyValues([
          { label: "RX total", value: bytes(iface.rxTotal), color: theme.primary },
          { label: "TX total", value: bytes(iface.txTotal), color: theme.secondary },
          { label: "MAC", value: iface.mac, color: theme.muted },
          { label: "MTU / err / drop", value: `${iface.mtu} / ${iface.errors} / ${iface.drops}`, color: theme.muted },
        ]);
      });
    });
  });

  ui.row({ size: "1fr", gap: 1 }, (row) => {
    row.panel({
      title: "Connections",
      subtitle: `${t.connections.length} open`,
      borderColor: theme.accent,
    }, (p) => {
      if (t.connections.length === 0) {
        p.label("No connections visible (`ss` unavailable).");
        return;
      }
      const conns = pane(state, "network.connections", t.connections.length);
      p.table({
        rows: t.connections,
        selected: conns.selected,
        offset: conns.offset,
        followSelection: true,
        onScroll: (delta) => scrollPane(conns, delta),
        onFocus: () => focusPane(state, "network.connections"),
        onSelectRow: (row) => { conns.selected = conns.offset + row; },
        zebra: true,
        scrollbar: true,
        columns: [
          { key: "proto", title: "Proto", width: 6, color: theme.muted },
          { key: "local", title: "Local", min: 18 },
          { key: "remote", title: "Remote", min: 18, color: theme.accent },
          { key: "state", title: "State", width: 10, color: theme.success },
          { key: "process", title: "Process", min: 12, color: theme.primary },
        ],
      });
    });

    row.column({ width: "0.7fr", gap: 1 }, (column) => {
      column.panel({ title: "Listening Ports", subtitle: String(t.listeners.length), borderColor: theme.warning }, (p) => {
        const listeners = pane(state, "network.listeners", t.listeners.length);
        p.table({
          rows: t.listeners,
          selected: listeners.selected,
          offset: listeners.offset,
          followSelection: true,
          onScroll: (delta) => scrollPane(listeners, delta),
          onFocus: () => focusPane(state, "network.listeners"),
          onSelectRow: (row) => { listeners.selected = listeners.offset + row; },
          zebra: true,
          scrollbar: true,
          columns: [
            { key: "proto", title: "Proto", width: 6, color: theme.muted },
            { key: "port", title: "Port", width: 7, align: "right", color: theme.warning },
            { key: "address", title: "Address", min: 10, color: theme.muted },
            { key: "process", title: "Process", min: 10, color: theme.primary },
          ],
        });
      });
      column.panel({ title: "Open Connections", size: 6, borderColor: theme.secondary }, (p) => {
        p.graph({ values: t.connectionHistory, min: 0, fill: true, color: theme.accent });
      });
    });
  });
}
