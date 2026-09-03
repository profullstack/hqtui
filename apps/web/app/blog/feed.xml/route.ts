import {
  allPosts,
  BLOG_DESCRIPTION,
  BLOG_TITLE,
  escapeHtml,
  excerpt,
  postUrl,
  renderMarkdown,
  SITE,
} from "@/lib/blog";

export const dynamic = "force-dynamic";

/**
 * RSS 2.0 for the blog. Each item carries the full post as content:encoded so
 * a reader (or a forum that ingests the feed) has the whole text, and the
 * description is the short form for readers that only show one.
 */
export function GET(): Response {
  const posts = allPosts();
  const newest = posts[0]?.date;
  const items = posts
    .map((post) => {
      const url = postUrl(post);
      return `    <item>
      <title>${escapeHtml(post.title)}</title>
      <link>${escapeHtml(url)}</link>
      <guid isPermaLink="true">${escapeHtml(url)}</guid>
      <pubDate>${new Date(`${post.date}T12:00:00Z`).toUTCString()}</pubDate>
      <dc:creator>${escapeHtml(post.author)}</dc:creator>
      <description>${escapeHtml(post.description || excerpt(post.body))}</description>
      <content:encoded><![CDATA[${renderMarkdown(post.body).replace(/]]>/g, "]]]]><![CDATA[>")}]]></content:encoded>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeHtml(BLOG_TITLE)}</title>
    <link>${SITE}/blog</link>
    <description>${escapeHtml(BLOG_DESCRIPTION)}</description>
    <language>en</language>
    <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml" />
${newest ? `    <lastBuildDate>${new Date(`${newest}T12:00:00Z`).toUTCString()}</lastBuildDate>\n` : ""}${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
