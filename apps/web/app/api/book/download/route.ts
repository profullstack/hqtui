import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

import { verifyDownloadToken } from "@/lib/coinpay";
import { claimDownload } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Serves the paid PDF.
 *
 * Two gates, and both matter. The token proves the link came from us and has
 * not expired; the database proves the payment actually confirmed. A signed
 * token alone would let anyone who started a checkout and abandoned it walk
 * away with the file.
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const paymentId = verifyDownloadToken(token);
  if (!paymentId) {
    return NextResponse.json({ error: "this link is not valid, or has expired" }, { status: 403 });
  }

  if (!(await claimDownload(paymentId))) {
    return NextResponse.json({ error: "this payment has not confirmed yet" }, { status: 402 });
  }

  let pdf: Buffer;
  try {
    // Outside public/ on purpose: Next serves everything in there to anyone.
    pdf = readFileSync(join(process.cwd(), "content", "book", "dist", "book.pdf"));
  } catch {
    console.error("hqtui: the cookbook PDF is missing from the deployment");
    return NextResponse.json({ error: "the file is temporarily unavailable" }, { status: 503 });
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(pdf.length),
      "content-disposition": 'attachment; filename="high-quality-terminal-ui-cookbook.pdf"',
      "cache-control": "private, no-store",
    },
  });
}
