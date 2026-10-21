import { test } from "node:test";
import assert from "node:assert/strict";

process.env.COINPAY_X402_KEY = "cp_live_test";
process.env.CRAWL_PAY_TO = "0xCC3b072391AE7A8d10cF00DdC5F61DB2cA5541E5";
const { gateway } = await import("../lib/crawl-gateway.ts");

const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const HUMAN = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-dest": "document",
  "x-real-ip": "198.51.100.7",
};

test("a training crawler is answered 402 with PAYMENT-REQUIRED", async () => {
  const res = await gateway.handle(new Request("https://hqtui.com/", { headers: { "user-agent": GPTBOT, "x-real-ip": "203.0.113.9" } }));
  assert.equal(res?.status, 402);
  assert.ok(res?.headers.get("payment-required"));
});

test("/crawl offers a $1 day pass", async () => {
  const res = await gateway.handle(new Request("https://hqtui.com/crawl", { headers: { accept: "application/json" } }));
  assert.equal(res?.status, 402);
  assert.ok(res?.headers.get("payment-required"));
  const body = (await res!.json()) as { accepts: { amount: string }[] };
  assert.equal(String(body.accepts[0]?.amount), "1000000");
});

test("a browser and the API pass through", async () => {
  assert.equal(await gateway.handle(new Request("https://hqtui.com/", { headers: HUMAN })), null);
  assert.equal(await gateway.handle(new Request("https://hqtui.com/api/health", { headers: { "user-agent": GPTBOT } })), null);
});
