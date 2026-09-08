import { AppFrame } from "@/components/site/app-frame";
import { CommandBlock } from "@/components/site/command";
import { SiteFooter, SiteNav } from "@/components/site/nav";
import { Badge } from "@/components/ui/badge";

import { recordView } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Apps",
  description: "Programs built with HQTUI: a REST client, a git interface, and an audio player.",
};

interface App {
  shot: string;
  name: string;
  tagline: string;
  repo: string;
  install: string;
  body: string;
  /** What this one proved about the library, which is why it exists. */
  found: string;
}

const APPS: App[] = [
  {
    shot: "r3q",
    name: "r3q",
    tagline: "A REST client for your terminal",
    repo: "https://github.com/profullstack/r3q",
    install: "bunx r3q ~/api",
    body:
      "Requests are .http files you commit, so they diff and review with the code they belong to. "
      + "{{VARS}} resolve from a gitignored .env, so the file holds the template and the secret stays "
      + "on your machine. The response pane shows the whole exchange: status, timing, size, headers "
      + "and a highlighted body.",
    found:
      "The JSON highlighting needed more than one colour on a line, which the library could not do. "
      + "That became styled spans in 0.3.0.",
  },
  {
    shot: "g1tz",
    name: "g1tz",
    tagline: "A git TUI that shows you the repository",
    repo: "https://github.com/profullstack/g1tz",
    install: "bunx g1tz",
    body:
      "Files, branches and log down the left; the diff for whatever is selected on the right. "
      + "Changed lines emphasise the words that actually differ, rather than turning the whole line "
      + "green. Reads git through porcelain formats with -z, because parsing output meant for humans "
      + "is how a TUI corrupts a working tree.",
    found:
      "Word-level diff highlighting is the same span work as r3q, from the opposite direction: "
      + "emphasis inside a line that already has a colour.",
  },
  {
    shot: "nixamp",
    name: "nixamp",
    tagline: "It really whips the terminal's ass",
    repo: "https://github.com/profullstack/nixamp",
    install: "bunx nixamp ~/Music",
    body:
      "One decode feeds both the speakers and the display: ffmpeg writes raw samples to a pipe, "
      + "nixamp reads every one on its way past, runs an FFT over it, and hands the same bytes to the "
      + "output. Bands are logarithmic and scaled in decibels, because hearing is. Bars rise instantly "
      + "and fall gradually, with a peak marker that sinks.",
    found:
      "The analyser is drawn on the braille canvas — four vertical pixels per character cell, which "
      + "is why the bars move smoothly instead of stepping through eight block glyphs.",
  },
];

export default async function Apps() {
  await recordView("/apps");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <main className="mx-auto max-w-[1640px] px-4 py-14 sm:px-6">
        <div className="max-w-3xl">
          <Badge variant="secondary" className="mb-4 font-mono text-xs">
            programs, not demos
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight">Apps built with HQTUI</h1>
          <p className="mt-4 text-lg text-white/60">
            Three programs people actually run. They exist partly to keep the library honest: a
            real application finds the gaps a widget gallery does not, and each of these has
            already changed HQTUI.
          </p>
          <p className="mt-3 text-sm text-white/40">
            Every screenshot is rendered by HQTUI itself and captured at 2x — the same pipeline as
            the demo shots, so what you see is the frame the terminal draws.
          </p>
        </div>

        <div className="mt-12 space-y-16">
          {APPS.map((app, index) => (
            <section key={app.shot}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-mono text-2xl font-semibold">{app.name}</h2>
                <span className="text-white/50">{app.tagline}</span>
                <a
                  href={app.repo}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-sm text-white/50 transition-colors hover:text-white"
                >
                  source ↗
                </a>
              </div>

              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/60">{app.body}</p>

              <div className="mt-5">
                <AppFrame
                  shot={app.shot}
                  title={app.name}
                  alt={`${app.name} — ${app.tagline}`}
                  priority={index === 0}
                />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <CommandBlock command={app.install} />
                <p className="text-sm leading-relaxed text-white/45">
                  <span className="text-white/70">What it found: </span>
                  {app.found}
                </p>
              </div>
            </section>
          ))}
        </div>

        <section className="mt-20 max-w-3xl border-t border-white/10 pt-10">
          <h2 className="text-xl font-semibold">Built something?</h2>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            Open a pull request adding a <code className="font-mono text-white/80">scripts/showcase.ts</code>{" "}
            to your repository that exports the frames you want captured, and a section here. The
            capture script takes application directories as arguments, so nothing about your layout
            has to be committed to this one.
          </p>
          <div className="mt-5">
            <CommandBlock command="bun apps/web/scripts/app-shots.ts ~/src/your-app" />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
