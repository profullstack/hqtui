import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { isOurs, readWebhook, verifyWebhook } from "../lib/coinpay.ts";

const SECRET = "whsecret_hqtuiTestSecret";

// The exact shape coinpayportal src/lib/webhooks/service.ts sends.
const payload = {
  id: "evt_d084f959-c33c-4540-82b8-221181347639_1775551263",
  type: "payment.confirmed",
  data: {
    payment_id: "d084f959-c33c-4540-82b8-221181347639",
    status: "confirmed",
    amount: 1,
    amount_crypto: "1.000000",
    amount_usd: 1,
    currency: "USDC_SOL",
    confirmations: 1,
    payment_address: "So1anaAddr",
    tx_hash: "0xabc",
    metadata: { property: "hqtui.com", product: "hqtui-cookbook-pdf", reference: "r-1" },
  },
  created_at: "2026-10-21T00:00:00.000Z",
  business_id: "biz_1",
};

function sign(raw: string, t: number, secret = SECRET): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
}

test("a real CoinPay signature verifies", () => {
  const raw = JSON.stringify(payload);
  const now = 1775551263;
  assert.equal(verifyWebhook(raw, sign(raw, now), SECRET, now), true);
});

test("tampered, stale, wrong-secret and bare-HMAC signatures are refused", () => {
  const raw = JSON.stringify(payload);
  const now = 1775551263;
  assert.equal(verifyWebhook(raw + " ", sign(raw, now), SECRET, now), false);
  assert.equal(verifyWebhook(raw, sign(raw, now - 301), SECRET, now), false);
  assert.equal(verifyWebhook(raw, sign(raw, now, "other"), SECRET, now), false);
  const bare = createHmac("sha256", SECRET).update(raw).digest("hex");
  assert.equal(verifyWebhook(raw, bare, SECRET, now), false);
  assert.equal(verifyWebhook(raw, null, SECRET, now), false);
  assert.equal(verifyWebhook(raw, sign(raw, now), undefined, now), false);
});

test("the payment id comes from data.payment_id, never the event id", () => {
  const event = readWebhook(payload);
  assert.equal(event.paymentId, "d084f959-c33c-4540-82b8-221181347639");
  assert.equal(event.type, "payment.confirmed");
  assert.equal(event.settled, true);
  assert.equal(isOurs(event.metadata), true);
});

test("forwarded settles; pending and expired do not", () => {
  assert.equal(readWebhook({ ...payload, type: "payment.forwarded", data: { ...payload.data, status: "forwarded" } }).settled, true);
  assert.equal(readWebhook({ ...payload, type: "payment.pending", data: { ...payload.data, status: "pending" } }).settled, false);
  assert.equal(readWebhook({ ...payload, type: "payment.expired", data: { ...payload.data, status: "expired" } }).settled, false);
});

test("the older flat test-sender shape still reads", () => {
  const event = readWebhook({ type: "payment.confirmed", payment_id: "p-flat", status: "confirmed", metadata: {} });
  assert.equal(event.paymentId, "p-flat");
  assert.equal(event.settled, true);
  assert.equal(isOurs(event.metadata), false);
});
