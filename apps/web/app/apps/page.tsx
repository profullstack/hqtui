import { AppFrame } from "@/components/site/app-frame";
import { CommandBlock } from "@/components/site/command";
import { SiteFooter, SiteNav } from "@/components/site/nav";
import { Badge } from "@/components/ui/badge";

import { recordView } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Apps",
  description: "Programs built with HQTUI: a REST client, a git interface, an audio player, an nmap console and more.",
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
  {
    shot: "diskpush",
    name: "diskpush",
    tagline: "Two panes and an rsync between them",
    repo: "https://github.com/profullstack/diskpush",
    install: "bunx diskpush",
    body:
      "Local on one side, an SSH host on the other, and a transfer panel that shows the plan before "
      + "it runs and every path as it lands. rsync does the work; the interface exists so you can see "
      + "what it is about to do.",
    found:
      "The transfer panel updates several times a second against a full file listing, which is where "
      + "a renderer that diffs frames stops being an optimisation and starts being the reason it is usable.",
  },
  {
    shot: "threatcrush",
    name: "ThreatCrush",
    tagline: "A security daemon you can watch",
    repo: "https://github.com/profullstack/threatcrush",
    install: "threatcrush tui",
    body:
      "Modules, a live event feed, top threats and a severity breakdown, fed by a daemon over a unix "
      + "socket. When no daemon is running it says so and tells you how to start one, rather than "
      + "filling the screen with invented attacks.",
    found:
      "Rendering to a buffer made three header and truncation defects into ordinary failing tests. "
      + "They had been invisible because the old build wrote escape codes straight to stdout.",
  },
  {
    shot: "coinpay",
    name: "CoinPay",
    tagline: "A merchant's money, in one screen",
    repo: "https://github.com/profullstack/coinpayportal",
    install: "coinpay finances",
    body:
      "Earnings, bank position and pipeline across seven screens, with a live payment feed over "
      + "server-sent events. Bank syncs are a keypress, never automatic — the bridge allows about "
      + "24 pulls a day.",
    found:
      "Every figure here is a fixture. It is the one app on this page whose real screen cannot be "
      + "published, which is its own kind of design constraint.",
  },
  {
    shot: "myna",
    name: "myna",
    tagline: "Post once, everywhere",
    repo: "https://github.com/profullstack/mynaposter",
    install: "bunx myna",
    body:
      "Compose in the terminal and publish to every network you have connected, with per-network "
      + "character counts and thread splitting shown as you type. Credentials live in an encrypted "
      + "vault the interface never reads.",
    found:
      "The screen had to be lifted out of the app loop to be captured at all. That refactor is what "
      + "made its layout testable, which it had never been.",
  },
  {
    shot: "logicsrc",
    name: "logicsrc",
    tagline: "Team vaults, without the plaintext",
    repo: "https://github.com/profullstack/logicsrc",
    install: "logicsrc teams tui",
    body:
      "Which vaults exist, what their secrets are called, who can decrypt them and what changed. It "
      + "never fetches a decryption key and has no keybinding that would: a value that can appear on "
      + "screen can appear in a screen share.",
    found:
      "Being metadata-only is why this is the one screenshot here taken from something close to a "
      + "real shape without redaction.",
  },
  {
    shot: "tsbb",
    name: "tsbb",
    tagline: "A message board in your terminal",
    repo: "https://github.com/profullstack/tsbb",
    install: "bunx tsbb",
    body:
      "Forums, topics, threads, search and notifications against any tsbb board. Unread, solved and "
      + "locked are glyphs in the margin rather than colours alone, so the list still reads on a "
      + "terminal with no colour at all.",
    found:
      "Its views were pure functions of state from the start, which is why the whole client is "
      + "asserted on as text rather than described in a test.",
  },
  {
    shot: "nmaptui",
    name: "nmaptui",
    tagline: "An admin console for nmap",
    repo: "https://github.com/profullstack/nmaptui",
    install: "curl -fsSL https://raw.githubusercontent.com/profullstack/nmaptui/main/install.sh | sh",
    body:
      "Eighteen scan profiles and a form for every nmap option that matters, with the exact command "
      + "shown before it runs. nmap's XML is read as it streams, so tasks, percent and finished hosts "
      + "appear while the scan is still going. Hosts, services and a findings triage list follow, "
      + "every scan is kept, and any two can be diffed or exported as text, JSON, CSV, Markdown or HTML.",
    found:
      "Its screens are pure functions of one state object, so the test suite renders the real frames "
      + "headlessly and asserts on the text. A meter with a leading track bar and a panel subtitle "
      + "that ate its title both showed up that way, in a test, before anyone opened a terminal.",
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
            Ten programs people actually run. They exist partly to keep the library honest: a
            real application finds the gaps a widget gallery does not, and several of these have
            already changed HQTUI — styled spans, collapsed borders and the braille metrics in
            these very screenshots all came from building one of them.
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
