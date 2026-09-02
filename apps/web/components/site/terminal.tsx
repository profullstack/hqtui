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
 * Displayed at its true size — captured width divided by the pixel scale the
 * capture was taken at. Resampling a terminal screenshot to some other
 * fraction loses the 1px box-drawing rules, which is most of what makes one
 * legible.
 */
export function Terminal({ shot, title, className, bare, priority, alt }: TerminalShotProps) {
  const size = (shots[shot as ShotName] ?? { width: 2560, height: 1440, scale: 2 }) as {
    width: number;
    height: number;
    scale?: number;
  };
  // Captures off a real terminal are 1x; the rendered ones are 2x. Dividing by
  // the wrong number either halves a real screenshot or blurs a rendered one.
  const displayWidth = Math.round(size.width / (size.scale ?? 2));
  return (
    <div className={cn("terminal-frame", className)}>
      {bare ? null : (
        <div className="terminal-frame__bar">
          <span className="terminal-frame__dot bg-[#ff5f57]" />
          <span className="terminal-frame__dot bg-[#febc2e]" />
          <span className="terminal-frame__dot bg-[#28c840]" />
          <span className="ml-2 font-mono text-[11px] text-white/50">{title ?? "hqtui"}</span>
        </div>
      )}
      <Image
        src={`/shots/${shot}.png`}
        alt={alt}
        width={size.width}
        height={size.height}
        priority={priority}
        sizes={`${displayWidth}px`}
        className="h-auto w-full"
        style={{ maxWidth: `${displayWidth}px` }}
        unoptimized
      />
    </div>
  );
}
