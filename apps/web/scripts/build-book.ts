/**
 * Builds the cookbook's downloadable forms from the same markdown the site
 * renders, so the three cannot say different things.
 *
 *   bun apps/web/scripts/build-book.ts
 *
 * Out:
 *   apps/web/public/book.epub          free, served directly
 *   apps/web/content/book/dist/book.pdf  paid, NOT under public/
 *
 * The PDF deliberately lands outside `public/`. Next serves everything in
 * there without asking anyone, and this one is a dollar.
 *
 * pandoc does the conversion and typst is its PDF engine, which is why this
 * needs no LaTeX. Both are pinned in mise.toml.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..");
const CHAPTERS = join(WEB, "content", "book");
const DIST = join(CHAPTERS, "dist");
const PUBLIC = join(WEB, "public");

const TITLE = "The High Quality Terminal UI Cookbook";
const AUTHOR = "Profullstack";
const SITE = "https://hqtui.com";

interface Chapter {
  order: number;
  title: string;
  summary: string;
  body: string;
}

function parse(source: string): Chapter | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return null;
  const data: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    let value = line.slice(colon + 1).trim();
    if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);
    data[line.slice(0, colon).trim()] = value;
  }
  if (!data.title) return null;
  return {
    order: Number(data.order ?? 0),
    title: data.title,
    summary: data.summary ?? "",
    body: source.slice(match[0].length).trim(),
  };
}

/**
 * Site-relative links only make sense on the site. In a file someone keeps,
 * they have to point back at it.
 */
function absolute(markdown: string): string {
  return markdown.replace(/\]\((\/[^)]*)\)/g, (_, path: string) => `](${SITE}${path})`);
}

function build(): void {
  const chapters = readdirSync(CHAPTERS)
    .filter((name) => name.endsWith(".md"))
    .map((name) => parse(readFileSync(join(CHAPTERS, name), "utf8")))
    .filter((chapter): chapter is Chapter => chapter !== null)
    .sort((a, b) => a.order - b.order);

  if (chapters.length === 0) throw new Error(`no chapters in ${CHAPTERS}`);

  const document = [
    "---",
    `title: "${TITLE}"`,
    `author: "${AUTHOR}"`,
    `lang: en`,
    "---",
    "",
    ...chapters.map((chapter) => `# ${chapter.title}\n\n${absolute(chapter.body)}`),
  ].join("\n\n");

  mkdirSync(DIST, { recursive: true });
  const source = join(DIST, "book.md");
  writeFileSync(source, `${document}\n`);

  const common = ["--from=markdown", "--toc", "--toc-depth=2", "--highlight-style=tango"];

  execFileSync("pandoc", [source, ...common, "--to=epub", "-o", join(PUBLIC, "book.epub")], {
    stdio: "inherit",
  });

  execFileSync(
    "pandoc",
    [
      source,
      ...common,
      "--pdf-engine=typst",
      // Typst's defaults are a web page in a PDF. These are a book.
      "-V",
      "papersize=a4",
      "-V",
      "margin-x=2.2cm",
      "-V",
      "margin-y=2.4cm",
      "-o",
      join(DIST, "book.pdf"),
    ],
    { stdio: "inherit" },
  );

  console.log(`${chapters.length} chapters`);
  console.log(`epub  ${join(PUBLIC, "book.epub")}`);
  console.log(`pdf   ${join(DIST, "book.pdf")}`);
}

build();
