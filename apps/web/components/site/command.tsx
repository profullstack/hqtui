import { cn } from "@/lib/utils";

import { CopyButton } from "@/components/site/copy-button";

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
  label?: string;
}) {
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

      <CopyButton text={command} label={label ? `${label} command` : "command"} />
    </div>
  );
}
