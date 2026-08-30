import Link from "next/link";
import { Code } from "@/components/site/code";
import { SiteFooter, SiteNav } from "@/components/site/nav";
import { Terminal } from "@/components/site/terminal";

import { recordView } from "@/lib/db";
import { Separator } from "@/components/ui/separator";

export const dynamic = "force-dynamic";

export const metadata = { title: "Docs" };

const SECTIONS = [
  { id: "install", label: "Install" },
  { id: "first-app", label: "Your first app" },
  { id: "layout", label: "Layout" },
  { id: "widgets", label: "Widgets" },
  { id: "graphics", label: "Graphics" },
  { id: "themes", label: "Themes" },
  { id: "input", label: "Input" },
  { id: "testing", label: "Testing" },
  { id: "escape-hatches", label: "Escape hatches" },
  { id: "performance", label: "Performance" },
  { id: "compatibility", label: "Compatibility" },
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 pt-10 text-2xl font-bold tracking-tight">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 leading-relaxed text-white/60">{children}</p>;
}

export default async function Docs() {
  await recordView("/docs");
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <div className="mx-auto flex max-w-7xl gap-10 px-4 py-12 sm:px-6">
        <aside className="sticky top-20 hidden h-fit w-52 shrink-0 lg:block">
          <p className="mb-3 font-mono text-xs uppercase tracking-wide text-white/35">On this page</p>
          <nav className="space-y-1.5 text-sm">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="block text-white/50 transition-colors hover:text-white"
              >
                {section.label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <h1 className="text-4xl font-bold tracking-tight">Documentation</h1>
          <P>
            HQTUI is a rendering library for building terminal applications in TypeScript. It
            owns the terminal directly — ANSI sequences, a typed-array framebuffer, differential
            rendering, Braille graphics and truecolor — with no ncurses, no browser DOM, no
            React, and no native addon.
          </P>

          <H2 id="install">Install</H2>
          <Code className="mt-4" code={`bun add @profullstack/hqtui   # Bun is the default runtime
npm  add @profullstack/hqtui   # Node 22.6+ works unchanged`} />
          <P>
            There is also a CLI: <code className="font-mono text-white/80">hqtui doctor</code>{" "}
            reports what your terminal actually supports, and{" "}
            <code className="font-mono text-white/80">hqtui</code> opens a built-in showcase.
          </P>

          <H2 id="first-app">Your first app</H2>
          <P>
            Everything has a default. <code className="font-mono text-white/80">createApp()</code>{" "}
            sets up the dark theme, truecolor with automatic 256/16-colour fallback, mouse
            tracking, the alternate screen, resize handling and adaptive frame pacing — and it
            restores your terminal on Ctrl+C, SIGTERM, or an uncaught exception.
          </P>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Code
              filename="hello.ts"
              code={`import { createApp } from "@profullstack/hqtui";

const app = await createApp();

app.render(({ ui }) => {
  ui.panel({ title: "Hello" }, (panel) => {
    panel.text("Hello, terminal.");
    panel.label("Press q to quit.");
  });
});

await app.start();`}
            />
            <Terminal shot="hello" bare alt="A hello world panel rendered by HQTUI" />
          </div>
          <P>
            The render callback runs on every frame. Keep it pure: read your state, describe the
            screen, and let the renderer work out what actually changed. Call{" "}
            <code className="font-mono text-white/80">app.invalidate()</code> when your data
            changes and the scheduler coalesces repeated calls into one frame.
          </P>

          <H2 id="layout">Layout</H2>
          <P>
            Containers collect their children first and solve the layout once, which is why{" "}
            <code className="font-mono text-white/80">&quot;1fr&quot;</code> works without a
            retained tree. Sizes may be a number of cells, a percentage, a fraction,{" "}
            <code className="font-mono text-white/80">auto</code>, or{" "}
            <code className="font-mono text-white/80">fill</code>, each with optional{" "}
            <code className="font-mono text-white/80">min</code> and{" "}
            <code className="font-mono text-white/80">max</code>.
          </P>
          <Code
            className="mt-4"
            code={`ui.grid({ columns: ["2fr", "1fr"], rows: [14, "1fr"], gap: 1 }, (grid) => {
  grid.panel({ title: "CPU" });
  grid.panel({ title: "Memory" });
  grid.panel({ title: "Processes", colSpan: 2 });
});

ui.row({ gap: 1 }, (row) => {
  row.panel({ width: 30 });          // fixed
  row.panel({ width: "40%" });       // percentage
  row.panel({ width: "2fr", min: 20 }); // fraction with a floor
});`}
          />
          <P>
            Responsive layouts pick a branch by the width actually available, so the same view
            works in a 60-column pane and a 240-column window.
          </P>
          <Code
            className="mt-4"
            code={`ui.responsive({
  150: (wide) => wide.row({ gap: 1 }, (r) => { /* four columns */ }),
  100: (medium) => medium.row({ gap: 1 }, (r) => { /* three columns */ }),
  0: (compact) => compact.column({}, (c) => { /* stacked */ }),
});`}
          />

          <H2 id="widgets">Widgets</H2>
          <P>
            Every widget is a method on the container, sized by the same layout engine and
            themed by the same tokens. Panels, tables, trees, log viewers, key/value lists,
            meters, gauges, donuts, progress bars, sparklines, line and area graphs,
            histograms, heat bars, tabs, status bars, buttons, checkboxes, toggles, radios,
            selects, text inputs, modals, command palettes, tooltips, badges and dividers.
          </P>
          <Terminal className="mt-5" shot="components" title="widgets" alt="The HQTUI widget catalogue" />
          <Code
            className="mt-4"
            code={`p.table({
  rows: processes,
  selected: 3,
  offset,
  scrollbar: true,
  zebra: true,
  columns: [
    { key: "pid", title: "PID", width: 7, align: "right" },
    { key: "name", title: "Name", color: theme.primary },
    { key: "cpu", title: "CPU%", width: 6, align: "right",
      color: (row) => heatColor(theme, row.cpu / 100) },
  ],
});`}
          />

          <H2 id="graphics">Graphics</H2>
          <P>
            Unicode Braille gives every cell a 2×4 pixel matrix, so a 40×10 panel plots at
            80×40 resolution. When the terminal cannot render Braille, the same call degrades
            to block elements and then to ASCII.
          </P>
          <Code
            className="mt-4"
            code={`p.graph({ values: cpu, min: 0, max: 100, fill: true });        // braille
p.graph({ values: cpu, mode: "block", colors: theme.heat });   // block elements
p.graph({ values: cpu, mode: "ascii" });                       // last resort

p.multiGraph([
  { values: read,  color: theme.success, label: "read" },
  { values: write, color: theme.secondary, label: "write" },
], { legend: true, axis: true });`}
          />
          <P>
            Graphs scale to the window that is actually drawn, not the whole history buffer, so
            an old spike never flattens the live line.
          </P>

          <H2 id="themes">Themes</H2>
          <P>
            Nine themes ship in the box and the dark one is the default. A theme is a flat set
            of tokens; override any of them with{" "}
            <code className="font-mono text-white/80">defineTheme()</code>.
          </P>
          <Code
            className="mt-4"
            code={`import { createApp, themes, defineTheme, hex } from "@profullstack/hqtui";

const brand = defineTheme({
  name: "brand",
  primary: hex("#7c5cff"),
  success: hex("#22d3a5"),
  graph: [hex("#7c5cff"), hex("#22d3a5"), hex("#ffb020")],
});

const app = await createApp({ theme: brand });
app.setTheme(themes.nord); // switch at runtime`}
          />

          <H2 id="input">Input</H2>
          <P>
            Keys arrive normalized — <code className="font-mono text-white/80">&quot;ctrl+c&quot;</code>,{" "}
            <code className="font-mono text-white/80">&quot;up&quot;</code>,{" "}
            <code className="font-mono text-white/80">&quot;f5&quot;</code>,{" "}
            <code className="font-mono text-white/80">&quot;shift+tab&quot;</code> — never as escape
            sequences. Mouse press, release, drag, move and scroll are decoded from SGR
            reporting, bracketed paste arrives as one event, and Tab traversal works without
            wiring anything up.
          </P>
          <Code
            className="mt-4"
            code={`app.on("key", (event) => {
  if (event.key === "ctrl+k") openPalette();
  if (event.name === "down") selected++;
});

app.on("mouse", (event) => {
  if (event.action === "scroll") offset += event.scroll;
});

// Controls that take an action join the Tab order automatically.
p.button({ label: "Restart", onPress: () => restart() });`}
          />

          <H2 id="testing">Testing</H2>
          <P>
            The headless renderer draws into an in-memory framebuffer with no TTY, no PTY and no
            escape sequences, then gives you the text, the ANSI, the HTML, or the raw cell grid
            with per-cell colours and attributes.
          </P>
          <Code
            className="mt-4"
            filename="dashboard.test.ts"
            code={`import { renderToScreen, renderToText } from "@profullstack/hqtui";

const screen = renderToScreen(({ ui }) => dashboard(ui, state), {
  width: 120,
  height: 40,
});

expect(screen.contains("CPU")).toBe(true);
expect(screen.find("bun")).toEqual({ x: 10, y: 4 });
expect(screen.cell(0, 4).bg).toBe(theme.selection);
expect(renderToText(view, { width: 40, height: 10 })).toMatchSnapshot();`}
          />
          <P>
            Every frame on this website is produced by{" "}
            <code className="font-mono text-white/80">renderToHtml()</code> at build time — the
            same renderer, the same output, just emitted as HTML instead of ANSI.
          </P>

          <H2 id="escape-hatches">Escape hatches</H2>
          <P>
            Nothing is off limits. Draw straight onto the surface you were given, or take a
            Braille canvas and blit it yourself.
          </P>
          <Code
            className="mt-4"
            code={`p.draw((surface) => {
  surface.text(0, 0, "raw access", { fg: theme.accent });
  surface.fillRect(0, 1, surface.width, 1, { bg: theme.selection });
});

p.canvas((canvas) => {
  canvas.circle(canvas.width / 2, canvas.height / 2, 12);
  canvas.line(0, 0, canvas.width, canvas.height);
});`}
          />

          <H2 id="performance">Performance</H2>
          <P>
            The screen is four typed arrays; nothing allocates per cell in a hot path. Frames are
            diffed and only changed runs are written, merged across short clean gaps because
            rewriting five cells costs less than the escape sequence to skip them. A terminal
            pen-state cache means no redundant SGR is ever emitted.
          </P>
          <Code
            className="mt-4"
            code={`# 160x50 (8,000 cells), bun 1.4, linux x64
renderer.frame.unchanged     0.068ms      no output
renderer.frame.1pct          0.140ms      627 bytes/frame
renderer.frame.10pct         0.291ms      2,639 bytes/frame
renderer.frame.100pct        1.409ms      8,341 bytes/frame
widgets.dashboard            0.425ms      6 panels`}
          />

          <H2 id="compatibility">Compatibility</H2>
          <P>
            Tier 1: Linux TTY, SSH, tmux, Kitty, WezTerm, Ghostty, Alacritty, GNOME Terminal,
            Konsole, macOS Terminal, iTerm2 and Windows Terminal. Capability detection covers
            truecolor, Unicode, Braille, mouse, synchronized output, bracketed paste and focus
            events, and every one can be overridden by option or environment variable.
          </P>
          <P>
            <code className="font-mono text-white/80">NO_COLOR</code> is honoured, colours
            quantize automatically to 256 or 16, Braille falls back to blocks and then ASCII,
            and frame rate drops to 15 fps over SSH.
          </P>

          <Separator className="my-10 bg-white/10" />
          <p className="text-sm text-white/45">
            Full API reference in the{" "}
            <a className="text-white/80 underline" href="https://github.com/profullstack/hqtui">
              repository
            </a>
            , and the original product requirements are in{" "}
            <a
              className="text-white/80 underline"
              href="https://github.com/profullstack/hqtui/blob/main/docs/PRD.md"
            >
              docs/PRD.md
            </a>
            . Questions and bugs:{" "}
            <a className="text-white/80 underline" href="https://github.com/profullstack/hqtui/issues">
              open an issue
            </a>
            .
          </p>
          <p className="mt-6">
            <Link href="/" className="text-sm text-white/50 underline hover:text-white">
              ← Back home
            </Link>
          </p>
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
