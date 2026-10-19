import Script from "next/script";

/**
 * Every blog page carries one CrawlProof unit at the top of the post,
 * above the content (never at the bottom, against the footer): the text strip,
 * filled by ad.js, which collapses to nothing when there is no advertiser.
 * The tracker is in the root layout; this is the ads half of the blog's
 * defaults (tracking + ads, both on).
 */
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <aside data-cp-ad="" data-slot="aa7e2ea7-c443-4301-be28-3436281328ca" data-format="text_link" />
      {children}
      <Script src="https://crawlproof.com/ad.js" strategy="afterInteractive" />
    </>
  );
}
