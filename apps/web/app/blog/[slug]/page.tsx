import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { SiteFooter, SiteNav } from "@/components/site/nav";
import { recordView } from "@/lib/db";
import { formatDate, postBySlug, renderMarkdown } from "@/lib/blog";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const post = postBySlug(slug);
  if (!post) return { title: "Not found" };
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      url: `/blog/${post.slug}`,
      title: post.title,
      description: post.description,
      publishedTime: `${post.date}T00:00:00Z`,
      authors: [post.author],
    },
  };
}

export default async function BlogPost({ params }: Params) {
  const { slug } = await params;
  const post = postBySlug(slug);
  if (!post) notFound();
  await recordView(`/blog/${post.slug}`);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1 font-mono text-xs text-white/50 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          All posts
        </Link>
        <article className="mt-6">
          <header>
            <time dateTime={post.date} className="font-mono text-xs text-white/50">
              {formatDate(post.date)}
            </time>
            <h1 className="mt-2 text-4xl font-bold tracking-tight">{post.title}</h1>
            <p className="mt-3 text-sm text-white/50">{post.author}</p>
          </header>
          {/* The body is rendered by lib/blog.ts from files in this repository,
              never from user input, and every text node in it is escaped there. */}
          <div className="post-body mt-8" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }} />
        </article>
        <p className="mt-12 border-t border-white/10 pt-6 text-sm text-white/50">
          Comments live on{" "}
          <a href="https://bbs.hqtui.com/f/news" className="text-white/70 hover:text-white">
            Discussions
          </a>
          , where every post here becomes a topic.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
