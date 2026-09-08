/**
 * Styled text: more than one colour on a line.
 *
 * A `Span` is a run of text with its own style; a line is a list of spans; text
 * is a list of lines. Every widget that took a `string` takes `RichText` too,
 * and a bare string is simply the one-span case, so nothing that worked before
 * has to change.
 *
 * The measuring and cutting here mirrors `unicode.ts` exactly rather than
 * approximating it. `truncateSpans`, `fitSpans` and `wrapSpans` produce the
 * same columns as `truncate`, `fit` and `wrap` for single-span input — there
 * are tests that assert precisely that over a corpus, because two text layout
 * engines that disagree by one column is a bug you find in a screenshot six
 * months later.
 */
import { Attr, type Style } from "./buffer.ts";
import type { Color } from "./color.ts";
import { cellText, dropColumns, graphemes, stringWidth } from "./unicode.ts";

export interface Span {
  text: string;
  fg?: Color;
  bg?: Color;
  attrs?: number;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** One line of styled text. */
export type SpanLine = Span[];

/**
 * Anything a widget will accept where it used to take a string.
 *
 * A plain string is one unstyled span. `Span[]` is one line. `Span[][]` is
 * several. Embedded newlines split into lines wherever they appear, so a span
 * carrying "a\nb" behaves like the string "a\nb" always did.
 */
export type RichText = string | SpanLine | SpanLine[];

/** True when the value carries styling rather than being a bare string. */
export function isRich(value: RichText): value is SpanLine | SpanLine[] {
  return typeof value !== "string";
}

function isLines(value: SpanLine | SpanLine[]): value is SpanLine[] {
  return value.length === 0 || Array.isArray(value[0]);
}

/** The style a span paints with, over whatever the widget already decided. */
export function spanStyle(span: Span, base: Style = {}): Style {
  let attrs = span.attrs ?? base.attrs ?? 0;
  if (span.bold) attrs |= Attr.Bold;
  if (span.dim) attrs |= Attr.Dim;
  if (span.italic) attrs |= Attr.Italic;
  if (span.underline) attrs |= Attr.Underline;
  return {
    fg: span.fg ?? base.fg,
    bg: span.bg ?? base.bg,
    attrs,
  };
}

/** Everything except the text, for cloning a span's styling onto new text. */
function styleOf(span: Span): Omit<Span, "text"> {
  const { text: _text, ...rest } = span;
  return rest;
}

/**
 * Normalise any accepted shape into lines of spans, splitting on newlines.
 *
 * Empty spans are dropped, but a line that ends up with no spans is kept: a
 * blank line between two paragraphs is content, not absence.
 */
export function toSpanLines(value: RichText): SpanLine[] {
  if (typeof value === "string") {
    return value.split("\n").map((line) => (line === "" ? [] : [{ text: line }]));
  }
  const lines: SpanLine[] = isLines(value) ? value : [value];
  const out: SpanLine[] = [];
  for (const line of lines) {
    let current: SpanLine = [];
    for (const span of line) {
      if (span.text === "") continue;
      const parts = span.text.split("\n");
      current.push({ ...styleOf(span), text: parts[0] as string });
      for (let i = 1; i < parts.length; i++) {
        out.push(dropEmpty(current));
        current = [{ ...styleOf(span), text: parts[i] as string }];
      }
    }
    out.push(dropEmpty(current));
  }
  return out;
}

function dropEmpty(line: SpanLine): SpanLine {
  return line.filter((s) => s.text !== "");
}

/** Display width of a line in terminal columns. */
export function spanWidth(line: SpanLine): number {
  let w = 0;
  for (const span of line) w += stringWidth(span.text);
  return w;
}

/** Concatenated text of a line, with styling discarded. */
export function spanText(line: SpanLine): string {
  let out = "";
  for (const span of line) out += span.text;
  return out;
}

/**
 * Truncate a line to `max` columns, appending `ellipsis` when it does not fit.
 *
 * The ellipsis takes the style of the span it interrupts, so cutting a red
 * error message short leaves a red ellipsis rather than a stray default-coloured
 * one.
 */
export function truncateSpans(line: SpanLine, max: number, ellipsis = "…"): SpanLine {
  if (max <= 0) return [];
  if (spanWidth(line) <= max) return line;
  const limit = Math.max(0, max - stringWidth(ellipsis));
  const out: SpanLine = [];
  let w = 0;
  let last: Span | undefined;
  for (const span of line) {
    let text = "";
    for (const g of graphemes(span.text)) {
      if (w + g.width > limit) break;
      text += cellText(g.value);
      w += g.width;
    }
    if (text !== "") {
      last = span;
      out.push({ ...styleOf(span), text });
    }
    if (w >= limit) break;
  }
  const source = last ?? line[0];
  out.push({ ...(source ? styleOf(source) : {}), text: ellipsis });
  return out;
}

/** Pad or truncate a line to exactly `width` columns. */
/**
 * A span line with its first `columns` display columns removed.
 *
 * The string form of this is `dropColumns`; a styled line has to drop the same
 * columns without losing the styles of the runs that survive, so it walks the
 * spans and cuts inside whichever one straddles the offset.
 */
export function dropSpanColumns(line: SpanLine, columns: number): SpanLine {
  if (columns <= 0) return line;
  const out: Span[] = [];
  let skipped = 0;
  for (const span of line) {
    const width = stringWidth(span.text);
    if (skipped >= columns) {
      out.push(span);
      continue;
    }
    if (skipped + width <= columns) {
      skipped += width;
      continue;
    }
    // The cut lands inside this span: keep its style, drop its first columns.
    out.push({ ...span, text: dropColumns(span.text, columns - skipped) });
    skipped = columns;
  }
  return out;
}

export function fitSpans(
  line: SpanLine,
  width: number,
  align: "left" | "right" | "center" = "left",
): SpanLine {
  const cut = truncateSpans(line, width);
  const pad = width - spanWidth(cut);
  if (pad <= 0) return cut;
  // Padding carries no style of its own so it picks up the widget's, which is
  // what the string path has always done by padding before it draws.
  const space = (n: number): Span[] => (n > 0 ? [{ text: " ".repeat(n) }] : []);
  if (align === "right") return [...space(pad), ...cut];
  if (align === "center") {
    const left = Math.floor(pad / 2);
    return [...space(left), ...cut, ...space(pad - left)];
  }
  return [...cut, ...space(pad)];
}

interface Token {
  text: string;
  style: Omit<Span, "text">;
  space: boolean;
}

/** Split a line into whitespace and non-whitespace runs, keeping each style. */
function tokenize(line: SpanLine): Token[] {
  const out: Token[] = [];
  for (const span of line) {
    const style = styleOf(span);
    for (const part of span.text.split(/(\s+)/)) {
      if (part === "") continue;
      out.push({ text: part, style, space: /^\s+$/.test(part) });
    }
  }
  return out;
}

/** Join runs that share a style, so the output has no needless span churn. */
function coalesce(spans: SpanLine): SpanLine {
  const out: SpanLine = [];
  for (const span of spans) {
    if (span.text === "") continue;
    const previous = out[out.length - 1];
    if (previous && sameStyle(previous, span)) previous.text += span.text;
    else out.push({ ...span });
  }
  return out;
}

function sameStyle(a: Span, b: Span): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.attrs === b.attrs
    && !!a.bold === !!b.bold && !!a.dim === !!b.dim
    && !!a.italic === !!b.italic && !!a.underline === !!b.underline;
}

