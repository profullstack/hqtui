/**
 * Option parsing that is worth testing on its own, kept out of main.ts because
 * importing that module starts the dashboard.
 */

/**
 * A refresh interval `setInterval` will honour.
 *
 * Node resets any delay outside [1, 2^31-1] — and NaN, and Infinity — to *one
 * millisecond*, so clamping only the floor leaves the failure wide open at the
 * top. `--interval 1e12` asks for one refresh every thirty-one years and gets a
 * one-millisecond loop forking ps, ss and journalctl. `--interval Infinity`
 * additionally makes the elapsed time infinite and every rate derived from it
 * NaN.
 */
export function intervalMs(value: string | undefined): number {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 1000;
  return Math.min(3_600_000, Math.max(100, Math.round(requested)));
}
