"use client";

import { useState } from "react";
import { Check, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ThemeCard {
  name: string;
  label: string;
  html: string;
  votes: number;
}

/**
 * Every card is a real HQTUI frame rendered server-side in that theme. Voting
 * writes to SQLite (Turso); a failed vote leaves the UI unchanged rather than
 * pretending it counted.
 */
export function ThemeGallery({ themes }: { themes: ThemeCard[] }) {
  const [active, setActive] = useState(themes[0]?.name ?? "dark");
  const [votes, setVotes] = useState<Record<string, number>>(
    Object.fromEntries(themes.map((t) => [t.name, t.votes])),
  );
  const [voted, setVoted] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const current = themes.find((t) => t.name === active) ?? themes[0];

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
      // Offline or the database is unreachable: leave the count alone.
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <div className="flex flex-row gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
        {themes.map((theme) => (
          <button
            key={theme.name}
            onClick={() => setActive(theme.name)}
            className={cn(
              "flex shrink-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              theme.name === active
                ? "border-[#5fff87]/40 bg-[#5fff87]/10 text-white"
                : "border-white/10 text-white/60 hover:border-white/25 hover:text-white",
            )}
          >
            <span className="font-mono">{theme.label}</span>
            <span className="font-mono text-xs text-white/30">{votes[theme.name] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div
          className="terminal-frame"
          key={current?.name}
        >
          <div className="terminal-frame__bar">
            <span className="terminal-frame__dot bg-[#ff5f57]" />
            <span className="terminal-frame__dot bg-[#febc2e]" />
            <span className="terminal-frame__dot bg-[#28c840]" />
            <span className="ml-2 font-mono text-[11px] text-white/40">
              theme: {current?.label}
            </span>
          </div>
          <div
            className="terminal-frame__scroll"
            dangerouslySetInnerHTML={{ __html: current?.html ?? "" }}
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
          <span className="font-mono text-xs text-white/40">{votes[active] ?? 0}</span>
        </button>
      </div>
    </div>
  );
}
