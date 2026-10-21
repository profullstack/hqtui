import { NextResponse } from "next/server";

import { isOurs, readWebhook, signDownloadToken, verifyWebhook } from "@/lib/coinpay";
import { markPaid } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * CoinPay tells us a payment confirmed. Settles by checkout_session_id, then
 * payment_id; confirmed and forwarded both settle, a repeat changes nothing.
 *
 * The signature is over the raw body, so the body is read as text and parsed
 * afterwards. Re-serialising the parsed object would change the bytes and the
 * signature would never match.
 *
 * Every authenticated event answers 200, including ones we ignore and payment
 * ids we never sold: a non-2xx makes CoinPay retry something that will never
 * succeed.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const signature =
    request.headers.get("x-coinpay-signature") ?? request.headers.get("x-webhook-signature");

  if (!verifyWebhook(raw, signature)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const event = readWebhook(body);
  // A hosted checkout session payment is keyed by its cs_ id (what checkout
  // stored); a payment opened before sessions is keyed by its payment id.
  const key = event.sessionId ?? event.paymentId;
  if (!key) return NextResponse.json({ ok: true, ignored: "no payment id" });
  if (!event.settled) {
    return NextResponse.json({ ok: true, ignored: event.type || event.status || "event" });
  }

  const result = await markPaid(key, isOurs(event.metadata, event.property));
  if (result === "unknown") return NextResponse.json({ ok: true, settled: false, reason: "unknown payment" });
  if (result === "unconfigured") return NextResponse.json({ ok: true, settled: false, reason: "no database" });

  // Returned so a caller watching the response can hand the buyer their link
  // without waiting for the redirect to come back around.
  return NextResponse.json({
    ok: true,
    settled: true,
    duplicate: result === "already_paid",
    download: `/api/book/download?token=${signDownloadToken(key)}`,
  });
}
