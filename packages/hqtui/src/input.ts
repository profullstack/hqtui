/**
 * Decodes raw terminal bytes into normalized events. Applications should never
 * see an escape sequence — only `"ctrl+c"`, `"up"`, or a printable character.
 */

export interface KeyEvent {
  type: "key";
  /** Normalized name: "a", "up", "enter", "f5", "escape", "space", … */
  name: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** The printable character, when there is one. */
  char?: string;
  /** Full form including modifiers, e.g. "ctrl+c" — what you usually match on. */
  key: string;
  raw: string;
}

export interface MouseEvent {
  type: "mouse";
  action: "press" | "release" | "move" | "drag" | "scroll";
  button: "left" | "middle" | "right" | "none";
  /** Zero-based cell coordinates. */
  x: number;
  y: number;
  /** -1 up, 1 down; 0 when this is not a scroll. */
  scroll: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export interface PasteEvent {
  type: "paste";
  text: string;
}

export interface FocusEvent {
  type: "focus";
  focused: boolean;
}

export type InputEvent = KeyEvent | MouseEvent | PasteEvent | FocusEvent;

const SPECIAL: Record<string, string> = {
  "[A": "up", "[B": "down", "[C": "right", "[D": "left",
  "[H": "home", "[F": "end", "[Z": "shift+tab",
  "OA": "up", "OB": "down", "OC": "right", "OD": "left",
  "OH": "home", "OF": "end",
  "OP": "f1", "OQ": "f2", "OR": "f3", "OS": "f4",
  "[1~": "home", "[2~": "insert", "[3~": "delete", "[4~": "end",
  "[5~": "pageup", "[6~": "pagedown", "[7~": "home", "[8~": "end",
  "[11~": "f1", "[12~": "f2", "[13~": "f3", "[14~": "f4", "[15~": "f5",
  "[17~": "f6", "[18~": "f7", "[19~": "f8", "[20~": "f9", "[21~": "f10",
  "[23~": "f11", "[24~": "f12",
};

// xterm modifier parameter: 1 + bitfield(shift=1, alt=2, ctrl=4).
function decodeModifiers(param: number): { shift: boolean; alt: boolean; ctrl: boolean } {
  const bits = Math.max(0, param - 1);
  return { shift: (bits & 1) !== 0, alt: (bits & 2) !== 0, ctrl: (bits & 4) !== 0 };
}

function keyEvent(
  name: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
  char?: string,
  raw = "",
): KeyEvent {
  const ctrl = mods.ctrl ?? false;
  const alt = mods.alt ?? false;
  const shift = mods.shift ?? false;
  const parts: string[] = [];
  if (ctrl) parts.push("ctrl");
  if (alt) parts.push("alt");
  if (shift && name.length > 1) parts.push("shift");
  parts.push(name);
  return { type: "key", name, ctrl, alt, shift, char, key: parts.join("+"), raw };
}

/**
 * Feed it chunks, get events. Stateful so a sequence split across two reads
 * (common over SSH) still decodes correctly.
 */
const PASTE_END = "\x1b[201~";

/** Length of the longest suffix of `text` that is a proper prefix of `marker`. */
function partialSuffix(text: string, marker: string): number {
  for (let n = Math.min(text.length, marker.length - 1); n > 0; n--) {
    if (text.endsWith(marker.slice(0, n))) return n;
  }
  return 0;
}

export class InputParser {
  private pending = "";
  private pasteBuffer: string | null = null;
  /**
   * Bytes held back mid-paste because they could be the start of the end
   * marker. Kept separate from `pending` so they do not look like an
   * unterminated escape and trip the Escape-key timeout.
   */
  private pasteTail = "";

