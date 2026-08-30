import { cn } from "@/lib/utils";

type Rule = { pattern: RegExp; className: string };

const RULES: Rule[] = [
  { pattern: /\/\/[^\n]*/g, className: "text-white/30" },
  { pattern: /"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g, className: "text-[#f1fa8c]" },
  {
    pattern: /\b(?:import|from|const|let|await|async|return|function|export|new|if|else|for|of|type|interface)\b/g,
    className: "text-[#ff79c6]",
  },
  {
    pattern: /\b(?:createApp|renderToScreen|renderToText|render|start|panel|graph|meter|table|grid|keyValues|invalidate|quit)\b/g,
    className: "text-[#8be9fd]",
  },
  { pattern: /\b\d+(?:\.\d+)?\b/g, className: "text-[#bd93f9]" },
];

interface Token {
  start: number;
  end: number;
  className: string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

/**
 * A deliberately tiny highlighter. Shipping a syntax library to colour six code
 * samples would cost more than everything else on the page combined.
 */
function highlight(code: string): string {
  const tokens: Token[] = [];
  for (const rule of RULES) {
    for (const match of code.matchAll(rule.pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // First rule to claim a span wins, so keywords inside strings stay quoted.
      if (tokens.some((t) => start < t.end && end > t.start)) continue;
      tokens.push({ start, end, className: rule.className });
    }
  }
  tokens.sort((a, b) => a.start - b.start);

  let html = "";
  let cursor = 0;
  for (const token of tokens) {
    html += escapeHtml(code.slice(cursor, token.start));
    html += `<span class="${token.className}">${escapeHtml(code.slice(token.start, token.end))}</span>`;
    cursor = token.end;
  }
  return html + escapeHtml(code.slice(cursor));
}

export function Code({
  code,
  className,
  filename,
}: {
  code: string;
  className?: string;
  filename?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-white/10 bg-[#0a0e14]", className)}>
      {filename ? (
        <div className="border-b border-white/10 px-4 py-2 font-mono text-[11px] text-white/40">
          {filename}
        </div>
      ) : null}
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-[#c6d0db]">
        <code dangerouslySetInnerHTML={{ __html: highlight(code) }} />
      </pre>
    </div>
  );
}

export function InstallCommand({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0a0e14] px-4 py-3 font-mono text-sm">
      <span className="select-none text-[#5fff87]">$</span>
      <span className="text-[#c6d0db]">{command}</span>
    </div>
  );
}