/** Drop trailing whitespace spans, the way a soft wrap trims its line end. */
function trimEnd(spans: SpanLine): SpanLine {
  const out = spans.map((s) => ({ ...s }));
  while (out.length > 0) {
    const last = out[out.length - 1] as Span;
    last.text = last.text.replace(/\s+$/, "");
    if (last.text !== "") break;
    out.pop();
  }
  return out;
}

/**
 * Greedy word wrap at `width` columns, preserving each span's style across the
 * break. Mirrors `wrap()` in unicode.ts, including its hard split of a word
 * longer than the line and its trimming of the soft-wrapped line end.
 */
export function wrapSpans(line: SpanLine, width: number): SpanLine[] {
  if (width <= 0) return [];
  const lines: SpanLine[] = [];
  let current: SpanLine = [];
  let currentWidth = 0;

  const push = (trim: boolean): void => {
    lines.push(coalesce(trim ? trimEnd(current) : current));
    current = [];
    currentWidth = 0;
  };

  for (const token of tokenize(line)) {
    const w = stringWidth(token.text);
    if (currentWidth + w > width && currentWidth > 0) {
      push(true);
      // A break swallows the whitespace that caused it, exactly as `wrap` does.
      if (token.space) continue;
    }
    if (w > width) {
      for (const g of graphemes(token.text)) {
        if (currentWidth + g.width > width) push(false);
        current.push({ ...token.style, text: cellText(g.value) });
        currentWidth += g.width;
      }
      continue;
    }
    current.push({ ...token.style, text: token.text });
    currentWidth += w;
  }
  // The last line is trimmed like a soft-wrapped one. Only the hard split of an
  // overlong word pushes untrimmed, because there the break is mid-word and the
  // whitespace it would trim is real content.
  push(true);
  return lines;
}

/** Wrap every line of a rich value, in order. */
export function wrapRich(value: RichText, width: number): SpanLine[] {
  const out: SpanLine[] = [];
  for (const line of toSpanLines(value)) {
    if (line.length === 0) {
      // A blank line survives wrapping as a blank line.
      out.push([]);
      continue;
    }
    for (const wrapped of wrapSpans(line, width)) out.push(wrapped);
  }
  return out;
}
