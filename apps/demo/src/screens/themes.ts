import type { Container, Theme } from "@profullstack/hqtui";
import { themeList } from "@profullstack/hqtui";
import type { DemoState } from "../state.ts";

/** Live theme switching. Every theme renders the same content side by side. */
export function themesScreen(ui: Container, state: DemoState, theme: Theme): void {
  const values = state.sample.cpu.history;
  ui.label(`Theme ${state.themeIndex + 1}/${themeList.length}: ${theme.name}   ←/→ or F2 to change`, { size: 1 });
  ui.spacer(1);
  ui.grid({ columns: 3, rows: Math.ceil(themeList.length / 3), gap: 1 }, (grid) => {
    themeList.forEach((entry, i) => {
      grid.panel({
        title: entry.name,
        borderColor: i === state.themeIndex ? entry.borderFocused : entry.border,
        background: entry.background,
      }, (p) => {
        p.row({ size: 1, gap: 1 }, (r) => {
          r.badge({ text: "primary", color: entry.primary, size: 10 });
          r.badge({ text: "ok", color: entry.success, size: 5 });
          r.badge({ text: "warn", color: entry.warning, size: 7 });
          r.badge({ text: "err", color: entry.danger, size: 6 });
          r.spacer("fill");
        });
        p.meter({ value: 0.72, label: "cpu", background: entry.background, size: 1 });
        p.graph({
          values,
          min: 0,
          max: 100,
          fill: true,
          color: entry.graph[0],
          background: entry.background,
        });
        p.draw((surface) => {
          entry.graph.forEach((color, ci) => {
            for (let x = 0; x < 3; x++) surface.char(ci * 4 + x, 0, "█", { fg: color, bg: entry.background });
          });
        }, { size: 1 });
      });
    });
  });
}
