import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { breakdown } from "../src/system/linux-traffic.ts";

test("native Traffic fixture matches the TypeScript port-based reference", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../../ports/conformance/fixtures/demo-traffic.json", import.meta.url), "utf8"));
  const result = breakdown(fixture.connections.filter((c: { state: string }) => c.state !== "LISTEN"), fixture.listeners);
  assert.equal(result.inbound, 1);
  assert.equal(result.outbound, 2);
  assert.deepEqual(Object.fromEntries(result.protocols.map(p => [p.protocol,p.total])), {SSH: 1, HTTPS: 1, DNS: 1});
});
