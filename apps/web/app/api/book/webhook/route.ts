import { NextResponse } from "next/server";

import { signDownloadToken, verifyWebhook } from "@/lib/coinpay";
import { markPaid } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * CoinPay tells us a payment confirmed.
 *
 * The signature is over the raw body, so the body is read as text and parsed
 * afterwards. Re-serialising the parsed object would change the bytes and the
 * signature would never match.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const signature =
    request.headers.get("x-coinpay-signature") ?? request.headers.get("x-webhook-signature");

  if (!verifyWebhook(raw, signature)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let event: { event?: string; type?: string; payment?: { id?: string }; data?: { id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const name = event.event ?? event.type ?? "";
  const paymentId = event.payment?.id ?? event.data?.id;
  if (!paymentId) return NextResponse.json({ error: "no payment id" }, { status: 400 });

  // `payment.forwarded` follows `payment.confirmed`; either means the money
  // arrived, and marking twice is harmless.
  if (name === "payment.confirmed" || name === "payment.forwarded") {
    await markPaid(paymentId);
    // Returned so a caller watching the response can hand the buyer their link
    // without waiting for the redirect to come back around.
    return NextResponse.json({ ok: true, download: `/api/book/download?token=${signDownloadToken(paymentId)}` });
  }

  return NextResponse.json({ ok: true, ignored: name });
}
