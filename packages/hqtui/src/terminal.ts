import { ansi, moveTo, moveUp, setTitle } from "./ansi.ts";
import { type Capabilities, type CapabilityOverrides, detectCapabilities } from "./capabilities.ts";
import { InputParser, type InputEvent } from "./input.ts";

/**
 * How much of the terminal the app owns.
 *
 * `fullscreen` is what hqtui has always done: the alternate screen, the whole
 * grid, and the user's shell handed back untouched at the end.
 *
 * `inline` draws a bounded strip in the normal flow of the command line, the
 * shape every installer and build tool uses -- a few live rows pinned below
 * output that scrolls away above them, and a readable transcript left behind
 * when the process exits. It has no absolute coordinates it can trust, because
 * it does not know which screen row it started on and the terminal can scroll
 * it up at any moment; it navigates from a saved cursor instead.
 *
 * `fixed` claims a rectangle of a terminal something else is driving.
 */
export type Viewport =
  | { mode: "fullscreen" }
  | { mode: "inline"; height: number }
  | { mode: "fixed"; x: number; y: number; width: number; height: number };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TerminalOptions {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  /** Use the alternate screen so the user's scrollback survives. Default true. */
  alternateScreen?: boolean;
  mouse?: boolean;
  hideCursor?: boolean;
  bracketedPaste?: boolean;
  focusEvents?: boolean;
  title?: string;
  capabilities?: CapabilityOverrides;
  /** Restore the terminal on SIGINT/SIGTERM/uncaught errors. Default true. */
  installExitHandlers?: boolean;
  /** How long to wait before a lone ESC counts as the Escape key. Default 30ms. */
  escapeTimeout?: number;
  /** How much of the terminal to draw into. Default the whole of it. */
  viewport?: Viewport;
}

export interface TerminalSize {
  columns: number;
  rows: number;
}

type Listener<T> = (value: T) => void;

/**
 * Owns the TTY: raw mode, alternate screen, mouse reporting, and — above all —
 * putting everything back. A crashed app must never leave an unusable shell.
 */
