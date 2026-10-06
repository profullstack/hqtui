/**
 * One-line text editing for a text input: the state is the value plus a caret
 * (a string index that always sits on a grapheme boundary, so an emoji, a flag
 * or a ZWJ family moves and deletes as one character).
 *
 *   let field = { value: "", cursor: 0 };
 *   app.on("key", (e) => { field = editText(field, e) ?? field; });
 *   app.on("paste", (text) => { field = insertText(field, text); });
 *   ui.textInput({ value: field.value, cursor: field.cursor, focused: true });
 *
 * Readline keys: ←/→ by character, Ctrl/Alt+←/→ (or Alt+B/F) by word,
 * Home/Ctrl+A, End/Ctrl+E, Backspace, Delete/Ctrl+D, Ctrl+W (word back),
 * Ctrl+U (to start), Ctrl+K (to end).
 */
import type { KeyEvent } from "./input.ts";

export interface TextEditState {
  value: string;
  /** Caret, as a string index. */
  cursor: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Grapheme boundaries of a string, as string indices, 0 and length included. */
function boundaries(value: string): number[] {
  const out = [0];
  for (const { index, segment } of segmenter.segment(value)) out.push(index + segment.length);
  return out;
}

function clampCursor(value: string, cursor: number): number {
  const stops = boundaries(value);
  let best = 0;
  for (const stop of stops) if (stop <= cursor) best = stop;
  return best;
}

function prevStop(value: string, cursor: number): number {
  const stops = boundaries(value);
  let best = 0;
  for (const stop of stops) if (stop < cursor) best = stop;
  return best;
}

function nextStop(value: string, cursor: number): number {
  for (const stop of boundaries(value)) if (stop > cursor) return stop;
  return value.length;
}

const isSpace = (s: string) => /\s/.test(s);

function wordLeft(value: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && isSpace(value[i - 1]!)) i--;
  while (i > 0 && !isSpace(value[i - 1]!)) i--;
  return clampCursor(value, i);
}

function wordRight(value: string, cursor: number): number {
  let i = cursor;
  while (i < value.length && isSpace(value[i]!)) i++;
  while (i < value.length && !isSpace(value[i]!)) i++;
  return i; // whitespace is one code unit, so this is always a boundary
}

/** Insert text at the caret (typing, a paste, a picked emoji). Newlines become spaces. */
export function insertText(state: TextEditState, text: string): TextEditState {
  const clean = text.replace(/\r\n|\r|\n/g, " ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  const cursor = clampCursor(state.value, state.cursor);
  return { value: state.value.slice(0, cursor) + clean + state.value.slice(cursor), cursor: cursor + clean.length };
}

/**
 * Apply one key. Returns the new state, or undefined when the key is not an
 * editing key (Enter, Escape, Tab, arrows up/down...) so the caller can use it.
 */
export function editText(state: TextEditState, event: KeyEvent): TextEditState | undefined {
  const { value } = state;
  const cursor = clampCursor(value, Math.max(0, Math.min(state.cursor, value.length)));
  const at = (c: number): TextEditState => ({ value, cursor: c });
  const cut = (from: number, to: number): TextEditState => ({ value: value.slice(0, from) + value.slice(to), cursor: from });

  switch (event.key) {
    case "left": return at(prevStop(value, cursor));
    case "right": return at(nextStop(value, cursor));
    case "ctrl+left": case "alt+left": case "alt+b": return at(wordLeft(value, cursor));
    case "ctrl+right": case "alt+right": case "alt+f": return at(wordRight(value, cursor));
    case "home": case "ctrl+a": return at(0);
    case "end": case "ctrl+e": return at(value.length);
    case "backspace": case "ctrl+h": return cursor > 0 ? cut(prevStop(value, cursor), cursor) : at(cursor);
    case "delete": case "ctrl+d": return cursor < value.length ? { value: value.slice(0, cursor) + value.slice(nextStop(value, cursor)), cursor } : at(cursor);
    case "ctrl+w": case "alt+backspace": return cut(wordLeft(value, cursor), cursor);
    case "ctrl+u": return cut(0, cursor);
    case "ctrl+k": return { value: value.slice(0, cursor), cursor };
  }
  if (event.ctrl || event.alt) return undefined;
  if (event.name === "space") return insertText({ value, cursor }, " ");
  if (event.char && event.char.length > 0 && !/[\x00-\x1f\x7f]/.test(event.char)) {
    return insertText({ value, cursor }, event.char);
  }
  return undefined;
}
