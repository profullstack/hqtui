/**
 * Capture every demo screen as a high-DPI PNG.
 *
 *   bun run shots            deterministic simulation (default)
 *   bun run shots -- --real  this machine's live metrics
 *
 * Frames come from HQTUI's own renderer via renderToHtml, then headless Chrome
 * screenshots them at 2x. Browsers cannot lay text out on a terminal grid, so
 * the images are what ship — to the READMEs, npm and hqtui.com.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readdirSync, copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToHtml, themes, type Theme } from "@profullstack/hqtui";
import { createCollector } from "../src/system/index.ts";
import { createState, type DemoState, pane } from "../src/state.ts";
import * as screens from "../src/screens/index.ts";

const REPO = join(import.meta.dir, "..", "..", "..");
const OUT = join(REPO, "assets", "screens");
const SITE = join(REPO, "apps", "web", "public", "shots");
const TMP = join(import.meta.dir, "..", ".shots-tmp");
const SCALE = 2;
const SENTINEL = "#ff00ff";
/** DejaVu Sans Mono has complete box-drawing and Braille coverage. */
const FONT = "'DejaVu Sans Mono','Liberation Mono','Noto Sans Mono',monospace";

const CHROME_DEPS = join(process.env.HOME ?? "", ".local/share/chrome-deps/usr/lib/x86_64-linux-gnu");
const CHROME_ENV = {
  ...process.env,
  LD_LIBRARY_PATH: [CHROME_DEPS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
};

function findChrome(): string {
  const candidates: string[] = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  const root = join(process.env.HOME ?? "", ".cache/puppeteer/chrome");
  if (existsSync(root)) {
    for (const version of readdirSync(root).sort().reverse()) {
      candidates.push(join(root, version, "chrome-linux64", "chrome"));
    }
  }
  candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (spawnSync(candidate, ["--version"], { env: CHROME_ENV, timeout: 20000 }).status === 0) {
      return candidate;
    }
  }
  throw new Error("No working Chrome found. Set CHROME_PATH.");
}

type Draw = (state: DemoState, theme: Theme) => (args: { ui: never; theme: Theme }) => void;

interface Shot {
  name: string;
  screen: keyof typeof RENDERERS;
  width: number;
  height: number;
  theme?: Theme;
}

const RENDERERS = {
  dashboard: screens.dashboardScreen,
  traffic: screens.trafficScreen,
  sessions: screens.sessionsScreen,
  network: screens.networkScreen,
  services: screens.servicesScreen,
  components: screens.componentsScreen,
  graphics: screens.graphicsScreen,
  themes: screens.themesScreen,
  input: screens.inputScreen,
} as const;

const SHOTS: Shot[] = [
  { name: "dashboard", screen: "dashboard", width: 168, height: 46 },
  { name: "traffic", screen: "traffic", width: 158, height: 40 },
  { name: "sessions", screen: "sessions", width: 150, height: 30 },
  { name: "network", screen: "network", width: 158, height: 34 },
  { name: "services", screen: "services", width: 158, height: 34 },
  { name: "components", screen: "components", width: 150, height: 34 },
  { name: "graphics", screen: "graphics", width: 150, height: 32 },
  { name: "themes", screen: "themes", width: 150, height: 30 },
  { name: "dashboard-dracula", screen: "dashboard", width: 168, height: 46, theme: themes.dracula },
  { name: "dashboard-nord", screen: "dashboard", width: 168, height: 46, theme: themes.nord },
  { name: "dashboard-tokyo-night", screen: "dashboard", width: 168, height: 46, theme: themes.tokyoNight },
  { name: "dashboard-gruvbox", screen: "dashboard", width: 168, height: 46, theme: themes.gruvbox },
  { name: "dashboard-matrix", screen: "dashboard", width: 168, height: 46, theme: themes.matrix },
];

const real = process.argv.includes("--real");
const collector = await createCollector({ real, seed: 20260830 });
// Several passes so rates and histories are populated rather than flat.
for (let i = 0; i < (real ? 4 : 30); i++) {
  await collector.refresh(real ? 1 : 0.1);
  if (real) await new Promise((resolve) => setTimeout(resolve, 700));
}

const state = createState(collector.current(), collector.source, collector.unavailable);
// Highlight a row in the process table so the screenshots show selection.
// This was `state.selected = 1`, a property DemoState has never had, so every
// published screenshot has in fact been taken with nothing selected.
pane(state, "dashboard.processes", 1).selected = 1;

