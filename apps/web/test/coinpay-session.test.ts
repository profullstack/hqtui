import { test } from "node:test";
import assert from "node:assert/strict";
import { createCheckoutSession, isOurs, normalizeEmail, readWebhook, sessionBody } from "../lib/coinpay.ts";

test("the session body carries email, account, property and our reference", () => {
  const body = sessionBody("buyer@example.com", "ref-1") as Record<string, any>;
  assert.equal(body.amount, 1);
  assert.equal(body.currency, "USD");
  assert.equal(body.customer_email, "buyer@example.com");
  // No accounts on hqtui.com: a guest's account is their email.
  assert.equal(body.account_id, "buyer@example.com");
  assert.equal(body.property, "hqtui.com");
  assert.equal(body.metadata.product, "hqtui-cookbook-pdf");
  assert.equal(body.metadata.reference, "ref-1");
  assert.equal(body.success_url, "https://hqtui.com/book/thanks?session={CHECKOUT_SESSION_ID}");
  assert.equal(body.cancel_url, "https://hqtui.com/book/buy?cancelled=1");
  assert.equal(body.expires_in_minutes, 60);
});

test("checkout POSTs /api/checkout/sessions with the bearer key and returns the hosted url", async () => {
  process.env.COINPAY_API_KEY = "cp_live_test";
  process.env.COINPAY_API_URL = "https://coinpayportal.com";
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ success: true, id: "cs_abcdefgh12345678", url: "https://coinpayportal.com/checkout/cs_abcdefgh12345678" }), { status: 201 });
  }) as unknown as typeof fetch;
  const session = await createCheckoutSession(" Buyer@Example.com ", fake);
  assert.deepEqual(session, { id: "cs_abcdefgh12345678", url: "https://coinpayportal.com/checkout/cs_abcdefgh12345678" });
  assert.equal(seen!.url, "https://coinpayportal.com/api/checkout/sessions");
  assert.equal((seen!.init.headers as Record<string, string>).authorization, "Bearer cp_live_test");
  const body = JSON.parse(String(seen!.init.body));
  assert.equal(body.customer_email, "buyer@example.com");
  assert.equal(body.property, "hqtui.com");
});

test("checkout refuses a bad email and an off-site checkout url", async () => {
  process.env.COINPAY_API_KEY = "cp_live_test";
  await assert.rejects(createCheckoutSession("nope"));
  const evil = (async () =>
    new Response(JSON.stringify({ id: "cs_x", url: "https://evil.example/checkout/cs_x" }), { status: 201 })) as unknown as typeof fetch;
  await assert.rejects(createCheckoutSession("a@b.co", evil), /off-site/);
  assert.equal(normalizeEmail("  A@B.CO "), "a@b.co");
  assert.equal(normalizeEmail("a@b"), null);
});

test("a session webhook is keyed by checkout_session_id, the same for confirmed and forwarded", () => {
  const base = {
    id: "evt_pay_1_1",
    data: {
      payment_id: "pay_1",
      checkout_session_id: "cs_abcdefgh12345678",
      customer_email: "buyer@example.com",
      account_id: "buyer@example.com",
      property: "hqtui.com",
      metadata: { reference: "ref-1" },
    },
  };
  const confirmed = readWebhook({ ...base, type: "payment.confirmed", data: { ...base.data, status: "confirmed" } });
  const forwarded = readWebhook({ ...base, type: "payment.forwarded", data: { ...base.data, status: "forwarded" } });
  assert.equal(confirmed.sessionId, "cs_abcdefgh12345678");
  assert.equal(confirmed.paymentId, "pay_1");
  assert.equal(confirmed.settled && forwarded.settled, true);
  // markPaid is keyed by this id and is a no-op the second time.
  assert.equal(confirmed.sessionId ?? confirmed.paymentId, forwarded.sessionId ?? forwarded.paymentId);
  // The session names the site even when metadata does not.
  assert.equal(isOurs(confirmed.metadata, confirmed.property), true);
  const pending = readWebhook({ ...base, type: "payment.pending", data: { ...base.data, status: "pending" } });
  assert.equal(pending.settled, false);
});
