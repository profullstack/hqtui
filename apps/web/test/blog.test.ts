import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allPosts, excerpt, parseFrontmatter, postBySlug, renderMarkdown } from "../lib/blog.ts";

test("frontmatter is read and the body is what follows it", () => {
  const { data, body } = parseFrontmatter(`---\ntitle: "Hello: world"\ndate: 2026-09-03\n---\n\nFirst line.`);
  assert.equal(data.title, "Hello: world");
  assert.equal(data.date, "2026-09-03");
  assert.equal(body.trim(), "First line.");
});

test("markdown renders the subset the posts use, and escapes everything else", () => {
  const html = renderMarkdown(
    [
      "# Heading",
      "",
      "A paragraph with **bold**, *italic*, `code <b>` and a [link](https://example.com).",
      "Bare https://hqtui.com/blog too, and <script>alert(1)</script>.",
      "",
      "- one",
      "- two",
      "",
      "```ts",
      "const x = 1 < 2;",
      "```",
      "",
      "> quoted",
    ].join("\n"),
  );
  assert.ok(html.includes('<h2 id="heading">Heading</h2>'), "a post heading is an h2 under the page title");
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<em>italic</em>"));
  assert.ok(html.includes("<code>code &lt;b&gt;</code>"), "code spans are escaped, not rendered");
  assert.ok(html.includes('<a href="https://example.com">link</a>'));
  assert.ok(html.includes('<a href="https://hqtui.com/blog">https://hqtui.com/blog</a>'), "bare URLs are linked");
  assert.ok(!html.includes("<script>"), "raw HTML never passes through");
  assert.ok(html.includes("<ul><li>one</li><li>two</li></ul>"));
  assert.ok(html.includes('<pre><code class="language-ts">const x = 1 &lt; 2;</code></pre>'));
  assert.ok(html.includes("<blockquote><p>quoted</p></blockquote>"));
});

test("a javascript: link is neutralised", () => {
  assert.ok(renderMarkdown("[x](javascript:alert(1))").includes('href="#"'));
});

test("posts are listed newest first and looked up by slug", () => {
  const dir = mkdtempSync(join(tmpdir(), "hqtui-blog-"));
  writeFileSync(join(dir, "older.md"), "---\ntitle: Older\ndate: 2026-01-01\n---\n\nOld body.");
  writeFileSync(join(dir, "newer.md"), "---\ntitle: Newer\ndate: 2026-02-01\ndescription: New.\n---\n\nNew body.");
  writeFileSync(join(dir, "draft.md"), "No frontmatter, so not a post.");
  const posts = allPosts(dir);
  assert.deepEqual(
    posts.map((p) => p.slug),
    ["newer", "older"],
  );
  assert.equal(postBySlug("older", dir)?.body, "Old body.");
  assert.equal(postBySlug("../etc/passwd", dir), null, "a slug is a slug");
  assert.equal(excerpt("# Title\n\nThe **first** paragraph.\n\nSecond."), "The first paragraph.");
});

test("the shipped posts all parse", () => {
  const posts = allPosts(join(import.meta.dirname, "..", "content", "blog"));
  assert.ok(posts.length >= 1);
  for (const post of posts) {
    assert.match(post.date, /^\d{4}-\d{2}-\d{2}$/, `${post.slug} has an ISO date`);
    assert.ok(post.title.length > 0);
    assert.ok(!/[—–]/.test(post.body), `${post.slug} has no dashes of the long kind`);
  }
});
