import type { NextConfig } from "next";

/**
 * The only external origin the site loads from is the stats script. Fonts are
 * `next/font/google`, which self-hosts them at build time, so nothing is
 * fetched from Google at run time; the other external URLs in the source are
 * links, not resource loads.
 *
 * `unsafe-inline` is required for scripts and styles because Next injects both
 * inline and this build uses no nonce. It still leaves the policy worth having:
 * an unexpected *origin* cannot serve script, and `object-src 'none'` plus
 * `base-uri 'self'` close the usual injection paths.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://crawlproof.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://crawlproof.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // Railway runs one container: standalone bundles the server and only the
  // dependencies it actually imports.
  output: "standalone",
  // The workspace root is two levels up, so tracing has to start there or the
  // library's files are left out of the standalone build.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // The blog reads its markdown at request time from content/blog. The tracer
  // only follows imports, so the files have to be named or the standalone
  // image ships an empty blog.
  outputFileTracingIncludes: {
    "/blog": ["./content/blog/**/*"],
    "/blog/[slug]": ["./content/blog/**/*"],
    "/blog/feed.xml": ["./content/blog/**/*"],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    // The screenshots are local PNGs; no remote loader is needed.
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Railway terminates TLS and the site is HTTPS-only.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
