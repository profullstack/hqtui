import { createGateway } from "@profullstack/x402-gateway";
import { x402Proxy } from "@profullstack/x402-gateway/next";

/**
 * Sells crawl access to AI training crawlers (GPTBot, ClaudeBot, CCBot, ...)
 * by the day over x402, settled by CoinPay in USDC, with a CoinPay checkout
 * for people at /crawl. Browsers, Googlebot and AI chat/search fetchers pass
 * through untouched.
 *
 * Runs inside the proxy, so nothing here may import Node-only modules. The env
 * is read through a non-literal key on purpose: Next inlines `process.env.NAME`
 * at build time, and these are runtime secrets.
 */
const env = (name: string) => process.env[name];

export const gateway = createGateway({
  siteUrl: (env("SITE_URL") || env("NEXT_PUBLIC_SITE_URL") || "https://hqtui.com").replace(/\/+$/, ""),
  siteName: "HQTUI",
  coinpay: { apiKey: env("COINPAY_X402_KEY") },
  payTo: env("CRAWL_PAY_TO"),
  contact: "mailto:anthony@profullstack.com",
  // Health checks, the API (votes, book checkout and its CoinPay webhook, the
  // paid download) and the scripts people curl are never charged.
  openPaths: ["/api/", "/install.sh", "/demo.sh", "/robots.txt", "/sitemap.xml", "/llms.txt", "/.well-known/"],
});

/** Resolves to a Response for a refused crawler, or undefined to carry on. */
export const gate = x402Proxy(gateway);
