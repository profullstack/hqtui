import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Selling the cookbook PDF for a dollar, in crypto, through CoinPay.
 *
 * Crypto only. On a one dollar sale a card fee takes most of it, and this is
 * the rail CoinPay exists for. The HTML and the EPUB are free, so nobody is
 * paywalled out of the content; the PDF is the typeset artifact.
 *
 * Next inlines `process.env.NAME` at build time, so every secret here is read
 * through a variable key or it compiles in as undefined and 401s in production
 * while working perfectly by curl.
 */
function env(name: string): string | undefined {
  const key = name;
  return process.env[key];
}

/**
 * The vault holds the site origin; the API lives under /api. Getting this
 * wrong returns an HTML page that is then parsed as JSON, which is a confusing
 * way to spend an afternoon.
 */
function apiBase(): string {
  const raw = env("COINPAY_API_URL") ?? "https://coinpayportal.com";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function siteBase(): string {
  return apiBase().replace(/\/api$/, "");
}

export function configured(): boolean {
  return Boolean(env("COINPAY_API_KEY") && env("COINPAY_BUSINESS_ID"));
}

export const PRICE_USD = 1;
export const PROPERTY = "hqtui.com";
export const PRODUCT = "hqtui-cookbook-pdf";

export interface Chain {
  /** What the payments API calls `blockchain`. */
  code: string;
  label: string;
  group: "Stablecoin" | "Coin";
}

/**
 * Every chain the business has a wallet for. A payment on a chain with no
 * wallet is refused by the API rather than falling back to a platform wallet,
 * so this list and the business's wallets have to agree.
 */
export const CHAINS: Chain[] = [
  { code: "USDC_SOL", label: "USDC on Solana", group: "Stablecoin" },
  { code: "USDC_POL", label: "USDC on Polygon", group: "Stablecoin" },
  { code: "USDC_ETH", label: "USDC on Ethereum", group: "Stablecoin" },
  { code: "USDT_SOL", label: "USDT on Solana", group: "Stablecoin" },
  { code: "USDT_POL", label: "USDT on Polygon", group: "Stablecoin" },
  { code: "USDT_ETH", label: "USDT on Ethereum", group: "Stablecoin" },
  { code: "SOL", label: "Solana", group: "Coin" },
  { code: "POL", label: "Polygon", group: "Coin" },
  { code: "ETH", label: "Ethereum", group: "Coin" },
  { code: "BTC", label: "Bitcoin", group: "Coin" },
  { code: "BCH", label: "Bitcoin Cash", group: "Coin" },
  { code: "BNB", label: "BNB", group: "Coin" },
  { code: "ADA", label: "Cardano", group: "Coin" },
  { code: "XRP", label: "XRP", group: "Coin" },
  { code: "DOGE", label: "Dogecoin", group: "Coin" },
];

/**
 * A dollar is a rounding error next to an Ethereum fee, so the default is the
 * cheapest thing that settles in seconds. Every other chain is still offered.
 */
export const DEFAULT_CHAIN = "USDC_SOL";

export function isSupportedChain(code: string): boolean {
  return CHAINS.some((chain) => chain.code === code);
}

export interface CreatedPayment {
  id: string;
  /** Where to send the buyer. */
  url: string;
}

/**
 * Creates a crypto payment and returns where to send the buyer.
 *
 * No `merchant_wallet_address`: the payee belongs on the business, which
 * resolves the right wallet per chain. Passing one here would offer a single
 * address for every chain, which is wrong the moment there is more than one.
 */
export async function createPayment(
  chain: string = DEFAULT_CHAIN,
  buyer: { accountId?: string | null; email?: string | null } = {},
): Promise<CreatedPayment> {
  const key = env("COINPAY_API_KEY");
  const business = env("COINPAY_BUSINESS_ID");
  if (!key || !business) throw new Error("CoinPay is not configured");
  if (!isSupportedChain(chain)) throw new Error(`unsupported chain ${chain}`);

  const response = await fetch(`${apiBase()}/payments/create`, {
    method: "POST",
    // The business API key travels as a bearer token. `x-api-key` is refused
    // with "Missing authorization header", which reads like the key is absent
    // rather than in the wrong place.
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      business_id: business,
      amount: PRICE_USD,
      blockchain: chain,
      description: "The High Quality Terminal UI Cookbook (PDF)",
      // `property` names the site so a webhook (or a human reading the CoinPay
      // dashboard) can tell which fleet site a payment belongs to. The buyer is
      // anonymous today; account_id and email ride along when a caller has them.
      metadata: {
        property: PROPERTY,
        product: PRODUCT,
        reference: randomUUID(),
        ...(buyer.accountId ? { account_id: buyer.accountId } : {}),
        ...(buyer.email ? { email: buyer.email } : {}),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`CoinPay refused the payment: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { payment?: { id?: string } };
  // The id is on `payment`, not at the top level.
  const id = body.payment?.id;
  if (!id) throw new Error("CoinPay returned no payment id");

  return { id, url: `${siteBase()}/pay/${id}` };
}

/** CoinPay rejects a signature older than this, and so do we. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verifies a webhook against the business's plaintext secret.
 *
 * CoinPay sends `X-CoinPay-Signature: t=<unix>,v1=<hex>` where the hex is
 * HMAC-SHA256 of `${t}.${rawBody}` (coinpayportal src/lib/webhooks/service.ts
 * signWebhookPayload). An HMAC of the bare body never matches, which is how
 * this route used to refuse every real webhook. The timestamp is bound into
 * the MAC and checked against a 300s window so a captured delivery cannot be
 * replayed later.
 *
 * Compared in constant time, and length-checked first because
 * `timingSafeEqual` throws on a length mismatch rather than returning false.
 */
export function verifyWebhook(
  rawBody: string,
  signature: string | null,
  secret: string | undefined = env("COINPAY_WEBHOOK_SECRET"),
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !signature) return false;

  const parts: Record<string, string> = {};
  for (const part of signature.split(",")) {
    const at = part.indexOf("=");
    if (at > 0) parts[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  const t = parts.t;
  const given = parts.v1;
  if (!t || !given || !/^\d+$/.test(t)) return false;
  if (Math.abs(nowSeconds - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  if (given.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

export interface WebhookEvent {
  type: string;
  paymentId: string | null;
  status: string;
  metadata: Record<string, unknown>;
  /** True when the event says the money arrived. */
  settled: boolean;
}

/** Statuses that mean the buyer paid. `forwarded` follows `confirmed`. */
const SETTLED = new Set(["confirmed", "forwarded", "completed", "paid"]);

/**
 * Reads CoinPay's webhook body.
 *
 * The payment is nested under `data`, and the top-level `id` is the EVENT id
 * (`evt_<paymentId>_<ts>`), not the payment. Reading the flat fields first
 * would key the sale to the event id, so `data` is read first and the flat
 * shape is only a fallback for the older test sender.
 */
export function readWebhook(body: unknown): WebhookEvent {
  const payload = (body ?? {}) as Record<string, any>;
  const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, any>;
  const type = String(payload.type ?? payload.event ?? "");
  const paymentId = data.payment_id ?? payload.payment?.id ?? (payload.data ? data.id : null) ?? null;
  const status = String(data.status ?? "").toLowerCase();
  const metadata = (data.metadata ?? payload.metadata ?? {}) as Record<string, unknown>;
  const settled =
    SETTLED.has(status) || (!status && (type === "payment.confirmed" || type === "payment.forwarded"));
  return { type, paymentId: paymentId ? String(paymentId) : null, status, metadata, settled };
}

/** True when the metadata says this payment was created by this site. */
export function isOurs(metadata: Record<string, unknown>): boolean {
  return metadata.property === PROPERTY || metadata.product === PRODUCT;
}

const TOKEN_TTL_SECONDS = 48 * 60 * 60;

/**
 * A download token: the payment id and an expiry, signed. It carries no
 * secret of its own and needs no session, and it expires so a link posted
 * somewhere public stops working.
 */
export function signDownloadToken(paymentId: string, now: number = Date.now()): string {
  const secret = env("COINPAY_WEBHOOK_SECRET") ?? env("COINPAY_API_KEY") ?? "";
  const expires = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${paymentId}.${expires}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyDownloadToken(token: string, now: number = Date.now()): string | null {
  const secret = env("COINPAY_WEBHOOK_SECRET") ?? env("COINPAY_API_KEY") ?? "";
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [paymentId, expires, signature] = parts as [string, string, string];

  const expected = createHmac("sha256", secret).update(`${paymentId}.${expires}`).digest("base64url");
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"))) return null;
  if (Number(expires) * 1000 < now) return null;

  return paymentId;
}
