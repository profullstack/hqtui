"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

type Status = "idle" | "copied" | "failed";

/**
 * Copy `text`, falling back to a throwaway textarea.
 *
 * The async Clipboard API needs a secure context and a permission that a
 * browser can refuse, and both of those fail silently from the caller's point
 * of view. The legacy path works everywhere a `<button>` click can reach it, so
 * a refusal costs the visitor nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path rather than reporting failure yet.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    // Off-screen and fixed: selecting a textarea in flow scrolls the page to it.
    area.style.position = "fixed";
    area.style.top = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * The copy affordance every code block on the site uses, so they all behave the
 * same way and there is one place to fix when they do not.
 *
 * It is absolutely positioned into the top-right of a `relative` parent. The
 * caller reserves room for it (`pr-11` on the `<pre>`), because a button
 * floating over the first line of a snippet covers the one token a reader is
 * most likely to be looking for.
 */
export function CopyButton({
  text,
  label,
  className,
}: {
  /** Exactly what lands on the clipboard. */
  text: string;
  /** Named in the accessible label, e.g. "install command". */
  label?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A visitor can click again before the confirmation clears, and an unmount
  // mid-timeout would otherwise set state on a dead component.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    const ok = await copyText(text);
    setStatus(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2000);
  }, [text]);

  return (
    <>
      <button
        type="button"
        onClick={onCopy}
        aria-label={label ? `Copy ${label}` : "Copy code"}
        className={cn(
          "absolute right-1.5 top-1.5 z-10 rounded-md border border-white/10 bg-white/[0.04] p-1.5",
          "text-white/50 transition-colors hover:bg-white/10 hover:text-white",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5fff87]",
          className,
        )}
      >
        {status === "copied" ? (
          <Check className="h-3.5 w-3.5 text-[#5fff87]" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Announced to screen readers; the icon swap is the visual equivalent. */}
      <span aria-live="polite" className="sr-only">
        {status === "copied" ? "Copied to clipboard" : null}
        {status === "failed" ? "Copying failed — select the text and copy it" : null}
      </span>
    </>
  );
}
