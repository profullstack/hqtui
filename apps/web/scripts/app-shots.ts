/**
 * Capture screenshots of applications built with hqtui, for the /apps page.
 *
 *   bun apps/web/scripts/app-shots.ts ~/src/r3q ~/src/g1tz ~/src/nixamp
 *
 * Each application declares its own frames in `scripts/showcase.ts`, because
 * only it knows what a good state looks like:
 *
 *   export const frames = [{ name, width, height, draw(args) }];
 *
 * The paths are arguments rather than a committed list: these applications live
 * in their own repositories, and hard-coding somebody's checkout layout into
 * this one would make the script run on exactly one machine.
 *
 * Frames come from hqtui's own renderer via renderToHtml, then headless Chrome
 * screenshots them at 2x — the same pipeline as apps/demo/scripts/shots.ts,
 * for the same reason: browsers cannot lay text out on a terminal grid.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { renderToHtml, themes, type Theme } from "@profullstack/hqtui";

const REPO = join(import.meta.dir, "..", "..", "..");
const OUT = join(REPO, "apps", "web", "public", "apps");
const TMP = join(REPO, "apps", "web", ".app-shots-tmp");
const CROP = join(REPO, "apps", "demo", "scripts", "crop.py");
const SCALE = 2;
const SENTINEL = "#ff00ff";
// ShotBraille first so its unicode-range wins for braille; everything else
// falls straight through to ShotMono.
const FONT = "'ShotBraille','ShotMono','DejaVu Sans Mono','Liberation Mono',monospace";

/**
 * Fonts are embedded rather than named, and braille comes from a second face.
 *
 * Two problems, both of which put stray marks in a capture rather than failing:
 *
 * 1. Chrome resolves a family name through fontconfig, which is not installed
 *    on every machine that has the font files. Without it `font-family: 'DejaVu
 *    Sans Mono'` silently falls back. An `@font-face` with the bytes inline
 *    cannot.
 *
 * 2. DejaVu Sans **Mono** has box-drawing but no braille at all — verified
 *    against its cmap, not assumed. Chrome therefore falls back for braille
 *    alone, and the substitute is 21% wider than the cell. The grid still
 *    measures the right number of columns, so nothing errors; the row simply
 *    renders too wide, and its trailing border lands past where it belongs. In
 *    a spectrum analyser, where every row holds a different number of braille
 *    glyphs, that draws a staircase of stray strokes across the next panel.
 *
 * The proportional DejaVu Sans does have braille, so it is mapped over
 * U+2800-28FF only, with `size-adjust` set to the measured advance ratio so a
 * braille cell occupies exactly one column.
 */
const MONO_CANDIDATES = [
  process.env.SHOT_FONT,
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
  "/Library/Fonts/DejaVuSansMono.ttf",
].filter((path): path is string => typeof path === "string" && path !== "");

const BRAILLE_CANDIDATES = [
  process.env.SHOT_BRAILLE_FONT,
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
].filter((path): path is string => typeof path === "string" && path !== "");

/** Measured: 10 mono cells are 120px where 10 DejaVu Sans braille are 146px. */
const BRAILLE_SIZE_ADJUST = "82.19%";

function embed(family: string, path: string, extra = ""): string {
  const data = readFileSync(path).toString("base64");
  return `@font-face{font-family:'${family}';`
    + `src:url(data:font/ttf;base64,${data}) format('truetype');`
    + `font-display:block;${extra}}`;
}

function fontFaces(): string {
  const mono = MONO_CANDIDATES.find((path) => existsSync(path));
  if (!mono) {
    throw new Error(
      `No monospace font found for embedding. Set SHOT_FONT to a .ttf with `
      + `box-drawing coverage. Tried:\n  ${MONO_CANDIDATES.join("\n  ")}`,
    );
  }
  console.log(`· mono ${mono}`);
  let faces = embed("ShotMono", mono);

  const braille = BRAILLE_CANDIDATES.find((path) => existsSync(path));
  if (braille) {
    console.log(`· braille ${braille} (size-adjust ${BRAILLE_SIZE_ADJUST})`);
    faces += embed("ShotBraille", braille,
      `unicode-range:U+2800-28FF;size-adjust:${BRAILLE_SIZE_ADJUST};`);
  } else {
    console.warn("! no braille font found; graphs and analysers will render wide");
  }
  return faces;
}

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

