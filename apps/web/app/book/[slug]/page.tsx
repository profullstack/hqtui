import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { SiteFooter, SiteNav } from "@/components/site/nav";
import { renderMarkdown } from "@/lib/blog";
import { allChapters, BOOK_TITLE, chapterBySlug, neighbours } from "@/lib/book";
import { recordView } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const chapter = chapterBySlug(slug);
  if (!chapter) return { title: "Not found" };
  return {
    title: `${chapter.title} — ${BOOK_TITLE}`,
    description: chapter.summary,
    alternates: { canonical: `/book/${chapter.slug}` },
  };
}

export default async function BookChapter({ params }: Params) {
  const { slug } = await params;
  const chapter = chapterBySlug(slug);
  if (!chapter) notFound();
  await recordView(`/book/${chapter.slug}`);

  const chapters = allChapters();
  const index = chapters.findIndex((c) => c.slug === chapter.slug);
  const { previous, next } = neighbours(chapter.slug);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <Link
          href="/book"
          className="inline-flex items-center gap-1 font-mono text-xs text-white/50 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {BOOK_TITLE}
        </Link>
        <article className="mt-6">
          <header>
            <p className="font-mono text-xs text-white/50">
              Chapter {index + 1} of {chapters.length}
            </p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight">{chapter.title}</h1>
            <p className="mt-3 leading-relaxed text-white/60">{chapter.summary}</p>
          </header>
          {/* Rendered by lib/blog.ts from files in this repository, never from
              user input, and every text node in it is escaped there. */}
          <div
            className="post-body mt-8"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(chapter.body) }}
          />
        </article>

        <nav className="mt-14 flex flex-wrap justify-between gap-4 border-t border-white/10 pt-6 text-sm">
          {previous ? (
            <Link href={`/book/${previous.slug}`} className="text-white/60 hover:text-white">
              ← {previous.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/book/${next.slug}`} className="ml-auto text-white/60 hover:text-white">
              {next.title} →
            </Link>
          ) : (
            <Link href="/book/buy" className="ml-auto text-white/60 hover:text-white">
              Get the PDF, $1 →
            </Link>
          )}
        </nav>
      </main>
      <SiteFooter />
    </div>
  );
}
