import type { Container, Theme } from "@profullstack/hqtui";
import { gradientSteps } from "@profullstack/hqtui";
import type { DemoState } from "../state.ts";

function wave(count: number, phase: number, freq: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.sin(i / freq + phase) * 50 + 50);
}

/** Rendering-mode comparison: braille vs block vs ascii, plus raw canvas access. */
export function graphicsScreen(ui: Container, state: DemoState, theme: Theme): void {
  const t = state.sample.time;
  const a = wave(240, t / 3, 9);
  const b = wave(240, t / 3 + 2, 5);
  const c = wave(240, t / 2, 17);

  ui.row({ size: "1fr", gap: 1 }, (row) => {
    row.column({ gap: 1 }, (left) => {
      left.panel({ title: "Braille (2×4 pixels per cell)" }, (p) => {
        p.graph({ values: a, min: 0, max: 100, fill: true, color: theme.accent, grid: true });
      });
      left.panel({ title: "Block elements" }, (p) => {
        p.graph({ values: a, min: 0, max: 100, mode: "block", colors: theme.heat });
      });
      left.panel({ title: "ASCII fallback" }, (p) => {
        p.graph({ values: a, min: 0, max: 100, mode: "ascii", color: theme.foreground });
      });
    });

    row.column({ gap: 1 }, (right) => {
      right.panel({ title: "Multi-series" }, (p) => {
        p.multiGraph(
          [
            { values: a, color: theme.primary, label: "alpha" },
            { values: b, color: theme.success, label: "beta" },
            { values: c, color: theme.secondary, label: "gamma" },
          ],
          { min: 0, max: 100, legend: true, axis: true },
        );
      });
      right.panel({ title: "Gradients" }, (p) => {
        p.draw((surface) => {
          const steps = gradientSteps(theme.heat, surface.width);
          for (let y = 0; y < surface.height; y++) {
            for (let x = 0; x < surface.width; x++) {
              surface.char(x, y, "█", { fg: steps[x] });
            }
          }
        });
      });
      right.panel({ title: "Raw Braille canvas" }, (p) => {
        p.canvas((canvas) => {
          const cx = canvas.width / 2;
          const cy = canvas.height / 2;
          const r = Math.min(cx, cy) - 2;
          canvas.circle(cx, cy, r);
          for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2 + t / 4;
            canvas.line(cx, cy, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r * 0.9);
          }
        }, { color: theme.accent });
      });
    });
  });
}
