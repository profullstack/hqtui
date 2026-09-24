import { ArrowRight } from "lucide-react";

import { Code } from "@/components/site/code";
import { CommandBlock } from "@/components/site/command";

/**
 * The OpenIcon and OpenEmoji packs on the home page: samples of both sets,
 * what icon() and emoji() print in each terminal mode, and the way back to
 * the open specs they implement. Assets are a small copy in /public/open;
 * the full sets live in their own repositories.
 */

/** key, Nerd Font glyph, Unicode, ASCII: straight from openicon.json. */
const ICONS: Array<[string, string, string, string]> = [
  ["mail", "\u{f01f0}", "✉", "@"],
  ["phone", "\u{f0df0}", "☎", "tel"],
  ["link", "\u{f0339}", "🔗", "~"],
  ["search", "\u{f0349}", "🔍", "?"],
  ["settings", "\u{f0493}", "⚙", "*"],
  ["terminal", "\u{f018d}", "⌨", ">_"],
  ["git-branch", "\u{f418}", "⎇", "Y"],
  ["bell", "\u{f009c}", "🔔", "(!)"],
  ["calendar", "\u{f0b66}", "📅", "[=]"],
  ["lock", "\u{f0341}", "🔒", "[#]"],
  ["github", "\u{f02a4}", "🐙", "gh"],
  ["discord", "\u{f066f}", "🎮", "dc"],
];

const HQ_FILE: Record<string, string> = { github: "github.svg", discord: "discord.svg" };

const EMOJI: Array<[string, string, string]> = [
  ["1f600", "😀", "grinning face"],
  ["1f602", "😂", "face with tears of joy"],
  ["1f60d", "😍", "smiling face with heart-eyes"],
  ["1f914", "🤔", "thinking face"],
  ["1f525", "🔥", "fire"],
  ["2764-fe0f", "❤️", "red heart"],
  ["1f44d", "👍", "thumbs up"],
  ["1f680", "🚀", "rocket"],
  ["1f4a1", "💡", "light bulb"],
  ["1f389", "🎉", "party popper"],
  ["1f4af", "💯", "hundred points"],
  ["1f440", "👀", "eyes"],
  ["2705", "✅", "check mark button"],
  ["26a0-fe0f", "⚠️", "warning"],
  ["1f431", "🐱", "cat face"],
  ["1f1ef-1f1f5", "🇯🇵", "flag: Japan"],
];

const USAGE = `import { icon, emoji, emojify } from "@profullstack/hqtui";

icon("mail");      // the Nerd Font glyph, "✉" in Unicode, "@" in ASCII
icon("github");    // brands too: Nerd glyph, "🐙", "gh"

emoji("rocket");   // "🚀", or "[rocket]" where emoji cannot render
emoji("+1");       // aliases and shortcodes: "👍"
emojify("ship it :oe_rocket: :fire:");`;

const LINKS: Array<[string, string, string]> = [
  ["OpenIcon spec", "https://logicsrc.com/openicon", "An icon set as a folder, with three terminal glyphs per icon"],
  ["OpenEmoji spec", "https://logicsrc.com/openemoji", "An emoji set as a folder that says what drew it"],
  ["All 370 icons", "https://logicsrc.com/openicon#gallery", "Search, filter, Simple and HQ, Nerd/Unicode/ASCII views"],
  ["All 3,963 emoji", "https://logicsrc.com/openemoji/catalog", "Search, skin tones, and install packs for 22 networks"],
];

function mask(key: string) {
  const url = `url("/open/icon/simple/${key}.svg")`;
  return {
    WebkitMaskImage: url,
    maskImage: url,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  } as const;
}

