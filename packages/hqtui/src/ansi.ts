/** Raw VT/ANSI control sequences. Nothing above this layer writes an escape by hand. */
import { stripUnsafe } from "./unicode.ts";

export const ESC = "\x1b";
export const CSI = "\x1b[";

export const ansi = {
  reset: `${CSI}0m`,

  alternateScreenOn: `${CSI}?1049h`,
  alternateScreenOff: `${CSI}?1049l`,

  cursorHide: `${CSI}?25l`,
  cursorShow: `${CSI}?25h`,
  cursorHome: `${CSI}H`,
  cursorSave: `${ESC}7`,
  cursorRestore: `${ESC}8`,

  clearScreen: `${CSI}2J`,
  clearScrollback: `${CSI}3J`,
  clearLine: `${CSI}2K`,
  clearToEnd: `${CSI}0J`,

  // 1000 = clicks, 1002 = drag, 1003 = any motion, 1006 = SGR extended coords.
  mouseOn: `${CSI}?1000h${CSI}?1002h${CSI}?1003h${CSI}?1006h`,
  mouseOff: `${CSI}?1006l${CSI}?1003l${CSI}?1002l${CSI}?1000l`,

  bracketedPasteOn: `${CSI}?2004h`,
  bracketedPasteOff: `${CSI}?2004l`,

  focusOn: `${CSI}?1004h`,
  focusOff: `${CSI}?1004l`,

  /** Atomic frame: the terminal shows nothing until endSync. Kills tearing. */
  beginSync: `${CSI}?2026h`,
  endSync: `${CSI}?2026l`,

  softReset: `${CSI}!p`,
} as const;

export function moveTo(x: number, y: number): string {
  return `${CSI}${y + 1};${x + 1}H`;
}

export function moveRight(n: number): string {
  return n === 1 ? `${CSI}C` : `${CSI}${n}C`;
}

export function moveToColumn(x: number): string {
  return `${CSI}${x + 1}G`;
}

export function setTitle(title: string): string {
  // The title is interpolated into an OSC sequence, so anything that could end
  // or restart it has to go. `stripUnsafe` is the same policy the grid uses:
  // C0, DEL, C1 (8-bit ST and CSI included) and the bidi overrides.
  return `${ESC}]0;${stripUnsafe(title)}\x07`;
}

export function fgTrue(r: number, g: number, b: number): string {
  return `${CSI}38;2;${r};${g};${b}m`;
}

export function bgTrue(r: number, g: number, b: number): string {
  return `${CSI}48;2;${r};${g};${b}m`;
}

export function fg256(i: number): string {
  return `${CSI}38;5;${i}m`;
}

export function bg256(i: number): string {
  return `${CSI}48;5;${i}m`;
}

export function fg16(i: number): string {
  return i < 8 ? `${CSI}${30 + i}m` : `${CSI}${90 + i - 8}m`;
}

export function bg16(i: number): string {
  return i < 8 ? `${CSI}${40 + i}m` : `${CSI}${100 + i - 8}m`;
}

export const fgDefault = `${CSI}39m`;
export const bgDefault = `${CSI}49m`;

/**
 * Strip escape sequences — used by the headless renderer and by tests, and
 * exported for apps that want to sanitise text themselves.
 *
 * Two things the obvious regex misses, both of which leave a live sequence
 * behind: CSI may carry intermediate bytes (0x20-0x2f) before its final byte,
 * as in `ESC [ 0 SP q`; and every sequence has an 8-bit C1 form where a single
 * byte replaces `ESC x`. After the structured pass, anything still holding a
 * control or bidi override is removed outright, so the result cannot steer a
 * terminal even if a form was missed.
 */
export function stripAnsi(text: string): string {
  const stripped = text.replace(
    // eslint-disable-next-line no-control-regex
    /(?:\x1b\[|\x9b)[0-9;?<=>]*[ -/]*[@-~]|(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)|(?:\x1bP|\x90)[\s\S]*?(?:\x1b\\|\x9c|$)|\x1b[@-Z\\-_]/g,
    "",
  );
  return stripped.replace(TEXT_UNSAFE, "");
}

/**
 * The grid's unsafe set minus tab, newline and carriage return. `stripAnsi`
 * works on text, not cells, and multi-line callers rely on those three; the
 * framebuffer refuses them separately, which is the right layer for it.
 */
// eslint-disable-next-line no-control-regex -- matching controls is the point
const TEXT_UNSAFE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
