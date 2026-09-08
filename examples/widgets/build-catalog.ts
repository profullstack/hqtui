/**
 * Builds the data behind hqtui.com/widgets.
 *
 * Two things go into it, and neither is written by hand:
 *
 *  - the picture, rendered headlessly from the TypeScript gallery, so what the
 *    site shows is the widget's real output rather than a screenshot that
 *    stopped being true three releases ago;
 *  - the code, sliced out of each language's gallery program between its
 *    `@widget <id>` and `@end` markers, so every snippet on the site is a
 *    region of a file that compiles.
 *
 * A language that has no marked region for a widget is reported as not having
 * it. Every language currently marks every widget, including the three that
 * reach the library through a C ABI and COBOL, which does not link against it
 * at all: it writes 80-column records that an adapter renders. A gap here is
 * therefore a missing marker, and the site says so rather than inventing a
 * reason for it.
 *
 * Run: bun examples/widgets/build-catalog.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToHtml } from "@profullstack/hqtui";
import type { Container, Theme } from "@profullstack/hqtui";
import * as gallery from "./gallery.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "apps", "web", "content", "widgets.json");

export interface LanguageSpec {
  id: string;
  label: string;
  file: string;
  /** Highlighter hint for the site. */
  syntax: string;
}

/**
 * Ordered as the gallery reads top to bottom, not alphabetically: someone
 * scanning the page for "the one that draws a bar" should find the meters
 * together.
 */
export interface WidgetSpec {
  id: string;
  title: string;
  category: "Text" | "Data" | "Meters" | "Inputs" | "Overlays";
  blurb: string;
  width: number;
  height: number;
}

/**
 * Each gallery lives where that language's own toolchain already compiles it,
 * so CI proves the snippets build rather than this script asserting they do.
 * Paths are relative to the repository root.
 */
export const LANGUAGES: LanguageSpec[] = [
  { id: "typescript", label: "TypeScript", file: "examples/widgets/gallery.ts", syntax: "ts" },
  { id: "javascript", label: "JavaScript", file: "examples/widgets/gallery.js", syntax: "js" },
  { id: "rust", label: "Rust", file: "ports/rust/examples/widgets.rs", syntax: "rust" },
  { id: "go", label: "Go", file: "ports/go/examples/widgets/main.go", syntax: "go" },
  { id: "python", label: "Python", file: "ports/python/examples/widgets.py", syntax: "python" },
  { id: "zig", label: "Zig", file: "ports/zig/examples/widgets.zig", syntax: "zig" },
  { id: "cpp", label: "C++", file: "ports/cpp/examples/widgets.cpp", syntax: "cpp" },
  { id: "ruby", label: "Ruby", file: "ports/ruby/examples/widgets.rb", syntax: "ruby" },
  { id: "php", label: "PHP", file: "ports/php/examples/widgets.php", syntax: "php" },
  { id: "perl", label: "Perl", file: "ports/perl/examples/widgets.pl", syntax: "perl" },
  { id: "cobol", label: "COBOL", file: "ports/cobol/examples/widgets.cbl", syntax: "cobol" },
];

