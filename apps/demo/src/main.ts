// Run directly with `bun src/main.ts`, or via the compiled bin on Node.
/**
 * The HQTUI reference dashboard.
 *
 *   bunx @profullstack/hqtui-demo            # real system metrics
 *   bunx @profullstack/hqtui-demo --sim      # deterministic simulation
 *
 * Also runs under Node 22.6+ (`npx @profullstack/hqtui-demo`).
 */
import { createApp, themeList, themes, type KeyEvent } from "@profullstack/hqtui";
import { createCollector } from "./system/index.ts";
import { intervalMs } from "./options.ts";
import { createState, focusedPane, moveSelection, SCREENS, type ScreenName } from "./state.ts";
import {
  componentsScreen, dashboardScreen, graphicsScreen, inputScreen, networkScreen, servicesScreen,
  sessionsScreen, stressScreen, themesScreen, trafficScreen, visibleProcesses,
} from "./screens/index.ts";
import { clock, num } from "./format.ts";

interface Options {
  real: boolean;
  seed: number;
  fps: number;
  theme: string;
  screen: ScreenName;
  interval: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    real: true,
    seed: 1337,
    fps: 30,
    theme: "dark",
    screen: "dashboard",
    interval: 1000,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--sim":
      case "--fake":
      case "--simulate": options.real = false; break;
      case "--real": options.real = true; break;
      case "--seed": options.seed = Number(value) || 1337; i++; break;
      case "--fps": options.fps = Number(value) || 30; i++; break;
      case "--theme": options.theme = value ?? "dark"; i++; break;
      case "--screen": options.screen = (value as ScreenName) ?? "dashboard"; i++; break;
      case "--interval": options.interval = intervalMs(value); i++; break;
      case "-h":
      case "--help": printHelp(); process.exit(0);
      case "-v":
      case "--version": console.log("hqtui-demo 0.1.9"); process.exit(0);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`hqtui-demo — the HQTUI reference dashboard

Usage:
  hqtui-demo [options]

Options:
  --sim              Use the deterministic simulation instead of real metrics
  --real             Read real system metrics (default)
  --seed <n>         Simulation seed (default 1337)
  --fps <n>          Frame cap (default 30, 15 over SSH)
  --theme <name>     dark, dracula, nord, tokyoNight, gruvbox, matrix, monochrome, highContrast, light
  --screen <name>    dashboard, components, graphics, themes, input, stress
  --interval <ms>    Metric refresh interval (default 1000)
  -h, --help         Show this help
  -v, --version      Show the version

Keys:
  1-6 / Tab screens   F2 theme   F3 filter   F6 sort   Ctrl+K palette
  ↑/↓ select          Space pause            F1 help   q quit
`);
}

