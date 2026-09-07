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
export async function createPayment(chain: string = DEFAULT_CHAIN): Promise<CreatedPayment> {
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
      metadata: { product: "hqtui-cookbook-pdf", reference: randomUUID() },
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

/**
 * Verifies a webhook against the business's plaintext secret.
 *
 * Compared in constant time, and length-checked first because
 * `timingSafeEqual` throws on a length mismatch rather than returning false.
 */
export function verifyWebhook(rawBody: string, signature: string | null): boolean {
  const secret = env("COINPAY_WEBHOOK_SECRET");
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = signature.replace(/^sha256=/, "").trim();
  if (given.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
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