export const WIDGETS: WidgetSpec[] = [
  { id: "text", title: "Text", category: "Text", width: 58, height: 5,
    blurb: "Aligned, styled, optionally wrapped copy. Every other widget is built on it." },
  { id: "label", title: "Label", category: "Text", width: 58, height: 3,
    blurb: "Text in the theme's muted color: captions and the line under a number." },
  { id: "heading", title: "Heading", category: "Text", width: 58, height: 4,
    blurb: "Bold text in the theme's title color, for sectioning without a panel." },
  { id: "badge", title: "Badge", category: "Text", width: 58, height: 1,
    blurb: "A status chip. Filled, subtle or outline." },
  { id: "divider", title: "Divider", category: "Text", width: 58, height: 5,
    blurb: "A rule, optionally labelled, that titles a section cheaply." },
  { id: "keyValues", title: "Key/values", category: "Text", width: 58, height: 4,
    blurb: "Aligned label and value pairs. The backbone of every system panel." },
  { id: "statusBar", title: "Status bar", category: "Text", width: 62, height: 1,
    blurb: "The keybinding strip along the bottom, with a right-hand slot." },

  { id: "table", title: "Table", category: "Data", width: 58, height: 6,
    blurb: "Columns with alignment, widths, zebra striping, selection and scroll." },
  { id: "list", title: "List", category: "Data", width: 40, height: 5,
    blurb: "A selectable list with bullets and its own scrollbar." },
  { id: "tree", title: "Tree", category: "Data", width: 46, height: 6,
    blurb: "Nested rows with expand state and per-node value columns." },
  { id: "log", title: "Log", category: "Data", width: 62, height: 5,
    blurb: "Levelled log lines that tail by default and scroll back from the end." },

  { id: "meter", title: "Meter", category: "Meters", width: 48, height: 3,
    blurb: "A labelled bar. Smooth or segmented, heat-colored by default." },
  { id: "meters", title: "Meters", category: "Meters", width: 62, height: 4,
    blurb: "A whole bank of meters in one call, laid out in columns." },
  { id: "progress", title: "Progress", category: "Meters", width: 48, height: 2,
    blurb: "A determinate bar that can show a count as well as a ratio." },
  { id: "graph", title: "Graph", category: "Meters", width: 58, height: 9,
    blurb: "A Braille line chart, optionally filled under the curve." },
  { id: "sparkline", title: "Sparkline", category: "Meters", width: 52, height: 3,
    blurb: "One row: label, inline chart and a value." },
  { id: "histogram", title: "Histogram", category: "Meters", width: 58, height: 8,
    blurb: "Block columns. Cheaper than Braille and easier to read when short." },
  { id: "heatBar", title: "Heat bar", category: "Meters", width: 48, height: 3,
    blurb: "A segmented bar colored along the theme's heat ramp." },
  { id: "gauge", title: "Gauge", category: "Meters", width: 40, height: 12,
    blurb: "A semicircular dial. Wants at least nine columns by five rows." },
  { id: "donut", title: "Donut", category: "Meters", width: 40, height: 12,
    blurb: "A ring split into labelled, colored segments." },

  { id: "button", title: "Button", category: "Inputs", width: 58, height: 1,
    blurb: "Variants for primary, success, warning, danger and ghost. Joins the Tab order." },
  { id: "checkbox", title: "Checkbox", category: "Inputs", width: 46, height: 1,
    blurb: "A checkbox or a toggle, depending on the variant." },
  { id: "select", title: "Select", category: "Inputs", width: 40, height: 6,
    blurb: "A closed value, or an open dropdown with the current option marked." },
  { id: "textInput", title: "Text input", category: "Inputs", width: 52, height: 3,
    blurb: "A labelled field with a placeholder and a cursor." },
  { id: "tabs", title: "Tabs", category: "Inputs", width: 62, height: 1,
    blurb: "A single row of tabs with one active. Clickable." },

  { id: "modal", title: "Modal", category: "Overlays", width: 62, height: 12,
    blurb: "A centered dialog drawn over everything, with buttons." },
  { id: "commandPalette", title: "Command palette", category: "Overlays", width: 62, height: 10,
    blurb: "A query line and filtered results, over the current screen." },
  { id: "tooltip", title: "Tooltip", category: "Overlays", width: 62, height: 7,
    blurb: "A small floating box anchored at a cell." },
];

/**
 * Pulls one widget's code out of a gallery file. The markers are comments in
 * whatever the language uses, so the opening marker is matched by its text
 * rather than by a fixed comment character.
 */
export function slice(source: string, id: string): string | null {
  const lines = source.split("\n");
  const opens = new RegExp(`@widget\\s+${id}\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (opens.test(lines[i])) { start = i + 1; break; }
  }
  if (start === -1) return null;
  for (let i = start; i < lines.length; i++) {
    if (/@end\s*$/.test(lines[i])) {
      const body = lines.slice(start, i).join("\n").replace(/\s+$/, "");
      return body.length > 0 ? body : null;
    }
  }
  throw new Error(`unterminated @widget ${id}: no @end marker`);
}

type Example = (ui: Container, theme: Theme) => void;

function preview(spec: WidgetSpec): string {
  const fn = (gallery as Record<string, unknown>)[spec.id] as Example | undefined;
  if (!fn) throw new Error(`gallery.ts has no exported function for widget "${spec.id}"`);
  return renderToHtml(({ ui, theme }) => fn(ui, theme), {
    width: spec.width,
    height: spec.height,
    theme: "dark",
    fontSize: 13,
    padding: 14,
    className: "hqtui-preview",
  });
}

export function build() {
  const sources = new Map<string, string>();
  for (const language of LANGUAGES) {
    try {
      // Normalised, because Windows checks out CRLF and the published catalog
      // must not depend on the line-ending policy of whoever generated it.
      sources.set(
        language.id,
        readFileSync(join(ROOT, language.file), "utf8").replace(/\r\n/g, "\n"),
      );
    } catch {
      // A language whose gallery is not written yet simply has no examples.
      sources.set(language.id, "");
    }
  }

  const widgets = WIDGETS.map((spec) => {
    const examples: Record<string, { code: string; syntax: string }> = {};
    for (const language of LANGUAGES) {
      const code = slice(sources.get(language.id) ?? "", spec.id);
      if (code) examples[language.id] = { code, syntax: language.syntax };
    }
    return { ...spec, preview: preview(spec), examples };
  });

  const catalog = {
    generated: "by examples/widgets/build-catalog.ts — do not edit",
    languages: LANGUAGES,
    widgets,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(catalog, null, 2) + "\n");

  const cells = widgets.reduce((n, w) => n + Object.keys(w.examples).length, 0);
  return { widgets: widgets.length, languages: LANGUAGES.length, cells };
}

if (import.meta.main) {
  const { widgets, languages, cells } = build();
  console.log(`${widgets} widgets x ${languages} languages -> ${cells} examples`);
  console.log(`wrote ${OUT}`);
}
