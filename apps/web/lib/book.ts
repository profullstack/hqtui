import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter } from "@/lib/blog";

/**
 * The High Quality Terminal UI Cookbook: markdown files in `content/book`, one
 * per chapter, read at request time. Same shape as the blog and deliberately
 * so, because the same renderer produces the HTML here, the PDF and the EPUB.
 *
 * Chapters are ordered by their `order` field rather than by filename, so
 * inserting one does not mean renaming the rest.
 */

export interface Chapter {
  slug: string;
  title: string;
  summary: string;
  order: number;
  /** The markdown body. */
  body: string;
}

export const BOOK_TITLE = "The High Quality Terminal UI Cookbook";
export const BOOK_DESCRIPTION =
  "Building terminal interfaces people want to keep open: layout, widgets, input, themes, testing and performance.";
export const BOOK_AUTHOR = "Profullstack";

const CONTENT_DIR = join(process.cwd(), "content", "book");

export function chapterFromFile(filename: string, source: string): Chapter | null {
  const slug = filename.replace(/\.md$/, "");
  const { data, body } = parseFrontmatter(source);
  if (!data.title) return null;
  return {
    slug,
    title: data.title,
    summary: data.summary ?? "",
    order: Number(data.order ?? 0),
    body: body.trim(),
  };
}

/** Every chapter, in reading order. A file without a title is not a chapter. */
export function allChapters(dir: string = CONTENT_DIR): Chapter[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
  return names
    .map((name) => chapterFromFile(name, readFileSync(join(dir, name), "utf8")))
    .filter((chapter): chapter is Chapter => chapter !== null)
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

export function chapterBySlug(slug: string, dir: string = CONTENT_DIR): Chapter | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  return allChapters(dir).find((chapter) => chapter.slug === slug) ?? null;
}

/** The chapters either side, for the footer links. */
export function neighbours(slug: string, dir: string = CONTENT_DIR) {
  const chapters = allChapters(dir);
  const index = chapters.findIndex((chapter) => chapter.slug === slug);
  return {
    previous: index > 0 ? chapters[index - 1] : null,
    next: index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null,
  };
}
