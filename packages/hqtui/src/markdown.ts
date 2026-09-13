import { stripAnsi } from "./ansi.ts";
import { toSpanLines, type RichText } from "./richtext.ts";

/** Plain labels remain literal Markdown, including brackets, pipes and HTML. */
export function markdownText(value: string): string {
  return stripAnsi(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/([\\`*_{}\[\]<>#|!])/g, "\\$1");
}

/** Semantic summaries, collected before wrapping, clipping or scrolling. */
export class MarkdownSummary {
  private blocks: Array<string | (() => string)> = [];

  add(block: string | (() => string)): void { this.blocks.push(block); }

  child(): MarkdownSummary {
    const child = new MarkdownSummary();
    this.add(() => child.body());
    return child;
  }

  text(value: RichText): void {
    this.add(markdownText(toSpanLines(value).map((line) => line.map((s) => s.text).join("")).join("\n")));
  }

  values(rows: Array<{ label: string; value: string }>): void {
    this.add(rows.filter((row) => row.label || row.value).map(({ label, value }) => {
      const key = markdownText(label.replace(/:\s*$/, "")).replace(/\s*\n\s*/g, " ");
      const content = markdownText(value).replace(/\n/g, "\n  ");
      return key ? `- **${key}:** ${content}` : `- ${content}`;
    }).join("\n"));
  }

  series(values: number[], label = "Series", format: (value: number) => string = String): void {
    const finite = values.filter(Number.isFinite);
    if (!finite.length) { this.values([{ label, value: "No samples" }]); return; }
    const latest = values.at(-1);
    const min = finite.reduce((a, b) => Math.min(a, b), Infinity);
    const max = finite.reduce((a, b) => Math.max(a, b), -Infinity);
    this.values([{ label, value: `Latest: ${latest !== undefined && Number.isFinite(latest) ? format(latest) : "unavailable"}; min: ${format(min)}; max: ${format(max)}; ${finite.length} samples` }]);
  }

  body(): string {
    return this.blocks.map((block) => typeof block === "function" ? block() : block)
      .filter((block) => block.trim()).join("\n\n");
  }

  document(title?: string, subtitle?: string, context?: string, footer?: string): string {
    return [
      `## ${markdownText(title || "Summary").replace(/\s*\n\s*/g, " ")}`,
      context ? markdownText(context) : "",
      subtitle ? markdownText(subtitle) : "",
      this.body(),
      footer ? markdownText(footer) : "",
    ].filter(Boolean).join("\n\n") + "\n";
  }
}

/** OSC 52 sets the invoking terminal's clipboard, including over SSH. */
export function clipboardSequence(text: string, tmux = false): string {
  const payload = Buffer.from(text, "utf8").toString("base64");
  // Fail explicitly instead of silently truncating an exported summary.
  if (payload.length > 100_000) throw new RangeError("Markdown exceeds the terminal clipboard limit.");
  const sequence = `\x1b]52;c;${payload}\x07`;
  return tmux ? `\x1bPtmux;${sequence.replace(/\x1b/g, "\x1b\x1b")}\x1b\\` : sequence;
}
