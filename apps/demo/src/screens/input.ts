import type { Container, Theme } from "@profullstack/hqtui";
import type { DemoState } from "../state.ts";

/** Keyboard and mouse event visualizer — useful when debugging bindings. */
export function inputScreen(ui: Container, state: DemoState, theme: Theme): void {
  ui.row({ size: "1fr", gap: 1 }, (row) => {
    row.panel({ title: "Last Events" }, (p) => {
      p.keyValues([
        { label: "Key", value: state.lastKey, color: theme.accent },
        { label: "Mouse", value: state.lastMouse, color: theme.primary },
      ]);
      p.spacer(1);
      p.divider({ label: "history" });
      p.list({ items: state.keyLog.slice(-20).reverse() });
    });
    row.panel({ title: "Try it" }, (p) => {
      p.text("Press any key — modifiers are normalized.", { fg: theme.foreground, size: 1 });
      p.label("Arrows, Function keys, Ctrl/Alt/Shift combinations,", { size: 1 });
      p.label("paste, focus, mouse move, click, drag and scroll.", { size: 1 });
      p.spacer(1);
      p.divider({ label: "focusable controls" });
      p.spacer(1);
      p.row({ size: 1, gap: 2 }, (r) => {
        r.button({ label: "Button A", width: 12, size: 12 });
        r.button({ label: "Button B", width: 12, size: 12, variant: "success" });
        r.checkbox({ label: "Check", checked: state.checkbox, size: 12, onToggle: () => { state.checkbox = !state.checkbox; } });
        r.spacer("fill");
      });
      p.spacer(1);
      p.label("Tab / Shift+Tab moves focus. Enter activates.", { size: 1 });
      p.spacer("fill");
      p.keyValues([
        { label: "Mouse tracking", value: "on" },
        { label: "Bracketed paste", value: "on" },
        { label: "Focus events", value: "on" },
      ]);
    });
  });
}
