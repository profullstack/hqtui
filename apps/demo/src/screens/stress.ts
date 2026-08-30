import type { Container, Theme } from "@profullstack/hqtui";
import { gradient } from "@profullstack/hqtui";
import type { DemoState } from "../state.ts";
import { num } from "../format.ts";

/** Every cell changes every frame — the worst case for a differential renderer. */
export function stressScreen(ui: Container, state: DemoState, theme: Theme): void {
  const t = state.sample.time;
  ui.row({ size: 3, gap: 1 }, (r) => {
    r.panel({ title: "Render" }, (p) => {
      p.text(`${num(state.renderMs, 2)} ms/frame`, { fg: theme.success });
    });
    r.panel({ title: "Changed cells" }, (p) => {
      p.text(String(state.changedCells), { fg: theme.warning });
    });
    r.panel({ title: "Bytes/frame" }, (p) => {
      p.text(String(state.bytes), { fg: theme.primary });
    });
    r.panel({ title: "FPS" }, (p) => {
      p.text(num(state.fps, 1), { fg: theme.accent });
    });
  });
  ui.panel({ title: "Full-screen churn", size: "1fr" }, (p) => {
    p.draw((surface) => {
      const ramp = gradient(theme.graph);
      const chars = "▖▗▘▙▚▛▜▝▞▟█▓▒░";
      for (let y = 0; y < surface.height; y++) {
        for (let x = 0; x < surface.width; x++) {
          const v = (Math.sin(x / 6 + t) + Math.cos(y / 4 - t)) / 2;
          const n = (v + 1) / 2;
          surface.char(x, y, chars[Math.floor(n * (chars.length - 1))], { fg: ramp(n) });
        }
      }
    });
  });
}