interface Frame {
  name: string;
  width: number;
  height: number;
  theme?: Theme;
  draw: (args: unknown) => void;
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: bun apps/web/scripts/app-shots.ts <app-dir> [app-dir...]");
  process.exit(2);
}

const frames: Frame[] = [];
for (const target of targets) {
  const dir = resolve(target);
  const entry = join(dir, "scripts", "showcase.ts");
  if (!existsSync(entry)) {
    console.error(`skipped ${basename(dir)}: no scripts/showcase.ts`);
    continue;
  }
  const module = (await import(pathToFileURL(entry).href)) as { frames?: Frame[] };
  if (!module.frames?.length) {
    console.error(`skipped ${basename(dir)}: scripts/showcase.ts exports no frames`);
    continue;
  }
  frames.push(...module.frames);
  console.log(`· loaded ${module.frames.length} frame(s) from ${basename(dir)}`);
}

if (frames.length === 0) {
  console.error("nothing to capture");
  process.exit(1);
}

const chrome = findChrome();
const FACE = fontFaces();
mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

/**
 * Font size so the 2x capture lands near 2540px wide. The site shows these in a
 * fixed column; a capture wider than that gets resampled to some fraction that
 * is not a half, and 1px box-drawing rules do not survive it.
 */
const ADVANCE = 0.64;
function fontSizeFor(columns: number, targetWidth = 2540, padding = 20): number {
  const usable = targetWidth - padding * 2 * SCALE;
  return Math.max(11, Math.min(16, Math.floor(usable / (columns * ADVANCE * SCALE))));
}

for (const frame of frames) {
  const theme = frame.theme ?? themes.dark;
  const fontSize = fontSizeFor(frame.width);
  const html = renderToHtml(frame.draw as never, {
    width: frame.width,
    height: frame.height,
    theme,
    fontSize,
    padding: 20,
    fontFamily: FONT,
  });

  const page = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${FACE}
    html,body{margin:0;padding:0;background:${SENTINEL}}
    .wrap{display:inline-block}
    pre{margin:0!important}
  </style></head><body><div class="wrap">${html}</div></body></html>`;

  const file = join(TMP, `${frame.name}.html`);
  writeFileSync(file, page);

  spawnSync(chrome, [
    "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${Math.ceil(frame.width * fontSize * 0.62) + 140},${Math.ceil(frame.height * fontSize * 1.2) + 140}`,
    `--screenshot=${join(TMP, `${frame.name}.raw.png`)}`,
    "--virtual-time-budget=4000",
    `file://${file}`,
  ], { encoding: "utf8", timeout: 60000, env: CHROME_ENV });

  console.log(`· ${frame.name} (${frame.width}x${frame.height} cells, ${theme.name})`);
}

const crop = spawnSync("python3", [CROP, TMP, OUT, SENTINEL], { encoding: "utf8" });
console.log(crop.stdout?.trim());
if (crop.status !== 0) {
  console.error(crop.stderr);
  process.exit(1);
}

// The page has to know each image's real size to render a 2x asset at half.
const sizes: Record<string, { width: number; height: number }> = {};
for (const file of readdirSync(OUT)) {
  if (!file.endsWith(".png")) continue;
  const header = readFileSync(join(OUT, file)).subarray(16, 24);
  sizes[file.replace(/\.png$/, "")] = {
    width: header.readUInt32BE(0),
    height: header.readUInt32BE(4),
  };
}
writeFileSync(join(OUT, "apps.json"), `${JSON.stringify(sizes, null, 2)}\n`);
rmSync(TMP, { recursive: true, force: true });
console.log(`captured ${Object.keys(sizes).length} application screenshots`);
