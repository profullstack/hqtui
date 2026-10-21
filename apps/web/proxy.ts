import type { NextRequest } from "next/server";
import { gate } from "@/lib/crawl-gateway";

/**
 * Crawl gateway first: AI training crawlers get 402 Payment Required (or the
 * pass page at /crawl) unless they present a paid pass. Everyone else carries
 * on to the app.
 */
export async function proxy(request: NextRequest) {
  const answer = await gate(request);
  if (answer) return answer;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|css|js|map|pdf)$).*)",
  ],
};
