import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToScreen } from "../src/index.ts";
import { dimRect, drawShadow } from "../src/widgets/shadow.ts";
import { rgb } from "../src/color.ts";

/** A screen filled with text, then a shadow cast over part of it. */
const shaded = (
  rect: { x: number; y: number; width: number; height: number },
  options: Parameters<typeof drawShadow>[2] = {},
  width = 12,
  height = 6,
) =>
  renderToScreen(({ ui }) => {
    ui.fill({ symbol: "x" });
    ui.ctx.overlay((root) => drawShadow(root, rect, options));
  }, { width, height });

test("shadow: it dims what it covers rather than painting over it", () => {
  const screen = shaded({ x: 1, y: 1, width: 4, height: 2 });
  // Every character survives; a shadow that blanked its band would erase the
  // dashboard underneath, which is the opposite of what a shadow is for.
  assert.equal(screen.text().replace(/\n/g, ""), "x".repeat(12 * 6));
  // And some cells are darker than the rest.
  const colours = new Set(screen.buffer.fg);
  assert.equal(colours.size, 2, `expected two shades, got ${colours.size}`);
});

test("shadow: it falls outside the region, never on it", () => {
  const plain = renderToScreen(({ ui }) => ui.fill({ symbol: "x" }), { width: 12, height: 6 });
  const screen = shaded({ x: 1, y: 1, width: 4, height: 2 });
  const changed: [number, number][] = [];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 12; x++) {
      const i = y * 12 + x;
      if (screen.buffer.fg[i] !== plain.buffer.fg[i]) changed.push([x, y]);
    }
  }
  assert.ok(changed.length > 0, "nothing was shaded");
  for (const [x, y] of changed) {
    const inside = x >= 1 && x < 5 && y >= 1 && y < 3;
    assert.ok(!inside, `shaded (${x}, ${y}), which is inside the region`);
  }
});

test("shadow: the corner is dimmed once, not twice", () => {
  // The two bands meet there. Dimming it twice makes it visibly darker than the
  // rest of the shadow, which reads as a smudge rather than an edge.
  const screen = shaded({ x: 1, y: 1, width: 4, height: 2 }, { offsetX: 2, offsetY: 2 });
  const shades = new Set(screen.buffer.fg);
  assert.equal(shades.size, 2, `expected one shade of shadow, got ${shades.size - 1}`);
});

test("shadow: a zero offset casts nothing", () => {
  const plain = renderToScreen(({ ui }) => ui.fill({ symbol: "x" }), { width: 12, height: 6 });
  const none = shaded({ x: 1, y: 1, width: 4, height: 2 }, { offsetX: 0, offsetY: 0 });
  assert.deepEqual([...none.buffer.fg], [...plain.buffer.fg]);
});

test("shadow: a colour paints instead of dimming", () => {
  // For a shadow falling on empty background, where there is nothing to dim.
  const screen = shaded({ x: 1, y: 1, width: 4, height: 2 }, { color: rgb(0x12, 0x34, 0x56) });
  assert.ok([...screen.buffer.bg].includes(rgb(0x12, 0x34, 0x56)), "the colour was never painted");
});

test("shadow: it can fall up and to the left", () => {
  const down = shaded({ x: 4, y: 2, width: 4, height: 2 }, { offsetX: 1, offsetY: 1 });
  const up = shaded({ x: 4, y: 2, width: 4, height: 2 }, { offsetX: -1, offsetY: -1 });
  assert.notDeepEqual([...down.buffer.fg], [...up.buffer.fg]);
  // Up-left shades the row above the region; down-right does not.
  const dimmed = (s: typeof down, x: number, y: number) =>
    s.buffer.fg[y * 12 + x] !== down.buffer.fg[0 * 12 + 0];
  assert.ok(dimmed(up, 3, 1), "the up-left shadow missed the corner above");
});

test("shadow: dimming darkens rather than washing out", () => {
  // Towards black, not towards the theme background: on a light theme the
  // background is the light, and dimming towards it would make the shadow
  // brighter than the page it falls on.
  const screen = renderToScreen(({ ui }) => {
    ui.fill({ symbol: "x", fg: rgb(255, 255, 255), bg: rgb(255, 255, 255) });
    ui.ctx.overlay((root) => dimRect(root, 0, 0, 4, 1, 0.5));
  }, { width: 8, height: 1 });
  const dimmedCell = screen.buffer.fg[0];
  const plainCell = screen.buffer.fg[5];
  assert.equal(plainCell, rgb(255, 255, 255));
  assert.ok(dimmedCell < plainCell, `expected darker, got ${dimmedCell.toString(16)}`);
});

test("shadow: it stops at the edge of the surface", () => {
  // A region flush against the bottom-right corner has nowhere to cast.
  const screen = shaded({ x: 8, y: 4, width: 4, height: 2 });
  assert.equal(screen.text().replace(/\n/g, ""), "x".repeat(12 * 6));
});