const chrome = findChrome();
console.log(`chrome: ${chrome}`);
console.log(`source: ${collector.source}\n`);
mkdirSync(OUT, { recursive: true });
mkdirSync(SITE, { recursive: true });
mkdirSync(TMP, { recursive: true });

/** The quick-start example, rendered exactly as the snippet produces it. */
const HELLO = ({ ui }: { ui: { panel: (o: unknown, b: (p: never) => void) => void } }) => {
  ui.panel({ title: "Hello" }, ((panel: { text: (t: string) => void; label: (t: string) => void }) => {
    panel.text("Hello, terminal.");
    panel.label("Press q to quit.");
  }) as never);
};

{
  const html = renderToHtml(HELLO as never, {
    width: 54, height: 8, theme: themes.dark, fontSize: 16, padding: 20, fontFamily: FONT,
  });
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:${SENTINEL}} .wrap{display:inline-block} pre{margin:0!important}
  </style></head><body><div class="wrap">${html}</div></body></html>`;
  writeFileSync(join(TMP, "hello.html"), page);
  spawnSync(chrome, [
    "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    `--force-device-scale-factor=${SCALE}`, "--window-size=760,300",
    `--screenshot=${join(TMP, "hello.raw.png")}`, "--virtual-time-budget=3000",
    `file://${join(TMP, "hello.html")}`,
  ], { encoding: "utf8", timeout: 60000, env: CHROME_ENV });
  console.log("· hello (54x8 cells, dark)");
}

/**
 * Font size so the 2x capture lands near 2560px wide.
 *
 * The site shows these in a 1280px column. A capture wider than 2560 gets
 * resampled to some fraction that is not a half, and 1px box-drawing rules do
 * not survive that — they turn to mush. Sized this way the browser draws the
 * image at exactly 50%, which is what a 2x asset is for.
 *
 * The advance is measured from the captures rather than taken from the font
 * metrics: 0.602em is what DejaVu declares, and 0.64 is what actually comes
 * out of the renderer once the frame's own padding is in the picture.
 */
const ADVANCE = 0.64;

function fontSizeFor(columns: number, targetWidth = 2540, padding = 20): number {
  const usable = targetWidth - padding * 2 * SCALE;
  const size = usable / (columns * ADVANCE * SCALE);
  return Math.max(11, Math.min(16, Math.floor(size)));
}

for (const shot of SHOTS) {
  const theme = shot.theme ?? themes.dark;
  const draw = RENDERERS[shot.screen];
  const fontSize = fontSizeFor(shot.width);

  const html = renderToHtml(
    // The demo screens take (container, state, theme); the renderer supplies the first.
    (({ ui }: { ui: never }) => draw(ui as never, state, theme)) as never,
    { width: shot.width, height: shot.height, theme, fontSize, padding: 20, fontFamily: FONT },
  );

  const page = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:${SENTINEL}}
    .wrap{display:inline-block}
    pre{margin:0!important}
  </style></head><body><div class="wrap">${html}</div></body></html>`;

  const file = join(TMP, `${shot.name}.html`);
  writeFileSync(file, page);

  const windowWidth = Math.ceil(shot.width * fontSize * 0.62) + 140;
  const windowHeight = Math.ceil(shot.height * fontSize * 1.2) + 140;

  spawnSync(chrome, [
    "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${windowWidth},${windowHeight}`,
    `--screenshot=${join(TMP, `${shot.name}.raw.png`)}`,
    "--virtual-time-budget=4000",
    `file://${file}`,
  ], { encoding: "utf8", timeout: 60000, env: CHROME_ENV });

  console.log(`· ${shot.name} (${shot.width}x${shot.height} cells, ${theme.name})`);
}

const crop = spawnSync("python3", [join(import.meta.dir, "crop.py"), TMP, OUT, SENTINEL], { encoding: "utf8" });
console.log(crop.stdout?.trim());
if (crop.status !== 0) {
  console.error(crop.stderr);
  process.exit(1);
}

// The website serves the same images, plus the dimensions of each one: the
// pages have to know the real size to render a 2x asset at exactly half.
const sizes: Record<string, { width: number; height: number }> = {};
for (const file of readdirSync(OUT)) {
  if (!file.endsWith(".png")) continue;
  copyFileSync(join(OUT, file), join(SITE, file));
  const header = readFileSync(join(OUT, file)).subarray(16, 24);
  sizes[file.replace(/\.png$/, "")] = {
    width: header.readUInt32BE(0),
    height: header.readUInt32BE(4),
  };
}
writeFileSync(join(SITE, "shots.json"), `${JSON.stringify(sizes, null, 2)}\n`);
console.log(`copied ${Object.keys(sizes).length} screenshots to the website`);
