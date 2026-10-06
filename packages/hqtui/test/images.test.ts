import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ansi256 } from "../src/color.ts";
import {
  createImageStore, drawRichText, imageSupport, inTmux, behindMosh, kittyVirtualImage, passthrough, placeholderCell, PLACEHOLDER,
} from "../src/images.ts";
import { renderToScreen } from "../src/testing.ts";
import { detectCapabilities } from "../src/capabilities.ts";

test("hqterm is recognised: synchronized frames and iTerm2 images, even when launched from Konsole", () => {
  const env = { TERM: "xterm-256color", TERM_PROGRAM: "hqterm", KONSOLE_VERSION: "240802", HQTUI_MOSH: "0" };
  const caps = detectCapabilities({ tty: true }, env);
  assert.equal(caps.program, "hqterm");
  assert.equal(caps.synchronizedOutput, true);
  assert.equal(imageSupport(env), "iterm");
  // On a remote host the desktop app identifies itself the iTerm2 way.
  assert.equal(detectCapabilities({ tty: true }, { TERM: "xterm-256color", LC_TERMINAL: "iTerm2" }).program, "iterm");
});
import { cellText } from "../src/unicode.ts";

// These tests describe terminals, not the machine running them (which may be behind mosh).
process.env.HQTUI_MOSH = "0";

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
  // The placeholder, coloured with the image id. (Its diacritics are checked
  // above; this process's cluster table may already be full from other suites.)
  assert.ok(cellText(after.buffer.chars[3]).startsWith(PLACEHOLDER));
  assert.ok(cellText(after.buffer.chars[4]).startsWith(PLACEHOLDER));
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

test("WezTerm and iTerm2 get inline images: on request, or detected locally", () => {
  assert.equal(imageSupport({ HQTUI_IMAGES: "wezterm" }), "iterm");
  assert.equal(imageSupport({ HQTUI_IMAGES: "iterm" }), "iterm");
  assert.equal(imageSupport({ TERM_PROGRAM: "WezTerm" }), "iterm");
  assert.equal(imageSupport({ WEZTERM_PANE: "0" }), "iterm");
  assert.equal(imageSupport({ LC_TERMINAL: "iTerm2" }), "iterm");
});

test("inline mode: each image is drawn once after its frame, where it sits, and never over a popup", async () => {
  const writes: string[] = [];
  let redraws = 0;
  const images = createImageStore({
    write: (s) => writes.push(s),
    onReady: () => redraws++,
    support: "iterm",
    env: {},
    fetch: okFetch,
    cacheDir: await mkdtemp(join(tmpdir(), "hqtui-iterm-")),
  });
  let frameListener: (stats: { repainted?: boolean }) => void = () => {};
  const host = { frameBuffer: undefined as any, on: (e: string, fn: any) => { if (e === "frame") frameListener = fn; } };
  images.attach(host);

  images.emoji("🚀");
  await until(() => redraws > 0);
  assert.equal(writes.length, 0, "inline images are not uploaded ahead of time");

  const frame = (popup = false, repainted = false) => {
    const screen = renderToScreen(({ ui }: any) => ui.draw((s: any) => {
      drawRichText(s, 0, 1, "go 🚀!", {}, images);
      if (popup) s.text(3, 1, "POP");
    }), { width: 10, height: 3 });
    host.frameBuffer = screen.buffer;
    frameListener({ repainted });
  };

  frame();
  assert.equal(writes.length, 1);
  assert.match(writes[0], /^\x1b7\x1b\[2;4H\x1b\]1337;File=inline=1;size=11;width=2;height=1;preserveAspectRatio=1:[^\x07]+\x07\x1b8$/);

  frame();
  assert.equal(writes.length, 1, "same image, same place: nothing to redraw");

  frame(true);
  assert.equal(writes.length, 1, "covered by a popup: not drawn");

  frame();
  assert.equal(writes.length, 2, "uncovered again: drawn again");

  frame(false, true);
  assert.equal(writes.length, 3, "a full repaint wipes images, so they are drawn again");
});

test("inline mode under tmux: the cursor move travels inside the passthrough, offset by the pane", async () => {
  const writes: string[] = [];
  let redraws = 0;
  const images = createImageStore({
    write: (s) => writes.push(s),
    onReady: () => redraws++,
    support: "iterm",
    env: { TMUX: "/tmp/tmux-1/default,1,0" },
    paneOffset: { x: 2, y: 1 },
    fetch: okFetch,
    cacheDir: await mkdtemp(join(tmpdir(), "hqtui-tmux-")),
  });
  const listeners: Record<string, (arg: any) => void> = {};
  const host = { frameBuffer: undefined as any, on: (e: string, fn: any) => { listeners[e] = fn; } };
  images.attach(host);
  images.emoji("🚀");
  await until(() => redraws > 0);

  const frame = () => {
    const screen = renderToScreen(({ ui }: any) => ui.draw((s: any) => drawRichText(s, 0, 1, "go 🚀!", {}, images)), { width: 10, height: 3 });
    host.frameBuffer = screen.buffer;
    listeners.frame!({ repainted: false });
  };
  frame();
  assert.equal(writes.length, 1);
  // One DCS passthrough: save, move to row 1+1+1, col 3+2+1 in the outer terminal, image, restore.
  assert.match(writes[0]!, /^\x1bPtmux;\x1b\x1b7\x1b\x1b\[3;6H\x1b\x1b\]1337;File=inline=1;[^\x07]+\x07\x1b\x1b8\x1b\\$/);

  frame();
  assert.equal(writes.length, 1, "unchanged: not resent");
  listeners.focus!({ focused: true });
  frame();
  assert.equal(writes.length, 2, "back in focus (tmux may have repainted): drawn again");
});

test("tmux is recognised by TERM when TMUX was lost (su, sudo, some SSH hops)", () => {
  assert.equal(inTmux({ TMUX: "/tmp/tmux-1/default,1,0" }), true);
  assert.equal(inTmux({ TERM: "tmux-256color" }), true);
  assert.equal(inTmux({ TERM: "screen-256color" }), true);
  assert.equal(inTmux({ TERM: "screen" }), true);
  assert.equal(inTmux({ TERM: "xterm-256color" }), false);
  assert.equal(inTmux({ TERM: "screenshot" }), false);
  assert.match(passthrough("\x1b_Gx\x1b\\", { TERM: "tmux-256color" }), /^\x1bPtmux;/);
});

test("behind mosh, images are off even when asked for: mosh drops image escapes", () => {
  assert.equal(behindMosh({ HQTUI_MOSH: "1" }), true);
  assert.equal(imageSupport({ HQTUI_IMAGES: "wezterm", HQTUI_MOSH: "1" }), "none");
  assert.equal(imageSupport({ TERM: "xterm-kitty", HQTUI_MOSH: "1" }), "none");
  assert.equal(imageSupport({ HQTUI_IMAGES: "wezterm", HQTUI_MOSH: "0" }), "iterm");
});
