import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Railway runs one container: standalone bundles the server and only the
  // dependencies it actually imports.
  output: "standalone",
  // The workspace root is two levels up, so tracing has to start there or the
  // library's files are left out of the standalone build.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
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
        ],
      },
    ];
  },
};

export default nextConfig;
