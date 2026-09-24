import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  emoji, emojify, emojiInfo, emojiMode, emojiNames, emojiSearch, emojiText, emojiWidth, setEmojiMode,
} from "../src/emoji.ts";
import { artProtocol, artSize, emojiImage, itermImage, kittyImage, queryCellSize } from "../src/emoji-art.ts";
import { FONTCONFIG, emojiFontStatus, installEmojiFont, removeEmojiFont, terminalSnippets } from "../src/fonts.ts";
import { stringWidth } from "../src/unicode.ts";
import { renderToText } from "../src/testing.ts";

test("the OpenEmoji pack is built in and on by default", () => {
  assert.ok(emojiNames().length >= 3900, "every fully-qualified emoji");
  assert.equal(emoji("fire", { mode: "emoji" }), "🔥");
  assert.equal(emojiInfo("fire")?.shortcode, "oe_fire");
});

test("a name can be the shortcode, the CLDR name, an alias or the emoji itself", () => {
  for (const name of ["fire", "oe_fire", ":oe_fire:", ":fire:", "FIRE", "🔥"]) {
    assert.equal(emoji(name, { mode: "emoji" }), "🔥", name);
  }
  assert.equal(emoji("face with tears of joy", { mode: "emoji" }), "😂");
  assert.equal(emoji("thumbsup", { mode: "emoji" }), "👍");
  assert.equal(emoji("+1", { mode: "emoji" }), "👍");
  assert.equal(emoji("heart", { mode: "emoji" }), "❤️");
  assert.equal(emoji("❤", { mode: "emoji" }), "❤️", "typed without FE0F");
  assert.equal(emoji("no such emoji"), "");
});

test("skin tones are named after their base, with t1 to t5", () => {
  const toned = emojiInfo("thumbs_up_t3");
  assert.equal(toned?.char, "👍🏽");
  assert.equal(toned?.name, "thumbs up: medium skin tone");
  assert.equal(toned?.base, "1f44d");
  assert.equal(emojiInfo("👩🏾‍💻")?.shortcode, "oe_woman_technologist_t4");
});

test("text mode is an emoticon where one fits and the name in brackets elsewhere", () => {
  assert.equal(emoji("slightly smiling face", { mode: "text" }), ":)");
  assert.equal(emoji("heart", { mode: "text" }), "<3");
  assert.equal(emoji("thumbs_up_t3", { mode: "text" }), "+1", "a tone uses its base's emoticon");
  assert.equal(emoji("fire", { mode: "text" }), "[fire]");
  assert.equal(emojiText("rocket"), "[rocket]");
});

test("the mode comes from the app, then HQTUI_EMOJI, then the terminal", () => {
  assert.equal(emojiMode({ HQTUI_EMOJI: "text", LANG: "en_US.UTF-8" }), "text");
  assert.equal(emojiMode({ HQTUI_EMOJI: "emoji", TERM: "dumb" }), "emoji");
  assert.equal(emojiMode({ LANG: "en_US.UTF-8", TERM: "xterm-256color" }), "emoji");
  assert.equal(emojiMode({ LANG: "en_US.UTF-8", TERM: "linux" }), "text", "the Linux console has no emoji font");
  assert.equal(emojiMode({ TERM: "dumb" }), "text");
  setEmojiMode("text");
  try {
    assert.equal(emojiMode({ HQTUI_EMOJI: "emoji" }), "text");
    assert.equal(emoji("fire"), "[fire]");
  } finally {
    setEmojiMode(undefined);
  }
});

test("emojify replaces :names: and leaves everything else alone", () => {
  assert.equal(emojify("ship :rocket: :+1: :oe_fire:", { mode: "emoji" }), "ship 🚀 👍 🔥");
  assert.equal(emojify("at 12:30:00, :nope: stays", { mode: "emoji" }), "at 12:30:00, :nope: stays");
  assert.equal(emojify("tone :thumbs_up_t5:", { mode: "emoji" }), "tone 👍🏿");
  assert.equal(emojify("love :heart:", { mode: "text" }), "love <3");
});

test("search finds by name and keyword, exact first", () => {
  assert.equal(emojiSearch("fire")[0]?.char, "🔥");
  assert.ok(emojiSearch("lol").some((e) => e.char === "😂"), "CLDR keyword");
  assert.ok(emojiSearch("japan").some((e) => e.char === "🇯🇵"));
  assert.ok(emojiSearch("thumbs").every((e) => !e.base), "tone variants are not listed separately");
  assert.deepEqual(emojiSearch(""), []);
});

test("emoji keep tables aligned: every one is two columns", () => {
  for (const name of ["fire", "thumbs_up_t3", "flag_japan", "keycap_hash", "heart", "woman_technologist_t4", "family_man_woman_girl_boy"]) {
    const char = emoji(name, { mode: "emoji" });
    assert.ok(char, name);
    assert.equal(emojiWidth(char), 2, name);
    assert.equal(stringWidth(`${char}|`), 3, name);
  }
  // A row of emoji followed by a border: if any emoji were measured narrower
  // than it draws, the border would land in a different column on each row.
  const rows = ["fire", "thumbs_up_t3", "flag_japan", "heart", "keycap_hash"].map((name) => {
    const text = renderToText(({ ui }) => { ui.text(`${emoji(name, { mode: "emoji" })}ab|`); }, { width: 10, height: 1 });
    return text.split("\n")[0]!;
  });
  for (const row of rows) assert.equal(stringWidth(row.slice(0, row.indexOf("|"))), 4, row);
});

