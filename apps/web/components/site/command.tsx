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
async function copyText(text: string): Promise<boolean> {
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
 * A shell command with a copy button.
 *
 * `command` is what lands on the clipboard, verbatim — the `$` prompts are
 * decoration and are never copied, because pasting one back into a shell is the
 * classic way to make a copied command fail.
 */
export function CommandBlock({
  command,
  className,
  label,
}: {
  command: string;
  className?: string;
  /** Overrides the button's accessible name when a page shows several blocks. */
  label?: string;
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
    const ok = await copyText(command);
    setStatus(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2000);
  }, [command]);

  const lines = command.split("\n");

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border border-white/10 bg-[#0a0e14]",
        className,
      )}
    >
      <pre className="overflow-x-auto px-3 py-2.5 pr-11 font-mono text-[12px] leading-relaxed text-[#c6d0db]">
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre">
            <span aria-hidden className="select-none text-[#5fff87]">
              ${" "}
            </span>
            {line}
          </div>
        ))}
      </pre>

      <button
        type="button"
        onClick={onCopy}
        aria-label={label ? `Copy ${label} command` : "Copy command"}
        className={cn(
          "absolute right-1.5 top-1.5 rounded-md border border-white/10 bg-white/[0.04] p-1.5",
          "text-white/50 transition-colors hover:bg-white/10 hover:text-white",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5fff87]",
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
        {status === "failed" ? "Copying failed — select the command and copy it" : null}
      </span>
    </div>
  );
}
