/**
 * The `hqtui` command.
 *
 *   hqtui              a built-in showcase of the widget set
 *   hqtui doctor       what your terminal can actually do
 *   hqtui demo         the showcase, explicitly
 *
 * The full system dashboard lives in `@profullstack/hqtui-demo`, which is a
 * separate package so this one keeps its promise of touching nothing.
 */
import { createApp } from "./app.ts";
import { detectCapabilities } from "./capabilities.ts";
import { themeList, themes } from "./theme.ts";
import { BrailleCanvas } from "./graphics/braille.ts";

const VERSION = "0.1.10";

function help(): void {
  console.log(`hqtui ${VERSION} — High Quality Terminal UI for TypeScript

Usage:
  hqtui [command] [options]

Commands:
  demo               Interactive showcase of the widget set (default)
  doctor             Report what this terminal supports
  themes             Print every built-in theme name

Options:
  --theme <name>     dark, dracula, nord, tokyoNight, gruvbox, matrix,
                     monochrome, highContrast, light
  --fps <n>          Frame cap (default 30)
  -h, --help         Show this help
  -v, --version      Show the version

The full system dashboard is a separate package:
  bunx @profullstack/hqtui-demo

Docs: https://hqtui.com`);
}

function doctor(): void {
  const caps = detectCapabilities();
  const rows: [string, string][] = [
    ["TTY", caps.tty ? "yes" : "no (output is redirected)"],
    ["Terminal", caps.program],
    ["Colors", caps.colors],
    ["Unicode", caps.unicode ? "yes" : "no"],
    ["Braille", caps.braille ? "yes" : "no"],
    ["Mouse", caps.mouse ? "yes" : "no"],
    ["Synchronized output", caps.synchronizedOutput ? "yes" : "no"],
    ["Bracketed paste", caps.bracketedPaste ? "yes" : "no"],
    ["Focus events", caps.focusEvents ? "yes" : "no"],
    ["tmux", caps.tmux ? "yes" : "no"],
    ["SSH", caps.ssh ? "yes" : "no"],
    ["Size", `${process.stdout.columns ?? "?"}x${process.stdout.rows ?? "?"}`],
    ["TERM", process.env.TERM ?? "(unset)"],
    ["COLORTERM", process.env.COLORTERM ?? "(unset)"],
    ["Runtime", typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun" : `node ${process.version}`],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  console.log(`\nhqtui doctor — ${VERSION}\n`);
  for (const [label, value] of rows) console.log(`  ${label.padEnd(width)}   ${value}`);

  if (caps.colors === "truecolor") {
    let ramp = "\n  ";
    for (let i = 0; i < 60; i++) {
      const t = i / 59;
      const r = Math.round(255 * Math.min(1, t * 2));
      const g = Math.round(255 * Math.min(1, 2 - t * 2));
      ramp += `\x1b[38;2;${r};${g};120m█`;
    }
    console.log(`${ramp}\x1b[0m`);
  }
  if (caps.braille) {
    const canvas = new BrailleCanvas(30, 2);
    for (let x = 0; x < canvas.width; x++) {
      canvas.pixel(x, Math.round((Math.sin(x / 6) * 0.5 + 0.5) * (canvas.height - 1)));
    }
    console.log(`\n  ${canvas.toLines().join("\n  ")}`);
  }
  console.log();
}

async function demo(themeName: string, fps: number): Promise<void> {
  const history: number[] = [];
  const cores = new Array(8).fill(0.2);
  let tick = 0;
  let selected = 0;
  let themeIndex = Math.max(0, themeList.findIndex((t) => t.name === themeName));

  const app = await createApp({
    theme: themeList[themeIndex] ?? themes.dark,
    fps,
    title: "hqtui",
  });

  const timer = setInterval(() => {
    tick++;
    const base = 0.35 + Math.sin(tick / 18) * 0.22;
    for (let i = 0; i < cores.length; i++) {
      cores[i] = Math.max(0.02, Math.min(1, base + Math.sin(tick / 7 + i) * 0.18 + Math.random() * 0.08));
    }
    history.push((cores.reduce((a, b) => a + b, 0) / cores.length) * 100);
    if (history.length > 400) history.shift();
    app.invalidate();
  }, 100);
  timer.unref?.();

  app.on("key", (event) => {
    if (event.name === "t" || event.name === "f2") {
      themeIndex = (themeIndex + 1) % themeList.length;
      app.setTheme(themeList[themeIndex]);
    }
    if (event.name === "down") selected = Math.min(5, selected + 1);
    if (event.name === "up") selected = Math.max(0, selected - 1);
  });

  const rows = [
    { name: "renderer", detail: "typed-array framebuffer + diff", value: "0.29 ms" },
    { name: "graphics", detail: "braille, block, half, quadrant, ascii", value: "2x4 px" },
    { name: "layout", detail: "rows, columns, grid, fr, %, auto", value: "solved" },
    { name: "widgets", detail: "30+, all themeable", value: "ready" },
    { name: "input", detail: "keys, mouse, paste, focus", value: "normalized" },
    { name: "testing", detail: "headless: text, ansi, html, cells", value: "no TTY" },
  ];

  app.render(({ ui, theme, width }) => {
    ui.row({ size: 1 }, (header) => {
      header.text(" hqtui", { fg: theme.title, bold: true, size: 8 });
      header.text(`High Quality Terminal UI · ${theme.name}`, { fg: theme.muted });
      header.text("hqtui.com ", { fg: theme.accent, align: "right" });
    });
    ui.spacer(1);
    ui.row({ size: "1fr", gap: 1 }, (row) => {
      row.panel({ title: "CPU", subtitle: `${Math.round((history.at(-1) ?? 0))}%` }, (p) => {
        p.graph({ values: history, min: 0, max: 100, fill: true, color: theme.success });
        p.meters(cores.map((value, i) => ({ label: `P${i}`, value })), {
          columns: width >= 90 ? 2 : 1,
          labelWidth: 4,
          style: "segmented",
        });
      });
      row.panel({ title: "What you get", width: "1.1fr" }, (p) => {
        p.table({
          rows,
          selected,
          zebra: true,
          columns: [
            { key: "name", title: "Module", width: 10, color: theme.primary },
            { key: "detail", title: "Detail", color: theme.muted },
            { key: "value", title: "", width: 11, align: "right", color: theme.accent },
          ],
        });
        p.spacer(1);
        p.divider({ label: "gauges" });
        p.row({ size: "1fr", gap: 2 }, (r) => {
          r.gauge({ value: (history.at(-1) ?? 0) / 100, label: `${Math.round(history.at(-1) ?? 0)}%` });
          r.donut({ segments: [{ value: 27 }, { value: 73 }] });
        });
      });
    });
    ui.spacer(1);
    ui.statusBar({
      items: [
        { key: "t", label: "Theme" },
        { key: "↑↓", label: "Select" },
        { key: "q", label: "Quit" },
      ],
      right: [{ label: "bunx @profullstack/hqtui-demo for the full dashboard" }],
    });
  });

  app.on("exit", () => clearInterval(timer));
  await app.start();
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let theme = "dark";
  let fps = 30;
  const commands: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return help();
    if (arg === "-v" || arg === "--version") return console.log(VERSION);
    if (arg === "--theme") {
      theme = argv[++i] ?? "dark";
      continue;
    }
    if (arg === "--fps") {
      fps = Number(argv[++i]) || 30;
      continue;
    }
    if (!arg.startsWith("-")) commands.push(arg);
  }

  switch (commands[0]) {
    case "doctor":
      return doctor();
    case "themes":
      return console.log(themeList.map((t) => t.name).join("\n"));
    case undefined:
    case "demo":
      return demo(theme, fps);
    default:
      console.error(`hqtui: unknown command "${commands[0]}"\n`);
      help();
      process.exitCode = 1;
  }
}
