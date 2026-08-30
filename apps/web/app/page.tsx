import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Boxes, Cpu, Gauge, Keyboard, Palette, TerminalSquare, TestTube2, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Code, InstallCommand } from "@/components/site/code";
import { SiteFooter, SiteNav } from "@/components/site/nav";
import { Terminal } from "@/components/site/terminal";
import { ThemeGallery, type ThemeCard } from "@/components/site/theme-gallery";

import { recordView, themeVotes, totalViews } from "@/lib/db";
import { themes } from "@profullstack/hqtui";

export const dynamic = "force-dynamic";

const HELLO = `import { createApp } from "@profullstack/hqtui";

const app = await createApp();

app.render(({ ui }) => {
  ui.panel({ title: "Hello" }, (panel) => {
    panel.text("Hello, terminal.");
  });
});

await app.start();`;

const DASHBOARD = `app.render(({ ui }) => {
  ui.grid({ columns: ["2fr", "1fr"], rows: [14, "1fr"], gap: 1 }, (grid) => {
    grid.panel({ title: "CPU" }, (p) => {
      p.graph({ values: cpu, min: 0, max: 100, fill: true });
      p.meters(cores.map((value, i) => ({ label: "P" + i, value })), { columns: 2 });
    });

    grid.panel({ title: "Memory" }, (p) => {
      p.meter({ label: "Used", value: 0.42, text: "6.7 GiB" });
    });

    grid.panel({ title: "Processes", colSpan: 2 }, (p) => {
      p.table({ rows: processes, columns });
    });
  });
});`;

const TESTING = `import { renderToScreen } from "@profullstack/hqtui";

const screen = renderToScreen(
  ({ ui }) => ui.panel({ title: "CPU" }, (p) => p.text("72%")),
  { width: 40, height: 6 },
);

expect(screen.contains("72%")).toBe(true);
expect(screen.cell(2, 0).fg).toBe(theme.title);`;

const FEATURES = [
  {
    icon: Zap,
    title: "Differential rendering",
    body: "Four typed arrays hold the screen. Each frame is diffed against the last and only changed runs are written, with a model of the terminal's pen so no escape sequence is repeated.",
  },
  {
    icon: Cpu,
    title: "Zero dependencies",
    body: "The library imports nothing. No ncurses, no native addon, no browser DOM, no React. It makes no network requests and spawns no subprocesses, ever.",
  },
  {
    icon: TerminalSquare,
    title: "Braille graphics",
    body: "Every cell is a 2x4 pixel matrix, so a 40x10 panel plots at 80x40 resolution. Falls back to block elements, then ASCII, when the terminal cannot keep up.",
  },
  {
    icon: Boxes,
    title: "Layout that solves itself",
    body: 'Rows, columns and grids with spans. Sizes are 12, "40%", "2fr", auto, or min/max. No manual coordinate arithmetic in application code.',
  },
  {
    icon: Palette,
    title: "Dark by default",
    body: "Nine built-in themes and truecolor that quantizes automatically to 256 or 16 colours. NO_COLOR, monochrome and high-contrast modes are first class.",
  },
  {
    icon: Keyboard,
    title: "Real input handling",
    body: "Normalized keys with modifiers, SGR mouse with drag and scroll, bracketed paste, focus events, and Tab traversal that works without wiring anything up.",
  },
  {
    icon: TestTube2,
    title: "Actually testable",
    body: "A headless renderer returns text, ANSI, HTML or a cell grid. Assert on what the screen says without a TTY, a PTY, or a screenshot diff.",
  },
  {
    icon: Gauge,
    title: "Restores your terminal",
    body: "Ctrl+C, SIGTERM, an uncaught exception or a rejected promise: the alternate screen, cursor, raw mode and mouse tracking all go back the way they were.",
  },
];

const BENCHMARKS = [
  { name: "Idle frame (0% changed)", mean: "0.068 ms", note: "no output written" },
  { name: "1% of cells changed", mean: "0.140 ms", note: "627 bytes/frame" },
  { name: "10% of cells changed", mean: "0.291 ms", note: "2,639 bytes/frame" },
  { name: "50% of cells changed", mean: "0.904 ms", note: "8,253 bytes/frame" },
  { name: "Full 160x50 repaint", mean: "0.393 ms", note: "8,000 cells" },
  { name: "Six-panel dashboard build", mean: "0.425 ms", note: "layout + widgets + diff" },
];

