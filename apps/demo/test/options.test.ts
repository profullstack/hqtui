import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalMs } from "../src/options.ts";

test("the refresh interval is one setInterval will honour", () => {
  // Node resets any delay outside [1, 2^31-1], and NaN and Infinity, to ONE
  // millisecond. Clamping only the floor left the top wide open: `1e12` asks
  // for a refresh every thirty-one years and got a 1ms loop forking ps, ss and
  // journalctl, and `Infinity` additionally made every derived rate NaN.
  const MAX_TIMEOUT = 2 ** 31 - 1;
  for (const input of ["1e12", "Infinity", "-Infinity", "NaN", "abc", "-500", "0", "", undefined]) {
    const ms = intervalMs(input);
    assert.ok(Number.isFinite(ms), `${input} -> ${ms}`);
    assert.ok(ms >= 100 && ms <= MAX_TIMEOUT, `${input} -> ${ms} is outside what setInterval honours`);
  }
  // Reasonable values pass through untouched.
  assert.equal(intervalMs("1000"), 1000);
  assert.equal(intervalMs("250"), 250);
  assert.equal(intervalMs("60000"), 60000);
  // And the clamps are where they say they are.
  assert.equal(intervalMs("1"), 100);
  assert.equal(intervalMs("99999999"), 3_600_000);
});
