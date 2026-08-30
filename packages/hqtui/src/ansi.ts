/** Raw VT/ANSI control sequences. Nothing above this layer writes an escape by hand. */

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
  return `${ESC}]0;${title.replace(/[\x00-\x1f]/g, "")}\x07`;
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

/** Strip escape sequences — used by the headless renderer and by tests. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g, "");
}
