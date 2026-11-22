import type { MetadataRoute } from "next";

import { allPosts, postUrl, SITE } from "@/lib/blog";
import { allChapters } from "@/lib/book";

/**
 * Every public page: the static ones, each blog post (newest first, dated) and
 * each book chapter. A post mirrored from elsewhere points its rel=canonical at
 * the original, so it is left out here too. The checkout thank-you page and the
 * API are not pages.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = ["", "/docs", "/widgets", "/showcase", "/apps", "/blog", "/book", "/book/buy"].map(
    (path) => ({ url: `${SITE}${path}`, changeFrequency: "weekly", priority: path === "" ? 1 : 0.7 }),
  );
  const posts: MetadataRoute.Sitemap = allPosts()
    .filter((post) => !post.canonical)
    .map((post) => ({ url: postUrl(post), lastModified: post.date, changeFrequency: "yearly", priority: 0.6 }));
  const chapters: MetadataRoute.Sitemap = allChapters().map((chapter) => ({
    url: `${SITE}/book/${chapter.slug}`,
    changeFrequency: "monthly",
    priority: 0.6,
  }));
  return [...pages, ...posts, ...chapters];
}
