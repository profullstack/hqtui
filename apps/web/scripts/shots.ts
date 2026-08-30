/**
 * Render HQTUI frames to high-DPI PNGs.
 *
 * Browsers do not lay text out on a grid: glyph advances round independently,
 * so box-drawing rules drift apart and horizontal rules drop out. Screenshotting
 * the real renderer at 2x instead gives the exact terminal look, and the images
 * are still produced by HQTUI itself rather than drawn by hand.
 *
 *   bun run shots
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToHtml, themes, type Theme } from "@profullstack/hqtui";
import { heroView, helloView, themeView, widgetsView } from "../lib/terminal";

const OUT = join(import.meta.dir, "..", "public", "shots");
const TMP = join(import.meta.dir, "..", ".shots-tmp");
const SCALE = 2;

/** DejaVu Sans Mono has complete box-drawing and Braille coverage. */
const FONT = "'DejaVu Sans Mono','Liberation Mono','Noto Sans Mono',monospace";

interface Shot {
  name: string;
  view: Parameters<typeof renderToHtml>[0];
  width: number;
  height: number;
  theme?: Theme;
  fontSize?: number;
}

const SHOTS: Shot[] = [
  { name: "hero", view: heroView, width: 150, height: 34, fontSize: 15 },
  { name: "widgets", view: widgetsView, width: 140, height: 30, fontSize: 15 },
  { name: "hello", view: helloView, width: 54, height: 8, fontSize: 16 },
  { name: "theme-dark", view: themeView("dark"), width: 74, height: 16, theme: themes.dark, fontSize: 15 },
  { name: "theme-dracula", view: themeView("dracula"), width: 74, height: 16, theme: themes.dracula, fontSize: 15 },
  { name: "theme-nord", view: themeView("nord"), width: 74, height: 16, theme: themes.nord, fontSize: 15 },
  { name: "theme-tokyo-night", view: themeView("tokyo-night"), width: 74, height: 16, theme: themes.tokyoNight, fontSize: 15 },
  { name: "theme-gruvbox", view: themeView("gruvbox"), width: 74, height: 16, theme: themes.gruvbox, fontSize: 15 },
  { name: "theme-matrix", view: themeView("matrix"), width: 74, height: 16, theme: themes.matrix, fontSize: 15 },
];

/** Extra shared libraries staged for headless Chrome on minimal hosts. */
const CHROME_DEPS = join(process.env.HOME ?? "", ".local/share/chrome-deps/usr/lib/x86_64-linux-gnu");
const CHROME_ENV = {
  ...process.env,
  LD_LIBRARY_PATH: [CHROME_DEPS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
};

function runs(candidate: string): boolean {
  const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", env: CHROME_ENV, timeout: 20000 });
  return probe.status === 0;
}

/** Newest build first, but only one that actually starts on this machine. */
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
    if (existsSync(candidate) && runs(candidate)) return candidate;
  }
  throw new Error("No working Chrome found. Set CHROME_PATH to one that starts.");
}

const chrome = findChrome();
console.log(`using ${chrome}`);
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

// A sentinel page background the cropper can distinguish from any terminal.
const SENTINEL = "#ff00ff";

for (const shot of SHOTS) {
  const theme = shot.theme ?? themes.dark;
  const fontSize = shot.fontSize ?? 15;
  const inner = renderToHtml(shot.view, {
    width: shot.width,
    height: shot.height,
    theme,
    fontSize,
    padding: 20,
    fontFamily: FONT,
  });

  const page = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:${SENTINEL}}
    .wrap{display:inline-block;padding:0}
    pre{margin:0!important}
    .hqtui-row{min-height:1em}
  </style></head><body><div class="wrap">${inner}</div></body></html>`;

  const file = join(TMP, `${shot.name}.html`);
  writeFileSync(file, page);

  // Oversize the window; the exact frame is cropped from the sentinel afterwards.
  const windowWidth = Math.ceil(shot.width * fontSize * 0.62) + 120;
  const windowHeight = Math.ceil(shot.height * fontSize) + 120;

  const result = spawnSync(chrome, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${windowWidth},${windowHeight}`,
    `--screenshot=${join(TMP, `${shot.name}.raw.png`)}`,
    "--virtual-time-budget=4000",
    `file://${file}`,
  ], { encoding: "utf8", timeout: 60000, env: CHROME_ENV });

  if (result.status !== 0 && !existsSync(join(TMP, `${shot.name}.raw.png`))) {
    console.error(`✗ ${shot.name}: chrome failed`, result.stderr?.slice(0, 300));
    continue;
  }
  console.log(`· rendered ${shot.name} (${shot.width}x${shot.height} cells @${SCALE}x)`);
}

// Crop every raw shot down to the terminal frame.
const crop = spawnSync("python3", [join(import.meta.dir, "crop.py"), TMP, OUT, SENTINEL], {
  encoding: "utf8",
});
console.log(crop.stdout?.trim());
if (crop.status !== 0) {
  console.error(crop.stderr);
  process.exit(1);
}
