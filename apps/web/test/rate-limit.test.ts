import { test } from "node:test";
import assert from "node:assert/strict";
import { clientKey, rateLimited, resetRateLimits } from "../lib/rate-limit.ts";

const req = (headers: Record<string, string> = {}) =>
  new Request("https://hqtui.com/api/vote", { method: "POST", headers });

test("a client gets its allowance and no more", () => {
  resetRateLimits();
  for (let i = 0; i < 5; i++) assert.equal(rateLimited("a", 5), false, `call ${i + 1} was refused`);
  assert.equal(rateLimited("a", 5), true, "the sixth call was allowed");
  // A different client is unaffected.
  assert.equal(rateLimited("b", 5), false);
});

test("the tracking table cannot be grown without bound", () => {
  resetRateLimits();
  // Each distinct address would otherwise hold an array for ever, which is the
  // same unbounded-growth-from-untrusted-input this limiter exists to stop.
  for (let i = 0; i < 60_000; i++) rateLimited(`10.0.${(i / 256) | 0}.${i % 256}`, 10);
  // Still enforcing after the eviction churn.
  for (let i = 0; i < 10; i++) rateLimited("steady", 10);
  assert.equal(rateLimited("steady", 10), true);
});

test("the client key is the hop the proxy actually observed", () => {
  // A proxy appends what it saw, so the last entry is the only one it vouches
  // for. Everything to its left is text the caller sent.
  assert.equal(clientKey(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" })), "10.0.0.2");
  assert.equal(clientKey(req({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
  assert.equal(clientKey(req({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(clientKey(req({ "x-forwarded-for": " , , " })), "unknown");
  assert.equal(clientKey(req()), "unknown");
});

test("a caller cannot rotate its way out by forging x-forwarded-for", () => {
  // A proxy appends the peer it saw, so every entry left of the last is text
  // the caller supplied. Keying on the left-most made the limit a no-op:
  // rotating it granted unlimited requests.
  resetRateLimits();
  const forged = (n: number) =>
    clientKey(req({ "x-forwarded-for": `198.51.100.${n}, 203.0.113.7` }));
  const keys = new Set(Array.from({ length: 50 }, (_, i) => forged(i)));
  assert.equal(keys.size, 1, "a rotating first hop produced distinct keys");
  assert.equal([...keys][0], "203.0.113.7");

  let allowed = 0;
  for (let i = 0; i < 40; i++) {
    if (!rateLimited(forged(i), 10)) allowed++;
  }
  assert.equal(allowed, 10, `rotation let ${allowed} through`);
});

test("a flood of new clients does not hand an established one fresh quota", () => {
  // Evicting the first-inserted key meant an entry's life was a fixed number of
  // new arrivals however active it was, so a background flood reset everyone's
  // window on a schedule: a measured 2,000 new addresses per second turned a
  // 10-per-minute limit into 120, and 10,000 into 600.
  //
  // Eviction now prefers clients barely seen, which holds for any flood the
  // table can hold. Beyond that the limiter degrades by design — see
  // MAX_TRACKED — so this asserts the guarantee that exists.
  resetRateLimits();
  let allowed = 0;
  for (let round = 0; round < 12; round++) {
    if (!rateLimited("steady", 10)) allowed++;
    // Enough rounds to force eviction (12 x 6,000 exceeds MAX_TRACKED) while
    // each round stays well inside what the table can hold.
    for (let i = 0; i < 6_000; i++) rateLimited(`10.${round}.${(i / 256) | 0}.${i % 256}`, 10);
  }
  assert.equal(allowed, 10, `the flood granted ${allowed} of 12 attempts`);
});

test("the key is bounded, so the table is bounded in bytes too", () => {
  // The header is caller-supplied and Node accepts ~8 KiB of it. Ten thousand
  // entries of that size is 80 MB held for a window.
  const huge = "1.2.3.4, " + "9".repeat(8000);
  assert.ok(clientKey(req({ "x-forwarded-for": huge })).length <= 64);
});