  /** True when bytes are buffered awaiting the rest of a sequence. */
  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  /**
   * Resolve buffered bytes that turned out to be complete after all. A lone ESC
   * is ambiguous — it only becomes the Escape key once no more bytes follow —
   * so the terminal calls this on a short timeout.
   */
  flush(): InputEvent[] {
    // `pasteTail` is deliberately left alone. Folding it into the paste content
    // here destroyed a partial end marker whenever the Escape timeout fired
    // between the two reads carrying it: the rest of the marker then arrived
    // alone, never matched, and the paste could never end — the exact wedge
    // this holdback exists to prevent.
    if (this.pending.length === 0) return [];
    const data = this.pending;
    this.pending = "";
    if (data === "\x1b") return [keyEvent("escape", {}, undefined, "\x1b")];
    const events: InputEvent[] = [];
    // An incomplete sequence that never completed: emit ESC and re-parse the rest.
    events.push(keyEvent("escape", {}, undefined, "\x1b"));
    events.push(...this.parse(data.slice(1)));
    return events;
  }

  parse(chunk: string): InputEvent[] {
    const events: InputEvent[] = [];
    let data = this.pending + chunk;
    this.pending = "";
    if (this.pasteTail.length > 0) {
      data = this.pasteTail + data;
      this.pasteTail = "";
    }

    while (data.length > 0) {
      if (this.pasteBuffer !== null) {
        const end = data.indexOf(PASTE_END);
        if (end === -1) {
          // The end marker can straddle two reads, which is routine over SSH.
          // Swallowing a partial one here used to lose it for good: the paste
          // never ended, and every later keystroke — Ctrl+C included — went
          // into the buffer instead of being dispatched.
          const keep = partialSuffix(data, PASTE_END);
          this.pasteBuffer += keep > 0 ? data.slice(0, data.length - keep) : data;
          this.pasteTail = keep > 0 ? data.slice(data.length - keep) : "";
          data = "";
          break;
        }
        this.pasteBuffer += data.slice(0, end);
        events.push({ type: "paste", text: this.pasteBuffer });
        this.pasteBuffer = null;
        data = data.slice(end + PASTE_END.length);
        continue;
      }

      const ch = data[0];

      if (ch !== "\x1b") {
        const consumed = this.parsePlain(data, events);
        data = data.slice(consumed);
        continue;
      }

      // Lone ESC at the end of a chunk: could be the start of a sequence.
      if (data.length === 1) {
        this.pending = data;
        break;
      }

      const consumed = this.parseEscape(data, events);
      if (consumed === -1) {
        this.pending = data; // incomplete sequence, wait for more bytes
        break;
      }
      data = data.slice(consumed);
    }
    return events;
  }

  private parsePlain(data: string, events: InputEvent[]): number {
    const cp = data.codePointAt(0) as number;
    const size = cp > 0xffff ? 2 : 1;
    const ch = data.slice(0, size);

    if (cp === 13 || cp === 10) {
      events.push(keyEvent("enter", {}, undefined, ch));
      return size;
    }
    if (cp === 9) {
      events.push(keyEvent("tab", {}, undefined, ch));
      return size;
    }
    if (cp === 127 || cp === 8) {
      events.push(keyEvent("backspace", {}, undefined, ch));
      return size;
    }
    if (cp === 32) {
      events.push(keyEvent("space", {}, " ", ch));
      return size;
    }
    if (cp < 32) {
      // Ctrl+letter arrives as the control code itself.
      const letter = String.fromCharCode(cp + 96);
      events.push(keyEvent(letter, { ctrl: true }, undefined, ch));
      return size;
    }
    events.push(keyEvent(ch, {}, ch, ch));
    return size;
  }

