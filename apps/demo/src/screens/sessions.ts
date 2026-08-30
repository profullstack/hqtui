import type { Container, Theme } from "@profullstack/hqtui";
import { focusPane, pane, scrollPane, type DemoState } from "../state.ts";

/** Who is on this machine, who has been, and who failed to get in. */
export function sessionsScreen(ui: Container, state: DemoState, theme: Theme): void {
  const t = state.sample.telemetry;

  ui.row({ size: 9, gap: 1 }, (row) => {
    row.panel({ title: "Active Sessions", subtitle: String(t.sessions.length), borderColor: theme.success }, (p) => {
      if (t.sessions.length === 0) {
        p.label("No interactive sessions.");
        p.label("(`who` reports nothing on this host)", { size: 1 });
        return;
      }
      p.table({
        rows: t.sessions,
        columns: [
          { key: "user", title: "User", width: 12, color: theme.primary },
          { key: "tty", title: "TTY", width: 10 },
          { key: "from", title: "From", min: 12, color: theme.accent },
          { key: "loginAt", title: "Login", width: 14, color: theme.muted },
          { key: "idle", title: "Idle", width: 8, align: "right" },
        ],
      });
    });
    row.panel({ title: "Process States", width: 34, borderColor: theme.primary }, (p) => {
      const s = t.states;
      p.meter({ label: "run ", value: s.total ? s.running / s.total : 0, text: String(s.running), heat: false, color: theme.success });
      p.meter({ label: "slp ", value: s.total ? s.sleeping / s.total : 0, text: String(s.sleeping), heat: false, color: theme.primary });
      p.meter({ label: "stop", value: s.total ? s.stopped / s.total : 0, text: String(s.stopped), heat: false, color: theme.warning });
      p.meter({ label: "zomb", value: s.total ? s.zombie / s.total : 0, text: String(s.zombie), heat: false, color: theme.danger });
      p.spacer(1);
      p.keyValues([{ label: "Total", value: String(s.total), color: theme.accent }]);
    });
  });

  ui.row({ size: "1fr", gap: 1 }, (row) => {
    row.panel({ title: "Recent Logins", subtitle: `${t.logins.length} from wtmp`, borderColor: theme.accent }, (p) => {
      if (t.logins.length === 0) {
        p.label("No login history available.");
        return;
      }
      const logins = pane(state, "sessions.logins", t.logins.length);
      p.table({
        rows: t.logins,
        selected: logins.selected,
        offset: logins.offset,
        followSelection: true,
        onScroll: (delta) => scrollPane(logins, delta),
        onFocus: () => focusPane(state, "sessions.logins"),
        onSelectRow: (row) => { logins.selected = logins.offset + row; },
        zebra: true,
        scrollbar: true,
        columns: [
          { key: "user", title: "User", width: 12, color: theme.primary },
          { key: "tty", title: "TTY", width: 12, color: theme.muted },
          { key: "from", title: "From", min: 14, color: theme.accent },
          { key: "when", title: "When", min: 16, color: theme.muted },
          {
            key: "status",
            title: "Status",
            width: 8,
            color: (row) => (row.status === "still" ? theme.success : theme.muted),
          },
        ],
      });
    });

    row.column({ width: "0.8fr", gap: 1 }, (column) => {
      column.panel({ title: "Failed Logins", borderColor: theme.danger }, (p) => {
        if (t.failedLogins.length === 0) {
          p.label("None recorded.");
          p.label("(btmp is usually root-only)", { size: 1 });
          return;
        }
        p.table({
          rows: t.failedLogins,
          columns: [
            { key: "user", title: "User", width: 12, color: theme.danger },
            { key: "from", title: "From", min: 12 },
            { key: "when", title: "When", min: 14, color: theme.muted },
          ],
        });
      });
      column.panel({ title: "Session History", size: 8, borderColor: theme.secondary }, (p) => {
        p.label("concurrent sessions", { size: 1 });
        p.graph({ values: t.sessionHistory, min: 0, fill: true, color: theme.success });
      });
    });
  });
}
