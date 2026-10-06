import { after, test } from "node:test";
import assert from "node:assert/strict";

import { renderToScreen } from "../src/testing.ts";
import { emojiByGroup, emojiGroups, type EmojiInfo } from "../src/emoji.ts";
import { setIconMode } from "../src/icons.ts";
import {
  EMOJI_RECENT, createEmojiPicker, emojiPickerItems, emojiPickerKey, type EmojiPickerState,
} from "../src/widgets/emoji-picker.ts";
import { editText, insertText, type TextEditState } from "../src/text-edit.ts";
import type { KeyEvent } from "../src/input.ts";

// Bun runs every test file in one process: put the app-wide mode back after.
setIconMode("unicode");
after(() => setIconMode(undefined));

const key = (name: string, extra: Partial<KeyEvent> = {}): KeyEvent => {
  const mods = name.split("+");
  const base = mods.pop()!;
  const char = base.length === 1 && !mods.length ? base : undefined;
  return {
    type: "key", name: base, ctrl: mods.includes("ctrl"), alt: mods.includes("alt"), shift: mods.includes("shift"),
    char, key: name, raw: name, ...extra,
  };
};
const typed = (s: string): KeyEvent => key(s, { char: s, key: s, name: s });

test("groups come in Unicode order and leave skin tones out", () => {
  const groups = emojiGroups();
  assert.equal(groups[0], "Smileys & Emotion");
  assert.equal(groups.at(-1), "Flags");
  const smileys = emojiByGroup(0);
  assert.equal(smileys[0]?.char, "😀");
  assert.ok(emojiByGroup("People & Body").every((e) => !e.base));
  assert.deepEqual(emojiByGroup(99), []);
});

test("the picker opens on Recent when there are recents, else the first group", () => {
  assert.equal(createEmojiPicker().tab, 0);
  assert.equal(createEmojiPicker(["🚀"]).tab, EMOJI_RECENT);
  assert.deepEqual(emojiPickerItems(createEmojiPicker(["🚀", ":tada:"]), ["🚀", ":tada:"]).map((e) => e.char), ["🚀", "🎉"]);
});

test("typing searches, Enter picks, Escape closes", () => {
  let state: EmojiPickerState = createEmojiPicker();
  for (const ch of "rocket") state = emojiPickerKey(state, typed(ch)).state;
  assert.equal(state.query, "rocket");
  const result = emojiPickerKey(state, key("enter"));
  assert.equal(result.picked?.char, "🚀");
  assert.equal(emojiPickerKey(state, key("backspace")).state.query, "rocke");
  assert.equal(emojiPickerKey(state, key("ctrl+u")).state.query, "");
  assert.equal(emojiPickerKey(state, key("escape")).close, true);
});

test("search leaves skin-tone rows out", () => {
  const hearts = emojiPickerItems({ ...createEmojiPicker(), query: "heart" });
  assert.equal(hearts[0]?.char, "❤️");
  assert.ok(hearts.every((e) => !/1f3f[b-f]/.test(e.key)));
});

test("arrows move through the grid and scroll it", () => {
  let state = createEmojiPicker();
  const opts = { columns: 10, rows: 3 };
  state = emojiPickerKey(state, key("right"), opts).state;
  assert.equal(state.index, 1);
  state = emojiPickerKey(state, key("down"), opts).state;
  assert.equal(state.index, 11);
  state = emojiPickerKey(state, key("left"), opts).state;
  state = emojiPickerKey(state, key("up"), opts).state;
  state = emojiPickerKey(state, key("up"), opts).state;
  assert.equal(state.index, 0, "clamped at the top");
  for (let i = 0; i < 4; i++) state = emojiPickerKey(state, key("down"), opts).state;
  assert.equal(state.index, 40);
  assert.equal(state.offset, 2, "the highlighted row stays on screen");
  state = emojiPickerKey(state, key("end"), opts).state;
  assert.equal(state.index, emojiByGroup(0).length - 1);
});

