import { NextResponse } from "next/server";

import { createCheckoutSession, normalizeEmail } from "@/lib/coinpay";
import { recordCheckout } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Starts a purchase: opens a CoinPay hosted checkout session and sends the
 * buyer there to pay in any coin the business holds a wallet for, or PayPal.
 *
 * A server-side redirect rather than a cross-origin form post, because the
 * site's CSP sets `form-action 'self'` and a form aimed at another origin is
 * silently refused by the browser. A 303 is not affected by that.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const email = normalizeEmail(form?.get("email"));
  // A relative Location, not one built from request.url: behind the proxy that
  // is the container's own address.
  if (!email) return new Response(null, { status: 303, headers: { location: "/book/buy?error=email" } });

  try {
    const session = await createCheckoutSession(email);
    // The session id is the purchase key until the webhook confirms it.
    await recordCheckout(session.id, "SESSION");
    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    // Never render the upstream body: it can carry the request we signed.
    console.error("hqtui: cookbook checkout failed", error);
    return new Response(null, { status: 303, headers: { location: "/book/buy?error=1" } });
  }
}
