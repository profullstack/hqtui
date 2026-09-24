import { test } from "node:test";
import assert from "node:assert/strict";
import {
  icon, iconGlyphs, iconMode, iconNames, iconPackFrom, openIcon, setIconMode, useIconPack,
} from "../src/icons.ts";
import { OPENICON_GLYPHS } from "../src/icons-data.ts";
import { renderToText } from "../src/testing.ts";

test("the OpenIcon pack is built in and on by default", () => {
  assert.ok(iconNames().length >= 300);
  for (const key of ["mail", "phone", "link", "search", "settings", "terminal", "git-branch", "github", "x", "slack"]) {
    assert.ok(iconGlyphs(key), key);
  }
});

test("each mode draws its own glyph, and aliases find the same icon", () => {
  assert.equal(icon("mail", { mode: "nerd" }), "\u{f01f0}");
  assert.equal(icon("mail", { mode: "unicode" }), "✉");
  assert.equal(icon("mail", { mode: "ascii" }), "@");
  assert.equal(icon("email", { mode: "ascii" }), "@");
  assert.equal(icon("twitter", { mode: "ascii" }), "x");
});

test("an icon Nerd Fonts lacks falls back to Unicode, and an unknown name draws nothing", () => {
  const noNerd = OPENICON_GLYPHS.find(([, nerd]) => nerd === "");
  assert.ok(noNerd, "the set has icons without a Nerd glyph");
  assert.equal(icon(noNerd[0], { mode: "nerd" }), noNerd[2]);
  assert.equal(icon("no-such-icon"), "");
});

test("the mode comes from the app, then the environment, then the terminal", () => {
  assert.equal(iconMode({ OPENICON_GLYPHS: "ascii", NERD_FONT: "1", LANG: "en_US.UTF-8" }), "ascii");
  assert.equal(iconMode({ HQTUI_ICONS: "nerd" }), "nerd");
  assert.equal(iconMode({ NERD_FONT: "1" }), "nerd");
  assert.equal(iconMode({ LANG: "en_US.UTF-8", TERM: "xterm-256color" }), "unicode");
  assert.equal(iconMode({ TERM: "dumb" }), "ascii");
  setIconMode("ascii");
  try {
    assert.equal(iconMode({ NERD_FONT: "1" }), "ascii");
    assert.equal(icon("phone"), "tel");
  } finally {
    setIconMode(undefined);
  }
});

test("a pack can be swapped for another OpenIcon set", () => {
  const custom = iconPackFrom({
    name: "Tiny", version: "1",
    icons: [{ key: "mail", aliases: ["post"], tui: { unicode: "📮", ascii: "M" } }],
  });
  useIconPack(custom);
  try {
    assert.equal(icon("post", { mode: "ascii" }), "M");
    assert.equal(icon("mail", { mode: "nerd" }), "📮");
    assert.equal(icon("phone"), "");
  } finally {
    useIconPack(openIcon);
  }
});

test("icons render inside widgets like any text", () => {
  setIconMode("ascii");
  try {
    const text = renderToText(({ ui }) => { ui.text(`${icon("mail")} Inbox ${icon("terminal")}`); }, { width: 20, height: 1 });
    assert.ok(text.startsWith("@ Inbox >_"), text);
  } finally {
    setIconMode(undefined);
  }
});

test("the generated table is sorted and complete", () => {
  const keys = OPENICON_GLYPHS.map(([k]) => k);
  assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  for (const [key, , unicode, ascii] of OPENICON_GLYPHS) {
    assert.ok(unicode.length > 0, key);
    assert.match(ascii, /^[\x21-\x7e]([\x20-\x7e]{0,2}[\x21-\x7e])?$/, key);
  }
});
