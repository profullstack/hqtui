import Link from "next/link";
import { SiteFooter, SiteNav } from "@/components/site/nav";
import { allChapters, BOOK_DESCRIPTION, BOOK_TITLE } from "@/lib/book";
import { recordView } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = { title: BOOK_TITLE, description: BOOK_DESCRIPTION };

export default async function Book() {
  await recordView("/book");
  const chapters = allChapters();

  return (
    <div className="min-h-screen bg-[#05070a] text-white">
      <SiteNav />
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{BOOK_TITLE}</h1>
        <p className="mt-3 leading-relaxed text-white/60">{BOOK_DESCRIPTION}</p>

        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/book/01-the-first-frame"
            className="rounded-lg bg-[#5fff87] px-4 py-2 font-medium text-black transition-opacity hover:opacity-90"
          >
            Read it free
          </Link>
          <a
            href="/book.epub"
            className="rounded-lg border border-white/15 px-4 py-2 text-white/80 transition-colors hover:text-white"
          >
            EPUB, free
          </a>
          <Link
            href="/book/buy"
            className="rounded-lg border border-white/15 px-4 py-2 text-white/80 transition-colors hover:text-white"
          >
            PDF, $1
          </Link>
        </div>
        <p className="mt-3 text-[13px] text-white/40">
          The whole book is on this site and in the EPUB, both free. The PDF is a dollar, paid in
          crypto through CoinPay, and it exists because typeset things are nicer to keep.
        </p>

        <ol className="mt-10 space-y-1">
          {chapters.map((chapter, index) => (
            <li key={chapter.slug}>
              <Link
                href={`/book/${chapter.slug}`}
                className="group flex gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-white/5"
              >
                <span className="pt-0.5 font-mono text-sm text-white/30">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <span className="font-medium group-hover:text-white">{chapter.title}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-white/50">
                    {chapter.summary}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </main>
      <SiteFooter />
    </div>
  );
}
