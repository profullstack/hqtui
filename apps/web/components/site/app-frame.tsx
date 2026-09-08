import Image from "next/image";
import { cn } from "@/lib/utils";
import apps from "@/public/apps/apps.json";

type AppName = keyof typeof apps;

export interface AppFrameProps {
  /** Basename in /public/apps, without the extension. */
  shot: string;
  title?: string;
  className?: string;
  priority?: boolean;
  alt: string;
}

/**
 * A screenshot of an application built with HQTUI.
 *
 * The same idea as `Terminal`, reading from /public/apps rather than
 * /public/shots: those are the library's own demo, these are other people's
 * programs, and mixing them in one directory makes it impossible to tell which
 * is which when regenerating either.
 *
 * Captured at 2x by `bun apps/web/scripts/app-shots.ts`, and displayed at
 * exactly half. Resampling a terminal screenshot to any other fraction loses
 * the 1px box-drawing rules, which is most of what makes one legible.
 */
export function AppFrame({ shot, title, className, priority, alt }: AppFrameProps) {
  const size = (apps[shot as AppName] ?? { width: 2301, height: 1200 }) as {
    width: number;
    height: number;
  };
  const displayWidth = Math.round(size.width / 2);
  return (
    <div className={cn("terminal-frame", className)}>
      <div className="terminal-frame__bar">
        <span className="terminal-frame__dot bg-[#ff5f57]" />
        <span className="terminal-frame__dot bg-[#febc2e]" />
        <span className="terminal-frame__dot bg-[#28c840]" />
        <span className="ml-2 font-mono text-[11px] text-white/50">{title ?? shot}</span>
      </div>
      <Image
        src={`/apps/${shot}.png`}
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