  private parseEscape(data: string, events: InputEvent[]): number {
    // Bracketed paste start.
    if (data.startsWith("\x1b[200~")) {
      this.pasteBuffer = "";
      return 6;
    }
    if (data.startsWith("\x1b[I")) {
      events.push({ type: "focus", focused: true });
      return 3;
    }
    if (data.startsWith("\x1b[O")) {
      events.push({ type: "focus", focused: false });
      return 3;
    }

    // SGR mouse: ESC [ < b ; x ; y (M press | m release)
    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(data);
    if (mouse) {
      events.push(this.decodeMouse(Number(mouse[1]), Number(mouse[2]), Number(mouse[3]), mouse[4] === "M"));
      return mouse[0].length;
    }
    if (/^\x1b\[<[\d;]*$/.test(data)) return -1;

    // CSI with modifier parameters: ESC [ 1 ; 5 A  → ctrl+up
    const modded = /^\x1b\[1;(\d+)([A-HPQRS])/.exec(data);
    if (modded) {
      const mods = decodeModifiers(Number(modded[1]));
      const base = SPECIAL[`[${modded[2]}`] ?? SPECIAL[`O${modded[2]}`];
      if (base) {
        events.push(keyEvent(base, mods, undefined, modded[0]));
        return modded[0].length;
      }
    }
    const moddedTilde = /^\x1b\[(\d+);(\d+)~/.exec(data);
    if (moddedTilde) {
      const base = SPECIAL[`[${moddedTilde[1]}~`];
      if (base) {
        events.push(keyEvent(base, decodeModifiers(Number(moddedTilde[2])), undefined, moddedTilde[0]));
        return moddedTilde[0].length;
      }
    }

    // Plain special keys, longest match first.
    for (const seq of SPECIAL_KEYS_SORTED) {
      if (data.startsWith(`\x1b${seq}`)) {
        const name = SPECIAL[seq];
        if (name === "shift+tab") events.push(keyEvent("tab", { shift: true }, undefined, `\x1b${seq}`));
        else events.push(keyEvent(name, {}, undefined, `\x1b${seq}`));
        return seq.length + 1;
      }
    }

    // Possibly-incomplete CSI/SS3 sequence.
    if (/^\x1b(\[|O)[\d;<]*$/.test(data)) return -1;

    // Alt+key.
    if (data.length >= 2 && data[1] !== "[" && data[1] !== "O") {
      const rest = data.slice(1);
      const sub: InputEvent[] = [];
      const consumed = this.parsePlain(rest, sub);
      const first = sub[0];
      if (first && first.type === "key") {
        events.push(keyEvent(first.name, { ...first, alt: true }, first.char, `\x1b${first.raw}`));
        return consumed + 1;
      }
    }

    events.push(keyEvent("escape", {}, undefined, "\x1b"));
    return 1;
  }

  private decodeMouse(code: number, col: number, row: number, pressed: boolean): MouseEvent {
    const shift = (code & 4) !== 0;
    const alt = (code & 8) !== 0;
    const ctrl = (code & 16) !== 0;
    const motion = (code & 32) !== 0;
    const isScroll = (code & 64) !== 0;
    const buttonBits = code & 3;

    let button: MouseEvent["button"] = "none";
    let action: MouseEvent["action"];
    let scroll = 0;

    if (isScroll) {
      action = "scroll";
      scroll = buttonBits === 0 ? -1 : 1;
    } else if (motion) {
      action = buttonBits === 3 ? "move" : "drag";
      button = buttonBits === 0 ? "left" : buttonBits === 1 ? "middle" : buttonBits === 2 ? "right" : "none";
    } else {
      action = pressed ? "press" : "release";
      button = buttonBits === 0 ? "left" : buttonBits === 1 ? "middle" : buttonBits === 2 ? "right" : "none";
    }

    return {
      type: "mouse",
      action,
      button,
      x: Math.max(0, col - 1),
      y: Math.max(0, row - 1),
      scroll,
      ctrl,
      alt,
      shift,
    };
  }
}

const SPECIAL_KEYS_SORTED = Object.keys(SPECIAL).sort((a, b) => b.length - a.length);

/** Does this event match a binding like `"ctrl+c"`, `"q"`, or `"f10"`? */
export function matchKey(event: KeyEvent, binding: string): boolean {
  const b = binding.toLowerCase().trim();
  if (event.key.toLowerCase() === b) return true;
  // A bare name matches whatever the shift state. Rejecting shift here was
  // justified by Tab focus firing both ways at once, which was simply wrong —
  // `App` reads `event.name` directly and never calls this — and it silently
  // stopped every shifted named key (shift+up, shift+home, shift+f1, …) from
  // matching its own name. Bind "shift+tab" to distinguish; `key` carries it.
  if (event.name.toLowerCase() === b && !event.ctrl && !event.alt) return true;
  return false;
}
