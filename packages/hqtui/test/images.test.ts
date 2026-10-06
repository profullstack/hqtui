import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ansi256 } from "../src/color.ts";
import {
  createImageStore, drawRichText, imageSupport, kittyVirtualImage, passthrough, placeholderCell, PLACEHOLDER,
} from "../src/images.ts";
import { renderToScreen } from "../src/testing.ts";
import { cellText } from "../src/unicode.ts";

// The 8-byte PNG signature is all the store checks.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const okFetch = (async () => new Response(PNG)) as unknown as typeof fetch;
/** Wait until `done()` holds (the load is real async I/O), up to two seconds. */
async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 10));
}

test("images turn on in Kitty and Ghostty, on request, and never by surprise", () => {
  assert.equal(imageSupport({ TERM: "xterm-kitty" }), "kitty");
  assert.equal(imageSupport({ TERM_PROGRAM: "ghostty" }), "kitty");
  assert.equal(imageSupport({ TMUX: "/tmp/tmux", HQTUI_IMAGES: "1" }), "kitty");
  assert.equal(imageSupport({ TERM: "xterm-kitty", HQTUI_IMAGES: "0" }), "none");
  assert.equal(imageSupport({ TERM: "xterm-256color" }), "none");
});

test("uploads are wrapped for tmux passthrough, ESC doubled", () => {
  assert.equal(passthrough("\x1b_Gx\x1b\\", {}), "\x1b_Gx\x1b\\");
  assert.equal(passthrough("\x1b_Gx\x1b\\", { TMUX: "1" }), "\x1bPtmux;\x1b\x1b_Gx\x1b\x1b\\\x1b\\");
});

test("an upload is a virtual (U=1) placement under its id, chunked", () => {
  const seq = kittyVirtualImage(7, Buffer.alloc(5000, 1), 2, 1, {});
  assert.match(seq, /^\x1b_Ga=T,U=1,f=100,i=7,c=2,r=1,q=2,m=1;/);
  assert.match(seq, /\x1b_Gm=0;[^\x1b]*\x1b\\$/);
});

test("placeholder cells carry the row and column diacritics", () => {
  assert.equal(placeholderCell(0, 0), `${PLACEHOLDER}̅̅`);
  assert.equal(placeholderCell(0, 1), `${PLACEHOLDER}̅̍`);
});

test("emoji draw as text until their artwork loads, then as image cells with the id as colour", async () => {
  const writes: string[] = [];
  let redraws = 0;
  const images = createImageStore({
    write: (s) => writes.push(s),
    onReady: () => redraws++,
    support: "kitty",
    env: {},
    fetch: okFetch,
    cacheDir: await mkdtemp(join(tmpdir(), "hqtui-images-")),
  });
  const view = ({ ui }: { ui: any }) => ui.draw((s: any) => drawRichText(s, 0, 0, "go 🚀!", {}, images));

  const before = renderToScreen(view, { width: 10, height: 1 });
  assert.equal(cellText(before.buffer.chars[3]), "🚀", "the character first");

  await until(() => redraws > 0);
  assert.equal(redraws, 1);
  assert.equal(writes.length, 1);
  assert.match(writes[0], /a=T,U=1,f=100,i=1,c=2,r=1/);

  const after = renderToScreen(view, { width: 10, height: 1 });
  assert.equal(cellText(after.buffer.chars[3]), placeholderCell(0, 0));
  assert.equal(cellText(after.buffer.chars[4]), placeholderCell(0, 1));
  assert.equal(after.buffer.fg[3], ansi256(1));
  assert.equal(cellText(after.buffer.chars[5]), "!", "text after the image keeps its column");
  assert.equal(writes.length, 1, "each image is uploaded once");
});

test("a store that is off draws plain text and fetches nothing", () => {
  let fetched = 0;
  const images = createImageStore({
    write: () => {},
    support: "none",
    fetch: (async () => {
      fetched++;
      return new Response(PNG);
    }) as unknown as typeof fetch,
  });
  const screen = renderToScreen(({ ui }) => ui.draw((s) => drawRichText(s, 0, 0, "🚀", {}, images)), { width: 4, height: 1 });
  assert.equal(cellText(screen.buffer.chars[0]), "🚀");
  assert.equal(fetched, 0);
});
