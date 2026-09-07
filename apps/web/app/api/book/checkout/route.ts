import { NextResponse } from "next/server";

import { createPayment, DEFAULT_CHAIN, isSupportedChain } from "@/lib/coinpay";
import { recordCheckout } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Starts a purchase and sends the buyer to CoinPay.
 *
 * A server-side redirect rather than a cross-origin form post, because the
 * site's CSP sets `form-action 'self'` and a form aimed at another origin is
 * silently refused by the browser. A 303 is not affected by that.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const requested = String(form?.get("chain") ?? DEFAULT_CHAIN);
  const chain = isSupportedChain(requested) ? requested : DEFAULT_CHAIN;

  try {
    const payment = await createPayment(chain);
    await recordCheckout(payment.id, chain);
    return NextResponse.redirect(payment.url, 303);
  } catch (error) {
    // Never render the upstream body: it can carry the request we signed.
    console.error("hqtui: cookbook checkout failed", error);
    // A relative Location, not one built from request.url: behind Railway's
    // proxy that is the container's own address, and the browser would be sent
    // to https://0.0.0.0:8080.
    return new Response(null, { status: 303, headers: { location: "/book/buy?error=1" } });
  }
}