export function OpenSets() {
  return (
    <section id="icons-emoji" className="scroll-mt-14 border-y border-white/10 bg-white/[0.015]">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Icons and emoji, built in</h2>
          <p className="mx-auto mt-3 max-w-2xl text-white/55">
            370 icons and 3,963 emoji ship with HQTUI and are on by default. Each draws the best
            thing your terminal can show: a Nerd Font glyph, a Unicode symbol, or plain ASCII,
            so a status bar never turns into boxes over SSH.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* OpenIcon */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h3 className="text-lg font-semibold">
                OpenIcon <span className="text-sm font-normal text-white/45">370 icons</span>
              </h3>
              <a href="https://logicsrc.com/openicon" className="text-sm text-[#5fff87] underline underline-offset-4">
                the spec
              </a>
            </div>

            <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/60 p-4 font-mono text-sm">
              <table className="w-full min-w-[26rem] border-collapse">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-white/40">
                    <th className="pb-2 font-normal">icon()</th>
                    <th className="pb-2 font-normal">Nerd Font</th>
                    <th className="pb-2 font-normal">Unicode</th>
                    <th className="pb-2 font-normal">ASCII</th>
                  </tr>
                </thead>
                <tbody>
                  {ICONS.slice(0, 8).map(([key, nerd, uni, ascii]) => (
                    <tr key={key} className="border-t border-white/5">
                      <td className="py-1.5 text-white/70">&quot;{key}&quot;</td>
                      <td className="py-1.5 font-nerd text-lg text-[#5fff87]">{nerd}</td>
                      <td className="py-1.5 text-lg text-white/85">{uni}</td>
                      <td className="py-1.5 text-white/85">{ascii}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mb-2 mt-5 text-xs uppercase tracking-wide text-white/40">Simple</p>
            <div className="grid grid-cols-6 gap-2">
              {ICONS.map(([key]) => (
                <div
                  key={key}
                  title={key}
                  className="flex aspect-square items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]"
                >
                  <span role="img" aria-label={key} className="h-7 w-7 bg-[#5fff87]" style={mask(key)} />
                </div>
              ))}
            </div>

            <p className="mb-2 mt-4 text-xs uppercase tracking-wide text-white/40">HQ</p>
            <div className="grid grid-cols-6 gap-2">
              {ICONS.map(([key]) => (
                <div
                  key={key}
                  title={key}
                  className="flex aspect-square items-center justify-center rounded-lg bg-white/90"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/open/icon/hq/${HQ_FILE[key] ?? `${key}.webp`}`}
                    alt={key}
                    width={36}
                    height={36}
                    loading="lazy"
                    className="h-9 w-9 object-contain"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* OpenEmoji */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h3 className="text-lg font-semibold">
                OpenEmoji <span className="text-sm font-normal text-white/45">3,963 emoji</span>
              </h3>
              <a href="https://logicsrc.com/openemoji" className="text-sm text-[#5fff87] underline underline-offset-4">
                the spec
              </a>
            </div>

            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {EMOJI.map(([key, char, name]) => (
                <div
                  key={key}
                  title={name}
                  className="flex aspect-square items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/open/emoji/${key}.webp`} alt={char} width={44} height={44} loading="lazy" className="h-11 w-11" />
                </div>
              ))}
            </div>

            <div className="mt-5 overflow-x-auto rounded-lg border border-white/10 bg-black/60 p-4 font-mono text-sm">
              <table className="w-full min-w-[22rem] border-collapse">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-white/40">
                    <th className="pb-2 font-normal">emoji()</th>
                    <th className="pb-2 font-normal">emoji mode</th>
                    <th className="pb-2 font-normal">text mode</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["fire", "🔥", "[fire]"],
                    ["smile", "😄", ":D"],
                    ["heart", "❤️", "<3"],
                    ["+1", "👍", "+1"],
                  ].map(([name, glyph, text]) => (
                    <tr key={name} className="border-t border-white/5">
                      <td className="py-1.5 text-white/70">&quot;{name}&quot;</td>
                      <td className="py-1.5 text-lg">{glyph}</td>
                      <td className="py-1.5 text-white/85">{text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-5 text-sm text-white/60">
              Put the OpenEmoji artwork in the terminal itself: install the colour font and point
              fontconfig, Kitty or WezTerm at it. Kitty, Ghostty, iTerm2 and WezTerm can also draw
              the high-resolution PNGs inline.
            </p>
            <div className="mt-3">
              <CommandBlock command="bunx @profullstack/hqtui fonts install" label="fonts" />
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Code code={USAGE} filename="icons-and-emoji.ts" />
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <h3 className="mb-3 font-semibold">Two open specs, one import</h3>
            <p className="mb-4 text-sm text-white/60">
              Both sets follow open specifications on LogicSRC, so a set someone else draws works
              with the same calls. The same functions exist in the Go, Python and Rust ports.
            </p>
            <ul className="space-y-3">
              {LINKS.map(([label, href, line]) => (
                <li key={href}>
                  <a href={href} className="group inline-flex items-center gap-1.5 text-sm font-medium text-[#5fff87]">
                    {label}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </a>
                  <p className="text-xs text-white/45">{line}</p>
                </li>
              ))}
              <li className="pt-1 text-xs text-white/45">
                API docs:{" "}
                <a href="/docs#icons" className="text-white/70 underline underline-offset-4">
                  icons
                </a>{" "}
                and{" "}
                <a href="/docs#emoji" className="text-white/70 underline underline-offset-4">
                  emoji
                </a>
                . Sets:{" "}
                <a href="https://github.com/profullstack/openicon" className="text-white/70 underline underline-offset-4">
                  openicon
                </a>
                ,{" "}
                <a href="https://github.com/profullstack/openemoji" className="text-white/70 underline underline-offset-4">
                  openemoji
                </a>
                .
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
