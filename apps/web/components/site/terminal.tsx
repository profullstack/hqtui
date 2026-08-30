import { render, type TerminalOptions } from "@/lib/terminal";
import { renderToHtml } from "@profullstack/hqtui";
import { cn } from "@/lib/utils";

interface TerminalProps extends TerminalOptions {
  view: Parameters<typeof renderToHtml>[0];
  title?: string;
  className?: string;
  /** Hide the title bar for inline snippets. */
  bare?: boolean;
}

/**
 * A terminal frame whose contents are produced by HQTUI's own renderer at build
 * time and emitted as HTML. Nothing on this site is a screenshot of a terminal.
 */
export function Terminal({ view, title, className, bare, ...options }: TerminalProps) {
  const html = render(view, options);
  return (
    <div className={cn("terminal-frame", className)}>
      {bare ? null : (
        <div className="terminal-frame__bar">
          <span className="terminal-frame__dot bg-[#ff5f57]" />
          <span className="terminal-frame__dot bg-[#febc2e]" />
          <span className="terminal-frame__dot bg-[#28c840]" />
          <span className="ml-2 font-mono text-[11px] text-white/40">{title ?? "hqtui"}</span>
        </div>
      )}
      <div className="terminal-frame__scroll" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
