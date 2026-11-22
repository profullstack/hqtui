import pkg from "../package.json";

/**
 * Every server-side call to CoinPay (x402 verify/settle, hosted checkout
 * sessions) names this app, so CoinPay's logs and throttle can tell the fleet's
 * apps apart instead of seeing one IP as `node` / `Next.js Middleware`.
 * Edge-safe: no Node-only imports, it runs inside the proxy too.
 */
export const COINPAY_UA = `hqtui.com/${pkg.version} (+https://hqtui.com)`;

/** fetch with our User-Agent added (kept if the caller already set one). */
export const coinpayFetch: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has("user-agent")) headers.set("user-agent", COINPAY_UA);
  return fetch(input, { ...init, headers });
};
