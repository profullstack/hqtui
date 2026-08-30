import Image from "next/image";
import { cn } from "@/lib/utils";

export interface TerminalShotProps {
  /** Basename in /public/shots, without the extension. */
  shot: string;
  title?: string;
  className?: string;
  /** Hide the title bar for inline snippets. */
  bare?: boolean;
  priority?: boolean;
  alt: string;
}

/**
 * Terminal frames are rendered by HQTUI itself and captured at 2x by
 * `bun run shots`. Browsers do not lay text out on a grid — box-drawing rules
 * drift apart and the frame stops looking like a terminal — so the site serves
 * the real thing as a high-DPI image instead.
 */
export function Terminal({ shot, title, className, bare, priority, alt }: TerminalShotProps) {
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
      <Image
        src={`/shots/${shot}.png`}
        alt={alt}
        width={1600}
        height={900}
        priority={priority}
        sizes="(max-width: 1280px) 100vw, 1280px"
        className="h-auto w-full"
        unoptimized
      />
    </div>
  );
}
