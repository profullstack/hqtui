/**
 * A sliding window, in memory.
 *
 * The site runs as a single Railway container (see railway.json), so process
 * memory is the whole picture. Scaled out this becomes per-instance and the
 * limit multiplies by the instance count, at which point the counter belongs
 * in Turso alongside the votes.
 */
const WINDOW_MS = 60_000;
/**
 * Distinct clients tracked before the least useful entry is dropped.
 *
 * This is the limiter's honest ceiling: a window carrying more distinct
 * addresses than this cannot be fully accounted for in a fixed-size table, and
 * the limit degrades toward one allowance per eviction cycle. Sustaining that
 * means tens of thousands of distinct addresses per minute, at which point
 * per-address counting on a single container is the wrong layer and the count
 * belongs in Turso or at the edge.
 *
 * Keys are capped in length, so the table's memory is bounded in bytes as well
 * as in entries: roughly 50k x (64-char key + up to 10 timestamps).
 */
const MAX_TRACKED = 50_000;
/** An IPv6 address is 45 characters; anything longer is not an address. */
const MAX_KEY_LENGTH = 64;

/**
 * Insertion order is the eviction order, and re-inserting on every touch makes
 * that least-recently-used. Evicting the *first inserted* instead would let a
 * flood of new keys hand an established client a fresh quota on a fixed
 * schedule — the flood being exactly what this exists to stop.
 */
const hits = new Map<string, number[]>();

/**
 * The client's address as far as it can be known behind Railway's proxy.
 *
 * The **last** entry of `x-forwarded-for` is the one the nearest proxy
 * observed; a proxy appends what it saw, so every entry to its left is text
 * the caller supplied and can rotate at will. Reading the left-most entry —
 * the common mistake — makes any limit keyed on it a no-op.
 *
 * This assumes exactly one proxy in front of the app, which is what Railway
 * provides. Behind two, the second-from-right would be the client.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const hops = forwarded?.split(",").map((hop) => hop.trim()).filter(Boolean) ?? [];
  const nearest = hops[hops.length - 1] || request.headers.get("x-real-ip")?.trim();
  return (nearest || "unknown").slice(0, MAX_KEY_LENGTH);
}

/**
 * Drop one entry to make room, preferring a client that has barely been seen.
 *
 * Plain least-recently-used is not enough: a flood of more distinct addresses
 * than the table holds evicts everyone, including the client being limited,
 * which hands it a fresh quota. Only clients approaching their limit are worth
 * remembering — a one-request tourist gets the same answer either way — so the
 * search walks a bounded number of the least-recent entries looking for one
 * with a single hit, and settles for the least-recent if it finds none.
 */
function evictOne(): void {
  const CANDIDATES = 64;
  let fallback: string | undefined;
  let inspected = 0;
  for (const [key, times] of hits) {
    if (fallback === undefined) fallback = key;
    if (times.length <= 1) {
      hits.delete(key);
      return;
    }
    if (++inspected >= CANDIDATES) break;
  }
  if (fallback !== undefined) hits.delete(fallback);
}

/** True when this client has already used its allowance for the window. */
export function rateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);

  // Re-insert on every touch so map order is least-recently-used, and evict one
  // entry rather than sweeping: the sweep cost grew with the map on every miss,
  // which is the request pattern a flood produces.
  hits.delete(key);
  if (hits.size >= MAX_TRACKED) evictOne();

  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

/** Test seam: the window is real time, so tests need a way back to empty. */
export function resetRateLimits(): void {
  hits.clear();
}
