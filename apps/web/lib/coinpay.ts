import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Selling the cookbook PDF for a dollar through a CoinPay hosted checkout
 * session: any coin the business holds a wallet for, or PayPal. No card. The HTML and the EPUB are free, so nobody is
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
  return Boolean(env("COINPAY_API_KEY"));
}

export const PRICE_USD = 1;
export const PROPERTY = "hqtui.com";
export const PRODUCT = "hqtui-cookbook-pdf";

/** Sessions last this long; an unpaid one simply expires. */
export const SESSION_WINDOW_MINUTES = 60;

/** The site's public origin, for return URLs. Never taken from the request. */
export function siteOrigin(): string {
  return (env("SITE_URL") ?? env("NEXT_PUBLIC_SITE_URL") ?? `https://${PROPERTY}`).replace(/\/+$/, "");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A trimmed, lower-cased email, or null when it is not one. */
export function normalizeEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email && email.length <= 254 && EMAIL.test(email) ? email : null;
}

export interface CheckoutSession {
  /** cs_..., also our purchase key (book_purchases.payment_id). */
  id: string;
  /** CoinPay's hosted checkout page. */
  url: string;
}

/**
 * The body POSTed to /api/checkout/sessions. The buyer has no account here, so
 * the account is the buyer's email (CoinPay requires both fields).
 */
export function sessionBody(email: string, reference: string): Record<string, unknown> {
  const origin = siteOrigin();
  return {
    amount: PRICE_USD,
    currency: "USD",
    description: "The High Quality Terminal UI Cookbook (PDF)",
    customer_email: email,
    account_id: email,
    property: PROPERTY,
    metadata: { property: PROPERTY, product: PRODUCT, reference, email, account_id: email },
    success_url: `${origin}/book/thanks?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/book/buy?cancelled=1`,
    expires_in_minutes: SESSION_WINDOW_MINUTES,
  };
}

/**
 * Opens a CoinPay hosted checkout session. The buyer picks any coin the
 * business holds a wallet for, or PayPal, on CoinPay's page, so there is no
 * chain list to keep in step with the business's wallets here.
 */
export async function createCheckoutSession(
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutSession> {
  const key = env("COINPAY_API_KEY");
  if (!key) throw new Error("CoinPay is not configured");
  const buyer = normalizeEmail(email);
  if (!buyer) throw new Error("a valid email is required");

  const response = await fetchImpl(`${apiBase()}/checkout/sessions`, {
    method: "POST",
    // The business API key travels as a bearer token; x-api-key is refused.
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(sessionBody(buyer, randomUUID())),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`CoinPay refused the checkout session: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { id?: string; url?: string };
  if (!body.id || !body.url) throw new Error("CoinPay returned no checkout session");
  // Only ever send buyers to CoinPay's own origin.
  const origin = new URL(siteBase()).origin;
  const url = new URL(body.url, origin);
  if (url.origin !== origin) throw new Error("CoinPay returned an off-site checkout url");
  return { id: body.id, url: url.toString() };
}

/**
 * Asks CoinPay whether a session was paid, for the thanks page when the buyer
 * comes back before the webhook. Authenticated with the business key, so the
 * answer can be trusted. Null on any failure.
 */
export async function sessionPaid(
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  const key = env("COINPAY_API_KEY");
  if (!key || !/^cs_[A-Za-z0-9]{8,64}$/.test(sessionId)) return null;
  try {
    const response = await fetchImpl(`${apiBase()}/checkout/sessions/${sessionId}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { session?: { status?: string; property?: string }; status?: string };
    const session = body.session ?? body;
    if ((session as { property?: string }).property && (session as { property?: string }).property !== PROPERTY) {
      return false;
    }
    return ["paid", "complete", "completed", "confirmed"].includes(String(session.status ?? "").toLowerCase());
  } catch {
    return null;
  }
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
  /** cs_... when the payment came through a hosted checkout session. */
  sessionId: string | null;
  /** The site CoinPay says the session belongs to. */
  property: string | null;
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
  const session = data.checkout_session_id ?? payload.checkout_session_id ?? metadata.checkout_session_id ?? null;
  const settled =
    SETTLED.has(status) || (!status && (type === "payment.confirmed" || type === "payment.forwarded"));
  return {
    type,
    paymentId: paymentId ? String(paymentId) : null,
    sessionId: session ? String(session) : null,
    property: data.property ? String(data.property) : null,
    status,
    metadata,
    settled,
  };
}

/** True when the metadata says this payment was created by this site. */
export function isOurs(metadata: Record<string, unknown>, property?: unknown): boolean {
  return property === PROPERTY || metadata.property === PROPERTY || metadata.product === PRODUCT;
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
