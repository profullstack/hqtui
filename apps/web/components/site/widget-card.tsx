"use client";

import { useState } from "react";
import { Code } from "@/components/site/code";
import { cn } from "@/lib/utils";

export interface WidgetExample {
  code: string;
  syntax: string;
}

export interface WidgetEntry {
  id: string;
  title: string;
  category: string;
  blurb: string;
  /** Pre-rendered HTML of the widget's real output. */
  preview: string;
  examples: Record<string, WidgetExample>;
}

export interface LanguageEntry {
  id: string;
  label: string;
  file: string;
}

/**
 * One widget: what it looks like, and the code that drew it in whichever
 * language you pick. The picture is not a screenshot — it is the widget
 * rendered headlessly at build time by the same library, so it cannot drift
 * from what the code does.
 */
export function WidgetCard({
  widget,
  languages,
  preferred,
}: {
  widget: WidgetEntry;
  languages: LanguageEntry[];
  /** The language to open on, when this widget has it. */
  preferred: string;
}) {
  const available = languages.filter((language) => widget.examples[language.id]);
  const [selected, setSelected] = useState(
    () => (widget.examples[preferred] ? preferred : available[0]?.id) ?? "",
  );
  const active = widget.examples[selected] ?? widget.examples[available[0]?.id ?? ""];
  const missing = languages.length - available.length;

  return (
    <section id={widget.id} className="scroll-mt-24 border-t border-white/10 py-10">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-xl font-bold tracking-tight">{widget.title}</h3>
        <code className="font-mono text-[12px] text-white/40">{widget.id}</code>
        <span className="ml-auto text-[11px] uppercase tracking-wider text-white/30">
          {widget.category}
        </span>
      </div>
      <p className="mt-2 max-w-2xl leading-relaxed text-white/60">{widget.blurb}</p>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div
          className="overflow-x-auto rounded-xl border border-white/10"
          // Rendered by examples/widgets/build-catalog.ts from the TypeScript
          // gallery. It is our own output, not user input.
          dangerouslySetInnerHTML={{ __html: widget.preview }}
        />

        <div>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label={`${widget.title} examples`}>
            {available.map((language) => (
              <button
                key={language.id}
                type="button"
                role="tab"
                aria-selected={language.id === selected}
                onClick={() => setSelected(language.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px] transition-colors",
                  language.id === selected
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white/80",
                )}
              >
                {language.label}
              </button>
            ))}
          </div>
          {active ? <Code className="mt-2" code={active.code} /> : null}
          {missing > 0 ? (
            <p className="mt-2 text-[12px] text-white/35">
              Not in {missing} of the {languages.length} ports yet. C++, Ruby, PHP and Perl reach
              the library through a narrower native core.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
