import type { Container, Theme } from "@profullstack/hqtui";
import { seriesColor } from "@profullstack/hqtui";
import { cursor, type DemoState } from "../state.ts";
import { num, percent } from "../format.ts";

function rate(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M/s`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K/s`;
  return `${value.toFixed(0)}/s`;
}

const STATUS_COLORS = (theme: Theme): Record<string, number> => ({
  "2xx": theme.success,
  "3xx": theme.accent,
  "4xx": theme.warning,
  "5xx": theme.danger,
  "1xx": theme.secondary,
});

/** Every protocol in and out of this host: sockets, TCP counters, SSH, HTTP. */
export function trafficScreen(ui: Container, state: DemoState, theme: Theme): void {
  const t = state.sample.telemetry;
  const net = t.net;
  const http = t.http;

  ui.row({ size: 13, gap: 1 }, (row) => {
    row.panel({
      title: "Protocols",
      subtitle: `${t.inboundConnections} in / ${t.outboundConnections} out`,
      borderColor: theme.accent,
    }, (p) => {
      if (t.protocols.length === 0) {
        p.label("No sockets visible.");
        return;
      }
      const max = Math.max(1, ...t.protocols.map((x) => x.total));
      p.meters(
        t.protocols.slice(0, 9).map((bucket, i) => ({
          label: bucket.protocol,
          value: bucket.total / max,
          color: seriesColor(theme, i),
          text: `${bucket.total}`,
        })),
        { labelWidth: 13, valueWidth: 5 },
      );
    });

    row.panel({ title: "TCP", width: "0.9fr", borderColor: theme.primary }, (p) => {
      p.row({ size: 1 }, (r) => {
        r.text(`↓ ${rate(net.rates.inSegs)} seg`, { fg: theme.primary });
        r.text(`↑ ${rate(net.rates.outSegs)} seg`, { fg: theme.secondary, align: "right" });
      });
      p.graph({
        series: [
          { values: t.netInHistory, color: theme.primary, fill: true },
          { values: t.netOutHistory, color: theme.secondary, fill: true },
        ],
        min: 0,
        size: "1fr",
      });
      p.divider();
      p.keyValues([
        { label: "Established", value: String(net.tcpEstablished), color: theme.success },
        { label: "Opens in/out", value: `${rate(net.rates.passiveOpens)} / ${rate(net.rates.activeOpens)}`, color: theme.accent },
        { label: "Resets sent", value: net.tcpOutRsts.toLocaleString(), color: theme.muted },
      ]);
    });

    row.panel({
      title: "Retransmits",
      width: "0.7fr",
      borderColor: net.retransRatio > 0.02 ? theme.danger : theme.success,
    }, (p) => {
      p.text(percent(net.retransRatio, 2), {
        fg: net.retransRatio > 0.02 ? theme.danger : theme.success,
        bold: true,
        size: 1,
      });
      p.label("of outbound segments", { size: 1 });
      p.graph({ values: t.retransHistory, min: 0, fill: true, color: theme.danger, size: "1fr" });
      p.keyValues([
        { label: "UDP in/out", value: `${rate(net.rates.udpIn)} / ${rate(net.rates.udpOut)}`, color: theme.muted },
        { label: "ICMP", value: `${net.icmpInMsgs} / ${net.icmpOutMsgs}`, color: theme.muted },
      ]);
    });
  });

  ui.row({ size: "1fr", gap: 1 }, (row) => {
    row.column({ gap: 1 }, (column) => {
      column.panel({
        title: "HTTP",
        subtitle: http ? `${num(http.requestsPerSecond, 1)} req/s` : "no access log",
        borderColor: theme.success,
      }, (p) => {
        if (!http) {
          p.label("No readable HTTP access log.");
          p.label("nginx, apache, httpd and caddy logs are", { size: 1 });
          p.label("root/adm readable — run with sudo to track requests.", { size: 1 });
          return;
        }
        p.row({ size: 1 }, (r) => {
          r.text(http.source, { fg: theme.muted });
          r.text(`${http.upgrades} upgrades (ws)`, { fg: theme.secondary, align: "right" });
        });
        p.graph({ values: http.history, min: 0, fill: true, color: theme.success, size: 6 });
        p.divider({ label: "status" });
        const colors = STATUS_COLORS(theme);
        const max = Math.max(1, ...http.statusClasses.map((s) => s.count));
        p.meters(
          http.statusClasses.map((entry) => ({
            label: entry.class,
            value: entry.count / max,
            color: colors[entry.class] ?? theme.muted,
            text: String(entry.count),
          })),
          { labelWidth: 5, valueWidth: 7 },
        );
        p.divider({ label: "top paths" });
        p.table({
          rows: http.topPaths,
          header: false,
          columns: [
            { key: "path", title: "Path", min: 20, color: theme.primary },
            { key: "count", title: "Hits", width: 7, align: "right", color: theme.accent },
          ],
        });
      });
    });

    row.column({ width: "0.85fr", gap: 1 }, (column) => {
      column.panel({ title: "SSH Activity", subtitle: String(t.ssh.length), borderColor: theme.warning }, (p) => {
        if (t.ssh.length === 0) {
          p.label("No sshd events in the journal.");
          return;
        }
        p.table({
          rows: [...t.ssh].reverse(),
          selected: cursor(state).selected,
          offset: cursor(state).offset,
          followSelection: true,
          zebra: true,
          scrollbar: true,
          columns: [
            { key: "time", title: "Time", width: 9, color: theme.muted },
            {
              key: "action",
              title: "Action",
              width: 11,
              color: (row) =>
                row.action === "accepted" ? theme.success
                  : row.action === "disconnect" ? theme.muted
                    : theme.danger,
            },
            { key: "user", title: "User", width: 12, color: theme.primary },
            { key: "from", title: "From", min: 14, color: theme.accent },
            { key: "method", title: "Method", width: 10, color: theme.muted },
          ],
        });
      });

      column.panel({ title: "Top Remote Hosts", size: 10, borderColor: theme.secondary }, (p) => {
        if (t.remotes.length === 0) {
          p.label("No remote peers.");
          return;
        }
        p.table({
          rows: t.remotes,
          zebra: true,
          columns: [
            { key: "host", title: "Host", min: 16, color: theme.accent },
            { key: "connections", title: "Conns", width: 6, align: "right", color: theme.success },
            { key: "protocols", title: "Protocols", min: 12, color: theme.muted },
          ],
        });
      });
    });
  });

  if (http && http.recent.length) {
    ui.panel({ title: "Recent Requests", size: 10, borderColor: theme.primary }, (p) => {
      p.table({
        rows: http.recent,
        zebra: true,
        scrollbar: true,
        columns: [
          { key: "time", title: "Time", width: 9, color: theme.muted },
          { key: "method", title: "Method", width: 7, color: theme.secondary },
          { key: "path", title: "Path", min: 24, color: theme.primary },
          {
            key: "status",
            title: "Status",
            width: 7,
            align: "right",
            color: (row) => STATUS_COLORS(theme)[`${String(row.status)[0]}xx`] ?? theme.muted,
          },
          { key: "client", title: "Client", width: 16, color: theme.accent },
          { key: "bytes", title: "Bytes", width: 9, align: "right", color: theme.muted },
        ],
      });
    });
  }
}