// --------------------------------------------------------------- art mode

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("art is off unless asked for, and picks the terminal's protocol", () => {
  assert.equal(artProtocol({ TERM: "xterm-kitty" }), "none", "off by default");
  assert.equal(artProtocol({ TERM: "xterm-kitty", HQTUI_EMOJI_ART: "1" }), "kitty");
  assert.equal(artProtocol({ GHOSTTY_RESOURCES_DIR: "/x", HQTUI_EMOJI_ART: "1" }), "kitty");
  assert.equal(artProtocol({ TERM_PROGRAM: "iTerm.app", HQTUI_EMOJI_ART: "1" }), "iterm");
  assert.equal(artProtocol({ TERM_PROGRAM: "WezTerm", HQTUI_EMOJI_ART: "1" }), "iterm");
  assert.equal(artProtocol({ TERM: "xterm-256color", HQTUI_EMOJI_ART: "1" }), "none");
  assert.equal(artProtocol({ TERM: "xterm-kitty", TMUX: "/tmp/tmux", HQTUI_EMOJI_ART: "1" }), "none", "tmux");
  assert.equal(artProtocol({ HQTUI_EMOJI_ART: "iterm" }), "iterm", "forced");
  assert.equal(artProtocol({ TERM: "xterm-kitty" }, true), "kitty", "the API flag");
});

test("hi-res: the PNG is at least twice the cell height, 128 when unknown", () => {
  assert.equal(artSize(undefined), 128);
  assert.equal(artSize({ width: 8, height: 16 }), 128);
  assert.equal(artSize({ width: 10, height: 20 }), 128);
  assert.equal(artSize({ width: 16, height: 33 }), 128, "66 px needs 128");
  assert.equal(artSize({ width: 30, height: 70 }), 256, "a Retina cell");
  assert.equal(artSize({ width: 60, height: 140 }), 512);
  assert.equal(artSize({ width: 200, height: 400 }), 512, "never beyond the set's largest");
});

test("the terminal's cell size is read from its CSI 16 t answer", async () => {
  const { EventEmitter } = await import("node:events");
  const input = new EventEmitter() as unknown as NodeJS.ReadableStream;
  let asked = "";
  const output = { write: (s: string) => ((asked += s), true) } as unknown as NodeJS.WritableStream;
  const pending = queryCellSize(input, output);
  (input as unknown as { emit: (e: string, d: string) => void }).emit("data", "\x1b[6;36;17t");
  assert.deepEqual(await pending, { width: 17, height: 36 });
  assert.equal(asked, "\x1b[16t");
  const silent = queryCellSize(new EventEmitter() as unknown as NodeJS.ReadableStream, output, 10);
  assert.equal(await silent, undefined);
});

test("kitty and iTerm2 sequences carry the PNG two cells wide", () => {
  const kitty = kittyImage(PNG, 2);
  assert.ok(kitty.startsWith("\x1b_Gf=100,a=T,c=2,r=1,q=2,m=0;"));
  assert.ok(kitty.endsWith("\x1b\\"));
  const big = kittyImage(Buffer.alloc(10000, 1), 2);
  assert.ok(big.split("\x1b_G").length - 1 > 1, "chunked at 4096 bytes");
  assert.match(itermImage(PNG, 2), /^\x1b\]1337;File=inline=1;size=\d+;width=2;height=1;preserveAspectRatio=1:.+\x07$/);
});

test("emojiImage fetches the right size once, caches it, and falls back to the character", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "oe-art-"));
  const urls: string[] = [];
  const fakeFetch = (async (url: string) => {
    urls.push(url);
    return new Response(PNG);
  }) as typeof fetch;
  const first = await emojiImage("fire", { protocol: "kitty", cell: { width: 30, height: 70 }, fetch: fakeFetch, cacheDir });
  assert.ok(first.startsWith("\x1b_G"));
  assert.equal(urls[0], "https://raw.githubusercontent.com/profullstack/openemoji/main/png/256/1f525.png");
  await emojiImage("fire", { protocol: "kitty", cell: { width: 30, height: 70 }, fetch: fakeFetch, cacheDir });
  assert.equal(urls.length, 1, "second draw comes from the cache");
  assert.deepEqual(await readdir(join(cacheDir, "256")), ["1f525.png"]);

  const notFound = (async () => new Response("<html>404</html>", { status: 404 })) as typeof fetch;
  assert.equal(await emojiImage("rocket", { protocol: "iterm", fetch: notFound, cacheDir, env: { HQTUI_EMOJI: "emoji" } }), "🚀");
  const html = (async () => new Response("<html>not a png</html>")) as typeof fetch;
  assert.equal(await emojiImage("rocket", { protocol: "kitty", fetch: html, cacheDir, env: {} }), emoji("rocket"));
  assert.equal(await emojiImage("fire", { env: { TERM: "xterm-kitty" } }), emoji("fire"), "art off: the character");
  assert.equal(await emojiImage("no such emoji", { protocol: "kitty" }), "");
});

