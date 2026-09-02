import { test } from "node:test";
import assert from "node:assert/strict";
import { InputParser, matchKey, type KeyEvent, type MouseEvent } from "../src/input.ts";

function keys(input: string): KeyEvent[] {
  return new InputParser().parse(input).filter((e): e is KeyEvent => e.type === "key");
}

test("printable characters carry their text", () => {
  const [event] = keys("a");
  assert.equal(event.name, "a");
  assert.equal(event.char, "a");
  assert.equal(event.ctrl, false);
});

test("control codes decode to ctrl+letter", () => {
  const [event] = keys("\x03");
  assert.equal(event.key, "ctrl+c");
  assert.equal(event.name, "c");
});

test("arrows and navigation keys are normalized", () => {
  assert.equal(keys("\x1b[A")[0].name, "up");
  assert.equal(keys("\x1bOB")[0].name, "down");
  assert.equal(keys("\x1b[5~")[0].name, "pageup");
  assert.equal(keys("\x1b[3~")[0].name, "delete");
  assert.equal(keys("\x1b[H")[0].name, "home");
});

test("function keys decode across both encodings", () => {
  assert.equal(keys("\x1bOP")[0].name, "f1");
  assert.equal(keys("\x1b[15~")[0].name, "f5");
  assert.equal(keys("\x1b[21~")[0].name, "f10");
});

test("modifier parameters are decoded", () => {
  const event = keys("\x1b[1;5A")[0];
  assert.equal(event.name, "up");
  assert.equal(event.ctrl, true);
  assert.equal(event.key, "ctrl+up");
});

test("shift+tab is distinguished from tab", () => {
  assert.equal(keys("\t")[0].name, "tab");
  const shifted = keys("\x1b[Z")[0];
  assert.equal(shifted.name, "tab");
  assert.equal(shifted.shift, true);
});

test("enter, escape, space and backspace are named", () => {
  assert.equal(keys("\r")[0].name, "enter");
  // A lone ESC is buffered until the flush timeout decides it was not a sequence.
  const parser = new InputParser();
  assert.deepEqual(parser.parse("\x1b"), []);
  assert.equal((parser.flush()[0] as KeyEvent).name, "escape");
  assert.equal(keys(" ")[0].name, "space");
  assert.equal(keys("\x7f")[0].name, "backspace");
});

test("alt+key sets the alt modifier", () => {
  const event = keys("\x1bx")[0];
  assert.equal(event.name, "x");
  assert.equal(event.alt, true);
});

test("SGR mouse presses decode to zero-based coordinates", () => {
  const [event] = new InputParser().parse("\x1b[<0;10;5M") as MouseEvent[];
  assert.equal(event.type, "mouse");
  assert.equal(event.action, "press");
  assert.equal(event.button, "left");
  assert.equal(event.x, 9);
  assert.equal(event.y, 4);
});

test("mouse release, drag and scroll are distinguished", () => {
  const parser = new InputParser();
  assert.equal((parser.parse("\x1b[<0;1;1m")[0] as MouseEvent).action, "release");
  assert.equal((parser.parse("\x1b[<32;1;1M")[0] as MouseEvent).action, "drag");
  const scroll = parser.parse("\x1b[<64;1;1M")[0] as MouseEvent;
  assert.equal(scroll.action, "scroll");
  assert.equal(scroll.scroll, -1);
  assert.equal((parser.parse("\x1b[<65;1;1M")[0] as MouseEvent).scroll, 1);
});

test("sequences split across chunks still decode", () => {
  const parser = new InputParser();
  assert.deepEqual(parser.parse("\x1b["), []);
  const events = parser.parse("A") as KeyEvent[];
  assert.equal(events[0].name, "up");
});

test("bracketed paste arrives as one event", () => {
  const parser = new InputParser();
  const events = parser.parse("\x1b[200~hello world\x1b[201~");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "paste");
  assert.equal((events[0] as { text: string }).text, "hello world");
});

test("paste split across chunks is reassembled", () => {
  const parser = new InputParser();
  assert.deepEqual(parser.parse("\x1b[200~part one "), []);
  const events = parser.parse("part two\x1b[201~");
  assert.equal((events[0] as { text: string }).text, "part one part two");
});

test("focus events are reported", () => {
  const parser = new InputParser();
  assert.deepEqual(parser.parse("\x1b[I")[0], { type: "focus", focused: true });
  assert.deepEqual(parser.parse("\x1b[O")[0], { type: "focus", focused: false });
});

test("matchKey accepts both bare and modified forms", () => {
  const [q] = keys("q");
  assert.ok(matchKey(q, "q"));
  const [ctrlC] = keys("\x03");
  assert.ok(matchKey(ctrlC, "ctrl+c"));
  assert.ok(!matchKey(ctrlC, "c"));
});

test("a paste terminator split across reads still ends the paste", () => {
  // Routine over SSH. A partial end marker used to be swallowed into the paste
  // buffer and lost, so the paste never ended and every later keystroke —
  // Ctrl+C included — was buffered instead of dispatched.
  const START = "\x1b[200~";
  const END = "\x1b[201~";
  for (let cut = 0; cut <= END.length; cut++) {
    const parser = new InputParser();
    const full = START + "hello" + END;
    const at = START.length + "hello".length + cut;
    const events = [...parser.parse(full.slice(0, at)), ...parser.parse(full.slice(at))];
    const paste = events.find((e) => e.type === "paste");
    assert.ok(paste, `split at ${cut} lost the paste`);
    assert.equal(paste.type === "paste" && paste.text, "hello");
    // And the parser is still usable afterwards.
    assert.equal(parser.parse("q")[0]?.type, "key");
  }
});

test("a paste delivered one byte at a time still decodes", () => {
  const parser = new InputParser();
  const events: ReturnType<InputParser["parse"]> = [];
  for (const ch of "\x1b[200~abc\x1b[201~") events.push(...parser.parse(ch));
  const paste = events.find((e) => e.type === "paste");
  assert.equal(paste?.type === "paste" && paste.text, "abc");
  const key = parser.parse("z")[0];
  assert.equal(key?.type === "key" && key.key, "z");
});

test("paste content that resembles the end marker is kept", () => {
  const parser = new InputParser();
  const events = [
    ...parser.parse("\x1b[200~a\x1b[20"),
    ...parser.parse("0~b\x1b[201~"),
  ];
  const paste = events.find((e) => e.type === "paste");
  // ESC[200~ inside a paste is content; only ESC[201~ ends it.
  assert.equal(paste?.type === "paste" && paste.text, "a\x1b[200~b");
});

test("a bare binding does not fire on the shifted key", () => {
  // Tab and Shift+Tab move focus in opposite directions; a "tab" binding that
  // also matched Shift+Tab did both at once.
  const shiftTab: KeyEvent = {
    type: "key", name: "tab", key: "shift+tab",
    shift: true, ctrl: false, alt: false, raw: "\x1b[Z",
  };
  assert.equal(matchKey(shiftTab, "tab"), false);
  assert.equal(matchKey(shiftTab, "shift+tab"), true);
  // Shift is what produces a capital letter, so it is not a modifier there.
  const shiftA: KeyEvent = {
    type: "key", name: "a", key: "a",
    shift: true, ctrl: false, alt: false, char: "A", raw: "A",
  };
  assert.equal(matchKey(shiftA, "a"), true);
});
