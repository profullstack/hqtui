import Image from "next/image";
import { SiteFooter, SiteNav } from "@/components/site/nav";
import { Terminal } from "@/components/site/terminal";
import { Badge } from "@/components/ui/badge";

import { recordView } from "@/lib/db";


export const dynamic = "force-dynamic";

export const metadata = { title: "Showcase" };

const GALLERY = [
  {
    title: "Reference dashboard",
    body: "CPU with per-core meters, memory and swap, disks with throughput history, a live network graph, the process table, temperatures, sensors and a tailing log — all on one screen.",
    image: "/hqtui-dashboard.png",
    width: 1672,
    height: 941,
  },
  {
    title: "Component showcase",
    body: "Panels, gauges, tables, trees, dialogs, log viewers, sparklines, theme previews and keyboard command bars, in the density a real monitoring tool needs.",
    image: "/hqtui-components.png",
    width: 1536,
    height: 1024,
  },
];

export default async function Showcase() {
  await recordView("/showcase");
  const themed = ["tokyo-night", "gruvbox", "matrix", "dracula"];
  const SCREENS = [
    { shot: "traffic", title: "Traffic", body: "Every protocol in and out of the host: socket breakdown, TCP counters with retransmit rate, live HTTP request tracking from access logs, and sshd auth events." },
    { shot: "network", title: "Network", body: "Per-interface throughput graphs with totals and error counts, open connections with owning processes, and every listening port." },
    { shot: "sessions", title: "Sessions", body: "Who is logged in right now, login history from wtmp, failed attempts from btmp, and process state breakdown." },
    { shot: "services", title: "Services", body: "systemd units with failures first, containers, kernel counters, and filesystems with inode usage." },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="max-w-3xl">
          <Badge variant="secondary" className="mb-4 font-mono text-xs">
            live frames, not screenshots
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight">Showcase</h1>
          <p className="mt-4 text-lg text-white/60">
            Every terminal below was rendered by HQTUI itself when this page was built. The
            two images are the original design targets from the product requirements — the
            live frames are what the library actually produces.
          </p>
        </div>

        <section className="mt-12 space-y-3">
          <h2 className="text-xl font-semibold">Dashboard</h2>
          <p className="text-sm text-white/50">
            Grid layout, Braille area graphs, segmented meters, a zebra-striped table and a
            function-key status bar.
          </p>
          <Terminal shot="dashboard" title="hqtui-demo — dashboard" alt="HQTUI dashboard" priority />
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold">Real-time telemetry</h2>
          <p className="mt-1 text-sm text-white/50">
            The reference dashboard goes well past CPU and memory. Every screen below is
            reading a real machine.
          </p>
          <div className="mt-5 space-y-8">
            {SCREENS.map((screen) => (
              <figure key={screen.shot}>
                <Terminal shot={screen.shot} title={screen.title.toLowerCase()} alt={`HQTUI ${screen.title} screen`} />
                <figcaption className="mt-3">
                  <span className="font-semibold">{screen.title}</span>
                  <span className="mt-1 block text-sm text-white/50">{screen.body}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="mt-14 space-y-3">
          <h2 className="text-xl font-semibold">Widgets</h2>
          <p className="text-sm text-white/50">
            Meters, gauges, donuts, controls, a process tree, multi-series graphs, heat bars
            and a log viewer.
          </p>
          <Terminal shot="components" title="components" alt="The HQTUI widget catalogue" />
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold">Themes</h2>
          <p className="mt-1 text-sm text-white/50">
            The same panel, four palettes. Colour quantizes automatically when the terminal
            cannot do truecolor.
          </p>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {themed.map((name) => (
              <Terminal
                key={name}
                shot={`dashboard-${name}`}
                title={name}
                alt={`HQTUI rendered with the ${name} theme`}
              />
            ))}
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold">Design targets</h2>
          <p className="mt-1 text-sm text-white/50">
            The quality bar the library was written against.
          </p>
          <div className="mt-5 space-y-10">
            {GALLERY.map((item) => (
              <figure key={item.title}>
                <Image
                  src={item.image}
                  alt={item.title}
                  width={item.width}
                  height={item.height}
                  className="rounded-xl border border-white/10"
                />
                <figcaption className="mt-3">
                  <span className="font-semibold">{item.title}</span>
                  <span className="mt-1 block text-sm text-white/50">{item.body}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="text-xl font-semibold">Run it yourself</h2>
          <p className="mt-2 text-sm text-white/55">
            The reference dashboard reads real metrics on Linux, macOS and Windows, or runs a
            deterministic simulation.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-white/10 bg-[#0a0e14] p-4 font-mono text-sm text-[#c6d0db]">
            <span className="text-[#5fff87]">$</span> bunx @profullstack/hqtui-demo{"\n"}
            <span className="text-[#5fff87]">$</span> bunx @profullstack/hqtui-demo --sim
          </pre>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
