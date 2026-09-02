"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import shots from "@/public/shots/shots.json";

export interface ThemeCard {
  name: string;
  label: string;
  shot: string;
  votes: number;
}

/**
 * Each card is a real HQTUI frame captured at 2x. Voting writes to SQLite; a
 * failed vote leaves the count alone rather than pretending it landed.
 */
export function ThemeGallery({ themes }: { themes: ThemeCard[] }) {
  const [active, setActive] = useState(themes[0]?.name ?? "dark");
  const [votes, setVotes] = useState<Record<string, number>>(
    Object.fromEntries(themes.map((t) => [t.name, t.votes])),
  );
  const [voted, setVoted] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const current = themes.find((t) => t.name === active) ?? themes[0];
  // A 2x capture has to be drawn at exactly half, or the box rules blur.
  const size = (shots as Record<string, { width: number; height: number; scale?: number }>)[
    current?.shot ?? ""
  ] ?? { width: 2560, height: 1440, scale: 2 };
  const displayWidth = Math.round(size.width / (size.scale ?? 2));

  async function vote(name: string) {
    if (pending || voted === name) return;
    setPending(true);
    try {
      const response = await fetch("/api/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: name }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as { votes: number };
      setVotes((previous) => ({ ...previous, [name]: data.votes }));
      setVoted(name);
    } catch {
      // Offline or the database is unreachable.
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <div
        role="tablist"
        aria-label="Theme"
        className="flex flex-row gap-2 overflow-x-auto lg:flex-col lg:overflow-visible"
      >
        {themes.map((theme) => (
          <button
            key={theme.name}
            type="button"
            role="tab"
            // Which theme is selected was conveyed by border and background
            // colour alone, so it was invisible to a screen reader and to
            // anyone in a high-contrast or forced-colours mode.
            aria-selected={theme.name === active}
            aria-controls="theme-preview"
            onClick={() => setActive(theme.name)}
            className={cn(
              "flex shrink-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              theme.name === active
                ? "border-[#5fff87]/40 bg-[#5fff87]/10 text-white"
                : "border-white/10 text-white/60 hover:border-white/25 hover:text-white",
            )}
          >
            <span className="font-mono">{theme.label}</span>
            <span className="font-mono text-xs text-white/50">
              <span className="sr-only">votes: </span>
              {votes[theme.name] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div id="theme-preview" role="tabpanel" aria-live="polite" className="space-y-3">
        <div className="terminal-frame">
          <div className="terminal-frame__bar">
            <span className="terminal-frame__dot bg-[#ff5f57]" />
            <span className="terminal-frame__dot bg-[#febc2e]" />
            <span className="terminal-frame__dot bg-[#28c840]" />
            <span className="ml-2 font-mono text-[11px] text-white/50">theme: {current?.label}</span>
          </div>
          <Image
            key={current?.name}
            src={`/shots/${current?.shot}.png`}
            alt={`HQTUI rendered with the ${current?.label} theme`}
            width={size.width}
            height={size.height}
            sizes={`${displayWidth}px`}
            className="h-auto w-full"
            style={{ maxWidth: `${displayWidth}px` }}
            unoptimized
          />
        </div>

        <button
          onClick={() => vote(active)}
          disabled={pending || voted === active}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
            voted === active
              ? "border-[#5fff87]/40 bg-[#5fff87]/10 text-[#5fff87]"
              : "border-white/15 text-white/70 hover:border-white/30 hover:text-white",
          )}
        >
          {voted === active ? <Check className="h-4 w-4" /> : <ThumbsUp className="h-4 w-4" />}
          {voted === active ? "Voted" : `Vote for ${current?.label}`}
          <span className="font-mono text-xs text-white/50">{votes[active] ?? 0}</span>
        </button>
      </div>
    </div>
  );
}
