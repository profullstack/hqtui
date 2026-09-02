import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytes, bitRate, byteRate, percent, duration } from "../src/format.ts";
import { sh, tailFile } from "../src/system/common.ts";

test("formatters refuse to print a non-finite number", () => {
  // Every value here comes from a parser reading a file or command that may be
  // absent or truncated. `nvidia-smi` prints "[N/A]" and a partial `df` prints
  // "-", both of which become NaN, and this is the last place to stop them.
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    for (const format of [bytes, bitRate, byteRate, percent, duration]) {
      const out = format(value);
      assert.ok(!/NaN|Infinity/.test(out), `${format.name}(${value}) = ${out}`);
    }
  }
  // Finite values are untouched.
  assert.equal(bytes(1536), "1.50 KiB");
  assert.equal(percent(0.5), "50%");
  assert.equal(duration(3725), "1h 2m");
});

test("a rate is shown in the unit it belongs in", () => {
  // /sys reports Mb/s; dividing unconditionally rendered a 100 Mb/s NIC as
  // "0.1 Gb/s".
  assert.equal(bitRate((100 * 1e6) / 8), "100.0 Mb/s");
  assert.equal(bitRate((1000 * 1e6) / 8), "1.0 Gb/s");
  assert.equal(bitRate((2500 * 1e6) / 8), "2.5 Gb/s");
});

test("tailFile reads only the tail, whatever the file's size", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hqtui-tail-"));
  try {
    const line = "Sep  2 10:00:00 host sshd[1]: Failed password for root from 10.0.0.9\n";
    await writeFile(join(dir, "big.log"), line.repeat(200_000));
    const tail = await tailFile(join(dir, "big.log"), 64 * 1024);
    assert.ok(tail.length <= 64 * 1024, `read ${tail.length} bytes`);
    assert.ok(tail.endsWith(line), "the tail is not the end of the file");

    // A file shorter than the window is returned whole, with no NUL padding —
    // the buffer is sized from a stat that the file may have outrun.
    await writeFile(join(dir, "small.log"), "aaaa\n");
    const small = await tailFile(join(dir, "small.log"), 64 * 1024);
    assert.equal(small, "aaaa\n");
    assert.equal(small.includes(String.fromCharCode(0)), false);

    assert.equal(await tailFile(join(dir, "absent.log")), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sh keeps what a failing command still produced", { skip: process.platform === "win32" }, async () => {
  // `df` exits 1 when any single mount is unreadable while still reporting
  // every other one. Discarding stdout zeroed the capacity of every disk on
  // the machine whenever one stale automount was listed.
  const partial = await sh("df", ["-kP", ".", "/nonexistent-mount-hqtui"]);
  assert.ok(partial.trim().split("\n").length >= 2, "usable df output was discarded");
  // A command that produces nothing at all still yields "".
  assert.equal(await sh("hqtui-command-that-does-not-exist", []), "");
});
