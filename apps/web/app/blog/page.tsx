import Link from "next/link";
import { Rss } from "lucide-react";

import { SiteFooter, SiteNav } from "@/components/site/nav";
import { recordView } from "@/lib/db";
import { allPosts, BLOG_DESCRIPTION, BLOG_TITLE, excerpt, formatDate } from "@/lib/blog";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Blog",
  description: BLOG_DESCRIPTION,
  alternates: { canonical: "/blog", types: { "application/rss+xml": "/blog/feed.xml" } },
};

export default async function Blog() {
  await recordView("/blog");
  const posts = allPosts();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">{BLOG_TITLE}</h1>
            <p className="mt-3 leading-relaxed text-white/60">{BLOG_DESCRIPTION}</p>
          </div>
          <a
            href="/blog/feed.xml"
            className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-white/50 transition-colors hover:text-white"
          >
            <Rss className="h-3.5 w-3.5" aria-hidden />
            RSS
          </a>
        </div>

        <ol className="mt-12 space-y-10">
          {posts.map((post) => (
            <li key={post.slug}>
              <article>
                <time dateTime={post.date} className="font-mono text-xs text-white/50">
                  {formatDate(post.date)}
                </time>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                  <Link href={`/blog/${post.slug}`} className="transition-colors hover:text-white/80">
                    {post.title}
                  </Link>
                </h2>
                <p className="mt-2 leading-relaxed text-white/60">{post.description || excerpt(post.body)}</p>
              </article>
            </li>
          ))}
          {posts.length === 0 ? <li className="text-white/50">Nothing published yet.</li> : null}
        </ol>
      </main>
      <SiteFooter />
    </div>
  );
}
