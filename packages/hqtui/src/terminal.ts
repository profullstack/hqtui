import { ansi, setTitle } from "./ansi.ts";
import { type Capabilities, type CapabilityOverrides, detectCapabilities } from "./capabilities.ts";
import { InputParser, type InputEvent } from "./input.ts";

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
  private options: Required<Omit<TerminalOptions, "capabilities" | "title" | "input" | "output" | "escapeTimeout">> & { title?: string };
  private parser = new InputParser();
  private entered = false;
  /** Milliseconds to wait before deciding a lone ESC was the Escape key. */
  readonly escapeTimeout: number;
  private rawWasSet = false;
  private inputListeners = new Set<Listener<InputEvent>>();
  private resizeListeners = new Set<Listener<TerminalSize>>();
  private cleanupHandlers: (() => void)[] = [];
  private escapeTimer: NodeJS.Timeout | null = null;
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
    this.options = {
      alternateScreen: options.alternateScreen ?? true,
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
    setup += ansi.clearScreen + ansi.cursorHome;
    this.write(setup);

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
    if (this.options.focusEvents) teardown += ansi.focusOff;
    if (this.options.bracketedPaste) teardown += ansi.bracketedPasteOff;
    if (this.options.mouse) teardown += ansi.mouseOff;
    if (this.options.hideCursor) teardown += ansi.cursorShow;
    teardown += this.options.alternateScreen ? ansi.alternateScreenOff : `\n`;
    this.write(teardown);

    for (const off of this.cleanupHandlers) off();
    this.cleanupHandlers = [];
  }

  onInput(listener: Listener<InputEvent>): () => void {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  onResizeEvent(listener: Listener<TerminalSize>): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  private installExitHandlers(): void {
    const restore = () => this.restore();

    const onSignal = (signal: NodeJS.Signals) => () => {
      restore();
      process.exit(signal === "SIGINT" ? 130 : 143);
    };
    const onExit = () => restore();
    const onError = (error: unknown) => {
      restore();
      // The terminal is usable again, so the stack trace is actually readable.
      console.error(error);
      process.exit(1);
    };

    const sigint = onSignal("SIGINT");
    const sigterm = onSignal("SIGTERM");
    const sighup = onSignal("SIGHUP");

    process.on("SIGINT", sigint);
    process.on("SIGTERM", sigterm);
    process.on("SIGHUP", sighup);
    process.on("exit", onExit);
    process.on("uncaughtException", onError);
    process.on("unhandledRejection", onError);

    this.cleanupHandlers.push(() => {
      process.off("SIGINT", sigint);
      process.off("SIGTERM", sigterm);
      process.off("SIGHUP", sighup);
      process.off("exit", onExit);
      process.off("uncaughtException", onError);
      process.off("unhandledRejection", onError);
    });
  }
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
