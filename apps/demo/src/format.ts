/**
 * Every value here arrives from a parser reading a file or a command that may
 * be absent, truncated or in an unexpected shape, so this is the last place a
 * non-finite number can be stopped before it reaches the screen. `nvidia-smi`
 * prints "[N/A]", a partial `df` yields "-", and both become NaN.
 */
const UNAVAILABLE = "\u2014";

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Presentation helpers. Numbers in a dashboard must never jitter in width. */

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

export function bytes(value: number, digits = 2): string {
  if (finite(value) === null) return UNAVAILABLE;
  let v = Math.max(0, value);
  let unit = 0;
  while (v >= 1024 && unit < UNITS.length - 1) {
    v /= 1024;
    unit++;
  }
  return `${v.toFixed(unit === 0 ? 0 : digits)} ${UNITS[unit]}`;
}

export function bitRate(bytesPerSecond: number): string {
  if (finite(bytesPerSecond) === null) return UNAVAILABLE;
  const bits = Math.max(0, bytesPerSecond) * 8;
  if (bits >= 1e9) return `${(bits / 1e9).toFixed(1)} Gb/s`;
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mb/s`;
  if (bits >= 1e3) return `${(bits / 1e3).toFixed(1)} Kb/s`;
  return `${bits.toFixed(0)} b/s`;
}

export function byteRate(bytesPerSecond: number): string {
  if (finite(bytesPerSecond) === null) return UNAVAILABLE;
  const v = Math.max(0, bytesPerSecond);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB/s`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB/s`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} KB/s`;
  return `${v.toFixed(0)} B/s`;
}

export function percent(ratio: number, digits = 0): string {
  if (finite(ratio) === null) return UNAVAILABLE;
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(digits)}%`;
}

export function duration(seconds: number): string {
  if (finite(seconds) === null) return UNAVAILABLE;
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function clock(date = new Date()): string {
  return date.toTimeString().slice(0, 8);
}

/** Fixed-width numbers so columns never shift between frames. */
export function num(value: number, digits = 1): string {
  return value.toFixed(digits);
}
