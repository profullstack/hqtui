import Link from "next/link";
import { SiteFooter, SiteNav } from "@/components/site/nav";
import { WidgetCard, type LanguageEntry, type WidgetEntry } from "@/components/site/widget-card";
import { recordView } from "@/lib/db";
import catalog from "@/content/widgets.json";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Widgets",
  description:
    "Every widget HQTUI draws, what it looks like, and the code that drew it in ten languages.",
};

const LANGUAGES = catalog.languages as LanguageEntry[];
const WIDGETS = catalog.widgets as WidgetEntry[];

const CATEGORIES = ["Text", "Data", "Meters", "Inputs", "Overlays"] as const;

function coverage(language: LanguageEntry): number {
  return WIDGETS.filter((widget) => widget.examples[language.id]).length;
}

export default async function Widgets() {
  await recordView("/widgets");
  const total = WIDGETS.reduce((n, w) => n + Object.keys(w.examples).length, 0);

  return (
    <div className="min-h-screen bg-[#05070a] text-white">
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Widgets</h1>
        <p className="mt-3 max-w-3xl leading-relaxed text-white/60">
          Every widget HQTUI draws, what it actually looks like, and the code that drew it. The
          pictures are not screenshots: each one is rendered headlessly at build time by the
          library itself, and each snippet is a region of a program that compiles and runs. If a
          widget stopped drawing, this page would go blank rather than lie.
        </p>

        <div className="mt-8 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <caption className="border-b border-white/10 px-4 py-3 text-left text-[13px] text-white/50">
              {WIDGETS.length} widgets across {LANGUAGES.length} languages, {total} worked
              examples. Seven languages implement the library and draw everything. Ruby, PHP and
              Perl describe a scene as data and hand it to the shared native core, so they cover
              what a JSON node can express; COBOL writes fixed-width records, so it covers what a
              flat record can. The counts below are measured from the galleries, not asserted
              here.
            </caption>
            <thead>
              <tr className="text-[12px] uppercase tracking-wider text-white/40">
                <th className="px-4 py-2 font-medium">Language</th>
                <th className="px-4 py-2 font-medium">Widgets</th>
                <th className="px-4 py-2 font-medium">Gallery</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {LANGUAGES.map((language) => {
                const covered = coverage(language);
                return (
                  <tr key={language.id} className="border-t border-white/5">
                    <td className="px-4 py-2">{language.label}</td>
                    <td className="px-4 py-2 text-white/70">
                      {covered} / {WIDGETS.length}
                    </td>
                    <td className="px-4 py-2 text-white/40">{language.file}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <nav className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-sm text-white/50">
          {WIDGETS.map((widget) => (
            <a key={widget.id} href={`#${widget.id}`} className="hover:text-white">
              {widget.title}
            </a>
          ))}
        </nav>

        {CATEGORIES.map((category) => (
          <div key={category}>
            <h2 className="scroll-mt-20 pt-12 text-2xl font-bold tracking-tight">{category}</h2>
            {WIDGETS.filter((widget) => widget.category === category).map((widget) => (
              <WidgetCard
                key={widget.id}
                widget={widget}
                languages={LANGUAGES}
                preferred="typescript"
              />
            ))}
          </div>
        ))}

        <p className="mt-12 text-sm text-white/50">
          Want the longer version?{" "}
          <Link href="/book" className="text-[#5fff87] underline underline-offset-4">
            The High Quality Terminal UI Cookbook
          </Link>{" "}
          walks through building a real dashboard with these.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