export class Terminal {
  readonly input: NodeJS.ReadStream;
  readonly output: NodeJS.WriteStream;
  readonly capabilities: Capabilities;
  private options: Required<Omit<TerminalOptions, "capabilities" | "title" | "input" | "output" | "escapeTimeout" | "viewport">> & { title?: string };
  private parser = new InputParser();
  private entered = false;
  /** Milliseconds to wait before deciding a lone ESC was the Escape key. */
  readonly escapeTimeout: number;
  private rawWasSet = false;
  private inputListeners = new Set<Listener<InputEvent>>();
  private resizeListeners = new Set<Listener<TerminalSize>>();
  private cleanupHandlers: (() => void)[] = [];
  private teardownListeners = new Set<() => void>();
  private escapeTimer: NodeJS.Timeout | null = null;
  private viewportMode: Viewport = { mode: "fullscreen" };
  /**
   * Rows an inline viewport has reserved below the anchor. Kept because a
   * resize can shrink the terminal under it, and because `restore` has to know
   * how far down to move before handing the shell back.
   */
  private reserved = 0;
  private onData = (chunk: Buffer | string): void => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.dispatch(this.parser.parse(text));
    // A lone ESC is only the Escape key once nothing follows it.
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    this.escapeTimer = null;
    if (this.parser.hasPending) {
      this.escapeTimer = setTimeout(() => {
        this.escapeTimer = null;
        this.dispatch(this.parser.flush());
      }, this.escapeTimeout);
      this.escapeTimer.unref?.();
    }
  };

  private dispatch(events: InputEvent[]): void {
    for (const event of events) {
      for (const listener of this.inputListeners) listener(event);
    }
  }
  private onResize = (): void => {
    const size = this.size();
    for (const listener of this.resizeListeners) listener(size);
  };

  constructor(options: TerminalOptions = {}) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.capabilities = detectCapabilities(options.capabilities ?? {}, process.env, this.output);
    this.escapeTimeout = options.escapeTimeout ?? 30;
    this.viewportMode = options.viewport ?? { mode: "fullscreen" };
    // Only a fullscreen app may take the alternate screen. The whole point of
    // the other two is to leave what is already on the terminal alone.
    const fullscreen = this.viewportMode.mode === "fullscreen";
    this.options = {
      alternateScreen: fullscreen ? options.alternateScreen ?? true : false,
      mouse: options.mouse ?? this.capabilities.mouse,
      hideCursor: options.hideCursor ?? true,
      bracketedPaste: options.bracketedPaste ?? this.capabilities.bracketedPaste,
      focusEvents: options.focusEvents ?? this.capabilities.focusEvents,
      installExitHandlers: options.installExitHandlers ?? true,
      title: options.title,
    };
  }

  size(): TerminalSize {
    // Bun reports 0 for columns and rows on some ptys, and `?? 80` does not
    // catch a zero — which leaves a 0x0 framebuffer that renders nothing at
    // all. Anything not a positive finite number means "ask somewhere else".
    const usable = (value: unknown): number | undefined => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
    };
    return {
      columns: usable(this.output.columns) ?? usable(process.env.COLUMNS) ?? 80,
      rows: usable(this.output.rows) ?? usable(process.env.LINES) ?? 24,
    };
  }

  /** How much of the terminal the app owns. */
  get viewport(): Viewport {
    return this.viewportMode;
  }

  /**
   * The region to draw into, in screen cells.
   *
   * For an inline viewport the `y` is a fiction -- it is always 0, because the
   * strip is addressed from its own saved cursor rather than from the top of
   * the screen -- but the width and height are real, and they are what the
   * framebuffer is sized from.
   */
  viewportRect(): Rect {
    const { columns, rows } = this.size();
    const v = this.viewportMode;
    if (v.mode === "inline") {
      // A viewport taller than the terminal would scroll itself off the top
      // every frame, so it gives up the rows it cannot have.
      return { x: 0, y: 0, width: columns, height: Math.max(1, Math.min(v.height, rows)) };
    }
    if (v.mode === "fixed") {
      const x = Math.max(0, Math.min(v.x, Math.max(0, columns - 1)));
      const y = Math.max(0, Math.min(v.y, Math.max(0, rows - 1)));
      return {
        x,
        y,
        width: Math.max(0, Math.min(v.width, columns - x)),
        height: Math.max(0, Math.min(v.height, rows - y)),
      };
    }
    return { x: 0, y: 0, width: columns, height: rows };
  }

  write(data: string): void {
    if (data.length === 0) return;
    this.output.write(data);
  }

  /** Enter full-screen mode. Idempotent. */
  enter(): void {
    if (this.entered) return;
    this.entered = true;

    let setup = "";
    if (this.options.alternateScreen) setup += ansi.alternateScreenOn;
    if (this.options.hideCursor) setup += ansi.cursorHide;
    if (this.options.mouse && this.capabilities.mouse) setup += ansi.mouseOn;
    if (this.options.bracketedPaste) setup += ansi.bracketedPasteOn;
    if (this.options.focusEvents) setup += ansi.focusOn;
    if (this.options.title) setup += setTitle(this.options.title);
    // Only a fullscreen app owns the grid, so only a fullscreen app may wipe
    // it. An inline strip or a fixed region is a guest on somebody else's
    // screen and has no business clearing it.
    if (this.viewportMode.mode === "fullscreen") setup += ansi.clearScreen + ansi.cursorHome;
    this.write(setup);
    if (this.viewportMode.mode === "inline") this.reserveInline();

    if (this.input.isTTY && typeof this.input.setRawMode === "function") {
      this.input.setRawMode(true);
      this.rawWasSet = true;
    }
    this.input.resume?.();
    this.input.setEncoding?.("utf8");
    this.input.on("data", this.onData);
    this.output.on("resize", this.onResize);

    if (this.options.installExitHandlers) this.installExitHandlers();
  }

  /** Put the terminal back exactly as it was found. Safe to call twice. */
  restore(): void {
    if (!this.entered) return;
    this.entered = false;

    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    this.escapeTimer = null;
    this.input.off?.("data", this.onData);
    this.output.off?.("resize", this.onResize);
    if (this.rawWasSet && typeof this.input.setRawMode === "function") {
      this.input.setRawMode(false);
      this.rawWasSet = false;
    }
    this.input.pause?.();

    let teardown = ansi.reset;
    // An inline app leaves its last frame behind as part of the transcript, so
    // the cursor has to come out below it rather than on top of it.
    if (this.viewportMode.mode === "inline" && this.reserved > 0) {
      teardown = toAnchor() + "\r" + "\n".repeat(this.reserved) + teardown;
      this.reserved = 0;
    }
    if (this.options.focusEvents) teardown += ansi.focusOff;
    if (this.options.bracketedPaste) teardown += ansi.bracketedPasteOff;
    if (this.options.mouse) teardown += ansi.mouseOff;
    if (this.options.hideCursor) teardown += ansi.cursorShow;
    teardown += this.options.alternateScreen
      ? ansi.alternateScreenOff
      : this.viewportMode.mode === "inline" ? "" : `\n`;
    this.write(teardown);

    for (const off of this.cleanupHandlers) off();
    this.cleanupHandlers = [];
  }

  /**
   * Make room for an inline viewport and remember where it starts.
   *
   * There is no way to ask where the cursor is without a round trip the caller
   * would have to await, and no way to trust the answer afterwards -- any
   * output scrolls the screen and moves the strip without a word. So the
   * anchor is never a number: it is a saved cursor position, re-saved whenever
   * the strip moves.
   *
   * Printing the newlines first is what reserves the space. If the cursor was
   * near the bottom the terminal scrolls, which is exactly what should happen;
   * walking back up then lands on the strip's first row wherever it ended up.
   */
  private reserveInline(): void {
    const height = this.viewportRect().height;
    this.reserved = height;
    this.write("\r" + "\n".repeat(Math.max(0, height - 1)) + moveUp(height - 1) + "\r");
    this.write(anchor());
  }

  /**
   * Write lines above an inline viewport, permanently.
   *
   * This is the half of inline mode that makes it worth having: finished work
   * scrolls away into the user's scrollback while the live rows stay put. The
   * lines are printed where the strip currently begins and the strip is
   * re-anchored below them, so if that runs off the bottom the terminal scrolls
   * and the oldest lines leave through the top -- into scrollback, which is
   * where they were always going.
   *
   * The caller repaints the viewport afterwards: everything below the anchor is
   * now whatever the terminal happened to shift there.
   */
  insertBefore(lines: string[]): void {
    if (this.viewportMode.mode !== "inline" || lines.length === 0) return;
    const height = this.reserved;
    let out = toAnchor() + "\r";
    for (const line of lines) out += ansi.clearLine + line + ansi.reset + "\r\n";
    // Re-reserve from the new anchor, then walk back to it. Writing the rows
    // is what forces the terminal to scroll if the strip no longer fits, and
    // walking back afterwards finds it wherever the scroll left it.
    out += ansi.clearLine;
    for (let i = 1; i < height; i++) out += "\r\n" + ansi.clearLine;
    out += moveUp(height - 1) + "\r" + anchor();
    this.write(out);
  }

  onInput(listener: Listener<InputEvent>): () => void {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  onResizeEvent(listener: Listener<TerminalSize>): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  /**
   * Called when an exit handler tears the terminal down without the owner
   * asking. Whoever is driving a render loop has to know: the alternate screen
   * is gone, so anything it draws next lands in the user's live shell.
   */
  onTeardown(listener: () => void): () => void {
    this.teardownListeners.add(listener);
    return () => this.teardownListeners.delete(listener);
  }

  private installExitHandlers(): void {
    const restore = () => this.restore();

    const onSignal = (signal: NodeJS.Signals) => () => {
      restore();
      process.exit(signal === "SIGINT" ? 130 : 143);
    };
    const onExit = () => restore();
    // Restoring is not negotiable — a crash must not leave an unusable shell —
    // but deciding the process should die is the host's call, not a rendering
    // library's. If the embedding app installed its own handler, hand over once
    // the terminal is safe; only act as the last resort when nobody else will.
    const onError = (event: "uncaughtException" | "unhandledRejection") => (error: unknown) => {
      // Counted before restoring: `restore()` runs the cleanup handlers, and
      // those remove this very listener — so asking afterwards excludes us and
      // one host handler reads as none.
      const handedOver = process.listenerCount(event) > 1;
      restore();
      // Anything still rendering must stop, or it paints into the shell the
      // alternate screen just gave back.
      for (const listener of this.teardownListeners) listener();
      if (handedOver) return;
      // The terminal is usable again, so the stack trace is actually readable.
      console.error(error);
      process.exit(1);
    };
    const onUncaught = onError("uncaughtException");
    const onRejection = onError("unhandledRejection");

    const sigint = onSignal("SIGINT");
    const sigterm = onSignal("SIGTERM");
    const sighup = onSignal("SIGHUP");

    process.on("SIGINT", sigint);
    process.on("SIGTERM", sigterm);
    process.on("SIGHUP", sighup);
    process.on("exit", onExit);
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onRejection);

    this.cleanupHandlers.push(() => {
      process.off("SIGINT", sigint);
      process.off("SIGTERM", sigterm);
      process.off("SIGHUP", sighup);
      process.off("exit", onExit);
      process.off("uncaughtException", onUncaught);
      process.off("unhandledRejection", onRejection);
    });
  }
}

