import { robotsRoute } from "@profullstack/x402-gateway/next";

import { gateway } from "@/lib/crawl-gateway";

/**
 * robots.txt from the crawl gateway's own lists (training crawlers pointed at
 * the pass page, retrieval fetchers welcome), with the Sitemap line it adds
 * for the gateway's siteUrl: https://hqtui.com/sitemap.xml.
 */
export const GET = robotsRoute(gateway, { disallow: ["/api/", "/book/thanks"] });
