import Image from "next/image";
import { cn } from "@/lib/utils";
import shots from "@/public/shots/shots.json";

type ShotName = keyof typeof shots;

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
 * `bun run shots` in apps/demo. Browsers do not lay text out on a grid, so a
 * live HTML frame stops looking like a terminal; the real thing is served as
 * an image instead.
 *
 * Displayed at exactly half its captured size. A 2x asset resampled to some
 * other fraction loses the 1px box-drawing rules, which is most of what makes
 * a terminal screenshot legible.
 */
export function Terminal({ shot, title, className, bare, priority, alt }: TerminalShotProps) {
  const size = shots[shot as ShotName] ?? { width: 2560, height: 1440 };
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
        width={size.width}
        height={size.height}
        priority={priority}
        sizes={`${Math.round(size.width / 2)}px`}
        className="h-auto w-full"
        style={{ maxWidth: `${Math.round(size.width / 2)}px` }}
        unoptimized
      />
    </div>
  );
}