export default async function Home() {
  await recordView("/");
  const [votes, views] = await Promise.all([themeVotes(), totalViews()]);
  const voteMap = new Map(votes.map((v) => [v.theme, v.votes]));

  // Only themes with a captured screenshot appear in the gallery.
  const SHOT_THEMES = ["dark", "dracula", "nord", "tokyo-night", "gruvbox", "matrix"];
  const themeCards: ThemeCard[] = SHOT_THEMES.map((name) => ({
    name,
    label: name.replace(/-/g, " "),
    shot: name === "dark" ? "dashboard" : `dashboard-${name}`,
    votes: voteMap.get(name) ?? 0,
  }));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />

      {/* Hero */}
      <section className="grid-glow relative overflow-hidden border-b border-white/10">
        <div className="dot-grid absolute inset-0 opacity-40" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="secondary" className="mb-5 font-mono text-xs">
              v0.1.8 · MIT · zero runtime dependencies
            </Badge>
            <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-6xl">
              High quality terminal UI
              <span className="block bg-gradient-to-r from-[#5fff87] via-[#56d4dd] to-[#58a6ff] bg-clip-text text-transparent">
                for TypeScript
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-white/60">
              btop-grade dashboards with a one-import API. Own the terminal directly, render
              only what changed, and make beautiful graphics a first-class primitive.
            </p>
            <div className="mx-auto mt-7 flex max-w-md flex-col gap-3">
              <InstallCommand command="bun add @profullstack/hqtui" />
              <div className="flex justify-center gap-3">
                <Button size="lg" render={<Link href="/docs" />}>
                  Get started <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  render={
                    <a href="https://github.com/profullstack/hqtui" target="_blank" rel="noreferrer" />
                  }
                >
                  Star on GitHub
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-12">
            <Terminal
              shot="dashboard"
              title="hqtui-demo — dashboard"
              alt="HQTUI dashboard: CPU, memory, network and processes"
              priority
            />
            <p className="mt-3 text-center font-mono text-xs text-white/30">
              Captured from HQTUI&apos;s own renderer at 2x — the real frame, not a mockup.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
            {[
              ["0.29 ms", "10% changed frame"],
              ["0", "runtime dependencies"],
              ["30+", "widgets"],
              ["9", "built-in themes"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-5">
                <div className="font-mono text-2xl font-bold text-[#5fff87]">{value}</div>
                <div className="mt-1 text-xs text-white/45">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quick start */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Ten lines to a real TUI</h2>
            <p className="mt-3 text-white/60">
              <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-sm">createApp()</code> already
              gives you a dark theme, truecolor with automatic fallback, mouse tracking, the
              alternate screen, resize handling, adaptive frame pacing, and a terminal that is
              restored no matter how your process dies.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-white/60">
              {[
                "No configuration required to look good",
                "30 fps adaptive, 15 fps over SSH, 0 fps when idle",
                "Degrades to 256/16 colours and ASCII automatically",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5fff87]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <Code code={HELLO} filename="hello.ts" />
            <Terminal shot="hello" bare alt="A hello world panel rendered by HQTUI" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-y border-white/10 bg-white/[0.015]">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">
            Everything a dashboard needs
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-white/55">
            The rendering pipeline is deliberately simple: application state, layout, widgets,
            framebuffer, diff, batched output. Nothing in between.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="border-white/10 bg-white/[0.02]">
                <CardHeader>
                  <feature.icon className="h-5 w-5 text-[#5fff87]" />
                  <CardTitle className="mt-2 text-base">{feature.title}</CardTitle>
                  <CardDescription className="text-white/50">{feature.body}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Widgets */}
      <section id="widgets" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Thirty widgets, one API</h2>
          <p className="mx-auto mt-3 max-w-2xl text-white/55">
            Panels, tables, trees, logs, meters, gauges, donuts, sparklines, graphs, tabs,
            modals, command palettes and every input control — all sized by the same layout
            engine, all themeable, all testable.
          </p>
        </div>
        <Tabs defaultValue="widgets">
          <TabsList className="mx-auto mb-6 flex w-fit">
            <TabsTrigger value="widgets">Widget catalogue</TabsTrigger>
            <TabsTrigger value="dashboard">Dashboard code</TabsTrigger>
            <TabsTrigger value="testing">Testing</TabsTrigger>
          </TabsList>
          <TabsContent value="widgets">
            <Terminal shot="components" title="components" alt="The HQTUI widget catalogue" />
          </TabsContent>
          <TabsContent value="dashboard">
            <div className="grid gap-4 lg:grid-cols-2">
              <Code code={DASHBOARD} filename="dashboard.ts" />
              <Image
                src="/hqtui-components.png"
                alt="HQTUI component showcase"
                width={1536}
                height={1024}
                className="rounded-xl border border-white/10"
              />
            </div>
          </TabsContent>
          <TabsContent value="testing">
            <div className="grid gap-4 lg:grid-cols-2">
              <Code code={TESTING} filename="dashboard.test.ts" />
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/60">
                <h3 className="mb-2 font-semibold text-white">Terminal apps are usually untestable</h3>
                <p>
                  HQTUI ships a headless renderer. It draws into an in-memory framebuffer with no
                  TTY, no PTY and no escape sequences, then hands you the text, the ANSI, the HTML,
                  or the raw cell grid with per-cell colours and attributes.
                </p>
                <p className="mt-3">
                  The 83 tests in this repository run in 65 ms under both{" "}
                  <code className="font-mono text-white/80">bun test</code> and{" "}
                  <code className="font-mono text-white/80">node --test</code>.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      {/* Themes */}
      <section id="themes" className="border-y border-white/10 bg-white/[0.015]">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold tracking-tight">Dark by default</h2>
            <p className="mx-auto mt-3 max-w-2xl text-white/55">
              Nine themes ship in the box, and every one of these previews is a live frame from
              the renderer. Vote for your favourite — the tally lives in SQLite.
            </p>
          </div>
          <ThemeGallery themes={themeCards} />
        </div>
      </section>

      {/* Performance */}
      <section id="performance" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Fast by construction</h2>
            <p className="mt-3 text-white/60">
              The screen is one grid of cells in four typed arrays. Nothing allocates per cell in
              a hot path. Frames are diffed and only the changed runs are written, merged across
              short clean gaps because rewriting five cells is cheaper than an escape sequence.
            </p>
            <p className="mt-3 text-white/60">
              Changing <code className="font-mono text-white/80">CPU 72%</code> to{" "}
              <code className="font-mono text-white/80">CPU 73%</code> writes a single character.
            </p>
            <Separator className="my-6 bg-white/10" />
            <p className="font-mono text-xs text-white/35">
              160x50 (8,000 cells) · bun 1.4 · linux x64 · reproduce with{" "}
              <span className="text-white/60">bun run bench</span>
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-left font-mono text-xs uppercase tracking-wide text-white/40">
                <tr>
                  <th className="px-4 py-3">Benchmark</th>
                  <th className="px-4 py-3 text-right">Mean</th>
                  <th className="px-4 py-3 text-right">Output</th>
                </tr>
              </thead>
              <tbody>
                {BENCHMARKS.map((row) => (
                  <tr key={row.name} className="border-t border-white/[0.06]">
                    <td className="px-4 py-3 text-white/75">{row.name}</td>
                    <td className="px-4 py-3 text-right font-mono text-[#5fff87]">{row.mean}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-white/40">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Demo CTA */}
      <section className="border-t border-white/10 bg-white/[0.015]">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">Run it on your machine</h2>
              <p className="mt-3 text-white/60">
                The reference dashboard reads real metrics on Linux, macOS and Windows with no
                native dependencies, or runs a deterministic simulation so screenshots and
                benchmarks are reproducible.
              </p>
              <div className="mt-6 space-y-3">
                <InstallCommand command="bunx @profullstack/hqtui-demo" />
                <InstallCommand command="bunx @profullstack/hqtui-demo --sim" />
              </div>
              <p className="mt-4 text-sm text-white/40">
                Six screens: dashboard, components, graphics, themes, input visualizer, stress test.
              </p>
            </div>
            <Image
              src="/hqtui-dashboard.png"
              alt="HQTUI reference dashboard"
              width={1672}
              height={941}
              className="rounded-xl border border-white/10"
              priority={false}
            />
          </div>
        </div>
      </section>

      <SiteFooter views={views} />
    </div>
  );
}