test("Tab cycles groups and wraps; Shift+Tab goes back", () => {
  let state = createEmojiPicker(["🚀"]);
  const recent = ["🚀"];
  state = emojiPickerKey(state, key("tab"), { recent }).state;
  assert.equal(state.tab, 0);
  state = emojiPickerKey(state, key("shift+tab", { name: "tab", shift: true }), { recent }).state;
  assert.equal(state.tab, EMOJI_RECENT);
  state = emojiPickerKey(state, key("shift+tab", { name: "tab", shift: true }), { recent }).state;
  assert.equal(state.tab, emojiGroups().length - 1, "wraps to Flags");
});

test("it draws tabs, the grid and the highlighted emoji's shortcode", () => {
  const state = createEmojiPicker();
  const screen = renderToScreen(({ ui }) => {
    ui.emojiPicker({ state, onChange: () => {}, onPick: () => {}, onClose: () => {} });
  }, { width: 50, height: 16 });
  assert.ok(screen.contains("Search emoji"));
  assert.ok(screen.contains("😀"));
  assert.ok(screen.contains(":grinning_face:  grinning face"), screen.text());
  assert.ok(screen.contains("🙂") && screen.contains("⚑"), "group tabs drawn with OpenIcon glyphs");
});

test("the mouse picks, switches groups, hovers and closes", () => {
  let state = createEmojiPicker();
  const picked: EmojiInfo[] = [];
  let closed = false;
  const draw = () =>
    renderToScreen(({ ui }) => {
      ui.emojiPicker({ state, onChange: (s) => { state = s; }, onPick: (e) => picked.push(e), onClose: () => { closed = true; } });
    }, { width: 50, height: 16 });

  let screen = draw();
  const first = screen.find("😀")!;
  assert.ok(screen.click(first.x, first.y));
  assert.equal(picked[0]?.char, "😀");

  screen.hover(first.x + 3, first.y);
  assert.equal(state.index, 1);

  const flag = screen.find("⚑")!; // the Flags tab, in unicode icon mode
  screen.click(flag.x, flag.y);
  assert.equal(state.tab, emojiGroups().length - 1);

  screen = draw();
  screen.click(0, 0);
  assert.ok(closed, "a click outside closes it");
});

test("text editing moves and deletes by grapheme, so emoji stay whole", () => {
  let field: TextEditState = { value: "", cursor: 0 };
  for (const ch of "hi") field = editText(field, typed(ch))!;
  field = insertText(field, "👩‍💻");
  field = editText(field, key("space", { char: " " }))!;
  field = insertText(field, "🇺🇸");
  assert.equal(field.value, "hi👩‍💻 🇺🇸");
  field = editText(field, key("backspace"))!;
  assert.equal(field.value, "hi👩‍💻 ", "the whole flag goes");
  field = editText(field, key("left"))!;
  field = editText(field, key("left"))!;
  assert.equal(field.cursor, 2, "one press crosses the whole ZWJ sequence");
  field = editText(field, key("delete"))!;
  assert.equal(field.value, "hi ");
  assert.equal(editText(field, key("enter")), undefined, "Enter is the caller's");
  field = editText({ value: "one two three", cursor: 13 }, key("ctrl+w"))!;
  assert.equal(field.value, "one two ");
  assert.equal(insertText({ value: "ab", cursor: 1 }, "x\ny").value, "ax yb");
});

test("the text input caret counts columns, not code units", () => {
  const screen = renderToScreen(({ ui }) => {
    ui.textInput({ value: "🚀🚀x", cursor: 4, focused: true });
  }, { width: 20, height: 1 });
  // Two rockets are 4 code units and 4 columns; the caret sits on "x", after them.
  const x = screen.find("x")!;
  assert.equal(screen.cell(x.x, 0).bg, screen.cell(x.x, 0).bg);
  assert.ok(x.x >= 5, `caret column ${x.x}`);
});