/**
 * Save the anchor an inline viewport measures from.
 *
 * The pen is reset first so that the saved graphic rendition is always the
 * default one. DECRC restores attributes along with the position, so without
 * that the colour in force at some arbitrary moment would come back with every
 * jump and quietly desynchronise the renderer's model of the terminal.
 */
function anchor(): string {
  return ansi.reset + ansi.cursorSave;
}

/**
 * Go back to the anchor, and immediately save it again.
 *
 * DECRC is a pop rather than a peek in some terminals: restore twice against
 * one save and the second sends the cursor home, which is the top of the
 * user's screen and not remotely where the viewport is. Re-arming after every
 * restore makes the sequence mean the same thing on both kinds.
 */
function toAnchor(): string {
  return ansi.cursorRestore + anchor();
}

export function createTerminal(options: TerminalOptions = {}): Terminal {
  return new Terminal(options);
}

/**
 * Last-resort cleanup for a process that lost its Terminal reference.
 * Safe to call from a signal handler or a REPL after a bad crash.
 */
export function emergencyRestore(output: NodeJS.WriteStream = process.stdout): void {
  output.write(
    ansi.reset + ansi.focusOff + ansi.bracketedPasteOff + ansi.mouseOff +
      ansi.cursorShow + ansi.alternateScreenOff,
  );
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(false);
  }
}