const PALETTE_COMMANDS: { label: string; hint: string; run: (state: ReturnType<typeof createState>) => void }[] = [
  { label: "Go to Dashboard", hint: "1", run: (s) => { s.screen = "dashboard"; } },
  { label: "Go to Traffic", hint: "2", run: (s) => { s.screen = "traffic"; } },
  { label: "Go to Sessions", hint: "3", run: (s) => { s.screen = "sessions"; } },
  { label: "Go to Network", hint: "4", run: (s) => { s.screen = "network"; } },
  { label: "Go to Services", hint: "5", run: (s) => { s.screen = "services"; } },
  { label: "Go to Components", hint: "6", run: (s) => { s.screen = "components"; } },
  { label: "Go to Graphics", hint: "7", run: (s) => { s.screen = "graphics"; } },
  { label: "Go to Themes", hint: "8", run: (s) => { s.screen = "themes"; } },
  { label: "Go to Input", hint: "9", run: (s) => { s.screen = "input"; } },
  { label: "Go to Stress Test", hint: "0", run: (s) => { s.screen = "stress"; } },
  { label: "Sort by CPU", hint: "F6", run: (s) => { s.sort = "cpu"; } },
  { label: "Sort by Memory", hint: "F6", run: (s) => { s.sort = "mem"; } },
  { label: "Pause updates", hint: "Space", run: (s) => { s.paused = !s.paused; } },
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const collector = await createCollector({ real: options.real, seed: options.seed });
  await collector.refresh(options.interval / 1000);

  const state = createState(collector.current(), collector.source, collector.unavailable, collector.sensorNote ?? "");
  state.screen = SCREENS.includes(options.screen) ? options.screen : "dashboard";
  state.themeIndex = Math.max(0, themeList.findIndex((t) => t.name === options.theme || t === (themes as never)[options.theme]));

  const app = await createApp({
    theme: themeList[state.themeIndex] ?? themes.dark,
    fps: options.fps,
    title: "hqtui demo",
    quitKeys: ["ctrl+c"],
  });

  // Metrics refresh on their own clock; rendering runs at the frame rate.
  // One refresh at a time. Collecting can outrun the interval — the tick-15 path
  // alone allows journalctl five seconds — and every concurrent call mutates the
  // same sample, the same previous-counter state, and the same tick counter that
  // drives the staggered cadences, while spawning its own ps, ss, df and
  // journalctl.
  let refreshing = false;
  let lastRefreshAt = Date.now();
  const poll = setInterval(() => {
    if (state.paused || refreshing) return;
    // Every rate is a counter delta divided by this, so it has to be the time
    // that actually passed. A fixed interval overstated every rate by the skip
    // factor whenever a refresh outran its tick — and `sh()` alone allows four
    // seconds per command.
    const now = Date.now();
    const elapsed = Math.max(0.001, (now - lastRefreshAt) / 1000);
    lastRefreshAt = now;
    refreshing = true;
    void collector
      .refresh(elapsed)
      .then(() => {
        state.sample = collector.current();
        state.sensorNote = collector.sensorNote ?? state.sensorNote;
        app.invalidate();
      })
      .finally(() => {
        refreshing = false;
      });
  }, options.interval);
  poll.unref?.();

  // The simulation is cheap enough to advance every frame, which is what makes
  // the demo look alive rather than stepping once a second.
  const animate = setInterval(() => {
    if (state.paused || options.real) return;
    void collector.refresh(0.1);
    state.sample = collector.current();
    app.invalidate();
  }, 100);
  animate.unref?.();

  app.on("frame", (stats) => {
    state.fps = stats.fps;
    state.renderMs = stats.renderMs;
    state.changedCells = stats.changedCells;
    state.bytes = stats.bytes;
  });

  app.on("mouse", (event) => {
    state.lastMouse = `${event.action} ${event.button} @ ${event.x},${event.y}${event.scroll ? ` scroll ${event.scroll}` : ""}`;
    // Each scrollable registers its own region, so the wheel is handled by
    // whatever sits under the pointer rather than by one list per screen.
  });

  app.on("key", (event: KeyEvent) => {
    state.lastKey = event.key;
    state.keyLog.push(`${clock()}  ${event.key}${event.char ? `  "${event.char}"` : ""}`);
    if (state.keyLog.length > 100) state.keyLog.shift();

    // Overlays capture input first.
    if (state.showPalette) {
      const matches = PALETTE_COMMANDS.filter((c) => c.label.toLowerCase().includes(state.paletteQuery.toLowerCase()));
      if (event.name === "escape") state.showPalette = false;
      else if (event.name === "enter") {
        matches[state.paletteIndex]?.run(state);
        state.showPalette = false;
      } else if (event.name === "up") state.paletteIndex = Math.max(0, state.paletteIndex - 1);
      else if (event.name === "down") state.paletteIndex = Math.min(matches.length - 1, state.paletteIndex + 1);
      else if (event.name === "backspace") state.paletteQuery = state.paletteQuery.slice(0, -1);
      else if (event.char) state.paletteQuery += event.char;
      return;
    }
    if (state.showModal) {
      if (event.name === "escape" || event.name === "enter" || event.name === "n" || event.name === "y") {
        state.showModal = false;
      }
      return;
    }
    if (state.showHelp) {
      state.showHelp = false;
      return;
    }
    if (state.filtering) {
      if (event.name === "escape") { state.filtering = false; state.filter = ""; }
      else if (event.name === "enter") state.filtering = false;
      else if (event.name === "backspace") state.filter = state.filter.slice(0, -1);
      else if (event.char) state.filter += event.char;
      return;
    }

    switch (event.key) {
      case "q": app.quit(); return;
      case "f1": state.showHelp = true; return;
      case "f2":
        state.themeIndex = (state.themeIndex + 1) % themeList.length;
        app.setTheme(themeList[state.themeIndex]);
        return;
      case "f3": state.filtering = true; return;
      case "f6": {
        const order = ["cpu", "mem", "pid", "name"] as const;
        state.sort = order[(order.indexOf(state.sort) + 1) % order.length];
        return;
      }
      case "f10": app.quit(); return;
      case "ctrl+k":
        state.showPalette = true;
        state.paletteQuery = "";
        state.paletteIndex = 0;
        return;
      case "space": state.paused = !state.paused; return;
      case "up": moveSelection(state, -1); break;
      case "down": moveSelection(state, 1); break;
      case "pageup": moveSelection(state, -10); break;
      case "pagedown": moveSelection(state, 10); break;
      case "home": moveSelection(state, -Number.MAX_SAFE_INTEGER); break;
      case "end": moveSelection(state, Number.MAX_SAFE_INTEGER); break;
      case "enter": state.showModal = true; return;
      case "left":
        if (state.screen === "themes") {
          state.themeIndex = (state.themeIndex - 1 + themeList.length) % themeList.length;
          app.setTheme(themeList[state.themeIndex]);
        }
        return;
      case "right":
        if (state.screen === "themes") {
          state.themeIndex = (state.themeIndex + 1) % themeList.length;
          app.setTheme(themeList[state.themeIndex]);
        }
        return;
      case "tab": state.screen = SCREENS[(SCREENS.indexOf(state.screen) + 1) % SCREENS.length]; return;
    }

    const digit = Number(event.name);
    if (Number.isInteger(digit) && event.name.length === 1) {
      const index = digit === 0 ? 9 : digit - 1;
      if (index < SCREENS.length) state.screen = SCREENS[index];
    }


  });

  app.render(({ ui, theme, height }) => {
    ui.row({ size: 1 }, (header) => {
      header.text(" hqtui.com", { fg: theme.title, bold: true, size: 12 });
      header.tabs({
        tabs: SCREENS.map((s, i) => `${(i + 1) % 10} ${s}`),
        active: SCREENS.indexOf(state.screen),
        onSelect: (index) => { state.screen = SCREENS[index]; },
      });
      header.text(
        `${state.paused ? "paused" : "live"}  ${state.source}  ${num(state.fps, 0)}fps  ${clock()} `,
        { fg: state.paused ? theme.warning : theme.success, align: "right" },
      );
    });
    ui.spacer(1);

    ui.column({ size: height - 4 }, (body) => {
      switch (state.screen) {
        case "traffic": trafficScreen(body, state, theme); break;
        case "sessions": sessionsScreen(body, state, theme); break;
        case "network": networkScreen(body, state, theme); break;
        case "services": servicesScreen(body, state, theme); break;
        case "components": componentsScreen(body, state, theme); break;
        case "graphics": graphicsScreen(body, state, theme); break;
        case "themes": themesScreen(body, state, theme); break;
        case "input": inputScreen(body, state, theme); break;
        case "stress": stressScreen(body, state, theme); break;
        default: dashboardScreen(body, state, theme); break;
      }
    });

    ui.spacer(1);
    ui.statusBar({
      items: [
        { key: "F1", label: "Help" },
        { key: "F2", label: `Theme (${theme.name})` },
        { key: "F3", label: state.filtering ? `Filter: ${state.filter}_` : "Filter", active: state.filtering },
        { key: "F6", label: `Sort: ${state.sort}` },
        { key: "^K", label: "Palette" },
        { key: "Tab", label: "Screen" },
        { key: "q", label: "Quit" },
      ],
      right: [{ label: `${num(state.renderMs, 2)}ms  ${state.changedCells} cells  ${state.bytes}B` }],
    });

    if (state.showHelp) {
      ui.modal({
        title: "HQTUI Demo — Help",
        width: 62,
        height: 18,
        message:
          "1-6 or Tab switch screens.\n" +
          "F2 cycles themes, F3 filters processes, F6 changes sort.\n" +
          "Ctrl+K opens the command palette, Space pauses updates.\n" +
          "Arrows, PageUp/PageDown, Home/End move the selection.\n" +
          "Mouse: click tabs and buttons, scroll the process list.\n\n" +
          (state.unavailable.length
            ? `Unavailable here: ${state.unavailable.join(", ")}.\n` +
              (state.sample.telemetry.privileged
                ? "Running as root: all privileged sources are readable."
                : "Running unprivileged. sudo additionally unlocks socket process\n" +
                  "names, failed logins (btmp), HTTP access logs, per-process I/O\n" +
                  "and the full journal. It does not add temperatures.\n" +
                  "  sudo -E env \"PATH=$PATH\" bunx @profullstack/hqtui-demo")
            : "All metrics available on this platform.") +
          "\n\nPress any key to close.",
        buttons: [{ label: "Close", focused: true }],
      });
    }
    if (state.showModal) {
      ui.modal({
        title: "Confirm Action",
        message: `Are you sure you want to terminate process ${visibleProcesses(state)[focusedPane(state)?.selected ?? 0]?.pid ?? "—"} (${visibleProcesses(state)[focusedPane(state)?.selected ?? 0]?.name ?? "—"})?`,
        buttons: [
          { label: "Yes", variant: "success", focused: true },
          { label: "No", variant: "ghost" },
        ],
      });
    }
    if (state.showPalette) {
      const matches = PALETTE_COMMANDS.filter((c) => c.label.toLowerCase().includes(state.paletteQuery.toLowerCase()));
      ui.commandPalette({
        query: state.paletteQuery,
        items: matches.map((c) => ({ label: c.label, hint: c.hint })),
        selected: state.paletteIndex,
      });
    }
  });

  app.on("exit", () => {
    clearInterval(poll);
    clearInterval(animate);
  });

  await app.start();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