// ------------------------------------------------------------------ fonts

const TTF = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(64, 7)]);

async function sandbox() {
  const home = await mkdtemp(join(tmpdir(), "oe-font-"));
  const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share") };
  const commands: string[] = [];
  const run = (command: string, args: string[]) => {
    commands.push(`${command} ${args.join(" ")}`);
    return { status: 0, stdout: command === "fc-match" ? "OpenEmoji" : "" };
  };
  return { home, env, commands, run, log: () => {} };
}

test("fonts install falls back from the release to the repository and wires fontconfig", async () => {
  const s = await sandbox();
  const urls: string[] = [];
  const fakeFetch = (async (url: string) => {
    urls.push(url);
    return url.includes("/releases/") ? new Response("Not Found", { status: 404 }) : new Response(TTF);
  }) as typeof fetch;
  const result = await installEmojiFont({ ...s, platform: "linux", fetch: fakeFetch });
  assert.deepEqual(urls, [
    "https://github.com/profullstack/openemoji/releases/latest/download/OpenEmoji-CBDT.ttf",
    "https://raw.githubusercontent.com/profullstack/openemoji/main/font/OpenEmoji-CBDT.ttf",
  ]);
  assert.deepEqual(await readFile(join(s.home, ".local/share/fonts/OpenEmoji-CBDT.ttf")), TTF);
  const conf = await readFile(join(s.home, ".config/fontconfig/conf.d/60-openemoji.conf"), "utf8");
  assert.equal(conf, FONTCONFIG);
  assert.match(conf, /<family>emoji<\/family>\s*<prefer><family>OpenEmoji/);
  assert.match(conf, /mode="append"/, "appended to text families, so digits stay text");
  assert.doesNotMatch(conf, /mode="prepend"/);
  assert.ok(s.commands.some((c) => c.startsWith("fc-cache -f")));
  assert.ok(result.snippets.some((x) => x.terminal === "Kitty" && x.snippet.startsWith("symbol_map U+1F300")));
  assert.deepEqual(await emojiFontStatus({ ...s, platform: "linux" }), {
    installed: true,
    files: [join(s.home, ".local/share/fonts/OpenEmoji-CBDT.ttf")],
    fontconfig: true,
    emojiFont: "OpenEmoji",
    active: true,
  });
});

test("a missing font is a clear error, not a broken file", async () => {
  const s = await sandbox();
  const nothing = (async () => new Response("Not Found", { status: 404 })) as typeof fetch;
  await assert.rejects(installEmojiFont({ ...s, platform: "linux", fetch: nothing }), /not published yet/);
  const html = (async () => new Response("<html>")) as typeof fetch;
  await assert.rejects(installEmojiFont({ ...s, platform: "linux", fetch: html }), /not published yet/);
});

test("fonts remove undoes install and restores a fontconfig file it replaced", async () => {
  const s = await sandbox();
  const conf = join(s.home, ".config/fontconfig/conf.d/60-openemoji.conf");
  await mkdir(join(s.home, ".config/fontconfig/conf.d"), { recursive: true });
  await writeFile(conf, "<fontconfig><!-- mine --></fontconfig>\n");
  const fakeFetch = (async () => new Response(TTF)) as typeof fetch;
  await installEmojiFont({ ...s, platform: "linux", fetch: fakeFetch });
  const backups = await readdir(join(s.home, ".config/hqtui/backups"));
  assert.deepEqual(backups, ["60-openemoji.bak-001.conf"], "house backup name, outside conf.d");
  const done = await removeEmojiFont({ ...s, platform: "linux" });
  assert.ok(done.some((l) => l.startsWith("restored")));
  assert.equal(await readFile(conf, "utf8"), "<fontconfig><!-- mine --></fontconfig>\n");
  await assert.rejects(readFile(join(s.home, ".local/share/fonts/OpenEmoji-CBDT.ttf")));
  assert.deepEqual(await removeEmojiFont({ ...s, platform: "linux" }), [], "nothing left to remove");
});

test("macOS gets the sbix font, no fontconfig, and the Terminal.app caveat", async () => {
  const s = await sandbox();
  const urls: string[] = [];
  const fakeFetch = (async (url: string) => (urls.push(url), new Response(TTF))) as typeof fetch;
  const result = await installEmojiFont({ ...s, platform: "darwin", fetch: fakeFetch });
  assert.ok(urls[0]!.endsWith("/OpenEmoji-sbix.ttf"));
  assert.deepEqual(result.installed, [join(s.home, "Library/Fonts/OpenEmoji-sbix.ttf")]);
  assert.equal(result.fontconfig, undefined);
  assert.ok(result.notes.some((n) => n.includes("Terminal.app")));
  assert.ok(terminalSnippets("darwin").some((x) => x.terminal === "iTerm2"));
  await assert.rejects(installEmojiFont({ ...s, platform: "win32", fetch: fakeFetch }), /Windows/);
});
