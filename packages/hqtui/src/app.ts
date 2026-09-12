import { FrameBuffer } from "./buffer.ts";
import { Encoder, encodeRows } from "./diff.ts";
import { ansi } from "./ansi.ts";
import { Terminal, type TerminalOptions, emergencyRestore } from "./terminal.ts";
import type { Capabilities } from "./capabilities.ts";
import { type Theme, type ThemeName, resolveTheme, themes } from "./theme.ts";
import { Surface, createSurface } from "./surface.ts";
import { Container, countClicks, dispatchHit, type RenderContext, type HitRegion, type FocusRegistration } from "./ui.ts";
import type { InputEvent, KeyEvent, MouseEvent, PasteEvent, FocusEvent } from "./input.ts";
import { matchKey } from "./input.ts";

export interface AppOptions extends TerminalOptions {
  /** Theme object or built-in name. Defaults to the dark theme. */
  theme?: Theme | ThemeName | string;
  /** Cap on frames per second. Default 30, or 15 over SSH. */
  fps?: number;
  /** Frame cap when an SSH session is detected. Default 15. */
  remoteFps?: number;
  /** Redraw every tick instead of only when invalidated. Default false. */
  alwaysRender?: boolean;
  /** Keys that quit. Default ctrl+c and q. Pass [] to handle quitting yourself. */
  quitKeys?: string[];
  /** Tab/Shift+Tab move focus. Default true. */
  focusNavigation?: boolean;
  /** Paint the theme background across the whole screen. Default true. */
  paintBackground?: boolean;
  /**
   * Merge the borders of adjacent panels into shared lines, the way CSS
   * collapses table borders. Default false, because it changes every layout
   * with two panels side by side; turn it on once, for the whole screen.
   */
  collapseBorders?: boolean;
  /** Drain color, for accessibility or NO_COLOR. */
  monochrome?: boolean;
  /** Skip animation-driven redraws. */
  reducedMotion?: boolean;
}

export interface RenderArgs {
  ui: Container;
  theme: Theme;
  capabilities: Capabilities;
  width: number;
  height: number;
  frame: number;
  /** Milliseconds since start. */
  elapsed: number;
  focus: number;
  app: App;
}

export type RenderFn = (args: RenderArgs) => void;

export interface FrameStats {
  frame: number;
  /** Time spent building + diffing + writing, in milliseconds. */
  renderMs: number;
  changedCells: number;
  dirtyRows: number;
  bytes: number;
  fps: number;
}

type EventMap = {
  key: KeyEvent;
  mouse: MouseEvent;
  paste: PasteEvent;
  focus: FocusEvent;
  resize: { width: number; height: number };
  frame: FrameStats;
  exit: void;
};

/**
 * The application: owns the terminal, both framebuffers, the scheduler and the
 * event loop. Everything else in the library is reachable from here.
 */
export class App {
  readonly terminal: Terminal;
  readonly capabilities: Capabilities;
  theme: Theme;

  private current: FrameBuffer;
  private previous: FrameBuffer;
  private encoder: Encoder;
  private renderFn: RenderFn = () => {};
  private options: AppOptions;
  private listeners = new Map<keyof EventMap, Set<(value: never) => void>>();

  private running = false;
  private dirty = true;
  private forceRepaint = true;
  private timer: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private frameCount = 0;
  private lastFrameAt = 0;
  private exitResolve: (() => void) | null = null;
  /** Terminal subscriptions, released on stop so a restart does not double them. */
  private subscriptions: (() => void)[] = [];

  private focusIndex = 0;
  private focusCount = 0;
  private focusActions: (() => void)[] = [];
  private hits: HitRegion[] = [];
  private overlays: ((root: Surface) => void)[] = [];
  private lastStats: FrameStats = { frame: 0, renderMs: 0, changedCells: 0, dirtyRows: 0, bytes: 0, fps: 0 };

  constructor(options: AppOptions = {}) {
    this.options = options;
    this.terminal = new Terminal(options);
    this.capabilities = this.terminal.capabilities;
    this.theme = resolveTheme(options.theme);

    const rect = this.terminal.viewportRect();
    this.current = new FrameBuffer(rect.width, rect.height);
    this.previous = new FrameBuffer(rect.width, rect.height);
    this.encoder = new Encoder({
      colors: this.capabilities.colors,
      monochrome: options.monochrome ?? this.capabilities.colors === "none",
      origin: { x: rect.x, y: rect.y },
      relative: this.terminal.viewport.mode === "inline",
    });
  }

  get width(): number {
    return this.current.width;
  }
  get height(): number {
    return this.current.height;
  }
  /** Stats for the most recent frame. */
  get stats(): FrameStats {
    return this.lastStats;
  }

  /** Register the view. Called on every frame; keep it pure and cheap. */
  render(fn: RenderFn): this {
    this.renderFn = fn;
    this.dirty = true;
    return this;
  }

  /** Ask for a redraw. The scheduler coalesces repeated calls into one frame. */
  invalidate(): void {
    this.dirty = true;
  }

  /** Force a full repaint, e.g. after another process wrote to the terminal. */
  redraw(): void {
    this.forceRepaint = true;
    this.dirty = true;
  }

  setTheme(theme: Theme | ThemeName | string): this {
    this.theme = resolveTheme(theme);
    this.redraw();
    return this;
  }

  /** Whether adjacent panel borders are being merged. */
  get collapseBorders(): boolean {
    return this.options.collapseBorders ?? false;
  }

  /**
   * Turn collapsed borders on or off while running, so a keybinding can show
   * what the flag does. It changes the layout, not just the glyphs, so this
   * forces a full repaint rather than a diff against the old geometry.
   */
  setCollapseBorders(value: boolean): this {
    this.options = { ...this.options, collapseBorders: value };
    this.redraw();
    return this;
  }

  on<K extends keyof EventMap>(event: K, listener: (value: EventMap[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (value: never) => void);
    return () => set!.delete(listener as (value: never) => void);
  }

  private emit<K extends keyof EventMap>(event: K, value: EventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) (listener as (v: EventMap[K]) => void)(value);
  }

  /** Move keyboard focus. Wraps around. */
  focusNext(delta = 1): void {
    if (this.focusCount === 0) return;
    this.focusIndex = (this.focusIndex + delta + this.focusCount) % this.focusCount;
    this.dirty = true;
  }

  /** Activate the focused control, as Enter does. */
  activateFocused(): void {
    this.focusActions[this.focusIndex]?.();
    this.dirty = true;
  }

  /**
   * Write `height` rows into the terminal's scrollback, above the live view.
   *
   * This is what an inline app is for. The live rows stay where they are and
   * keep redrawing; what you pass here scrolls away above them and is still
   * there when the process exits, which is how `npm`, `cargo` and every
   * installer behave and what the alternate screen can never do.
   *
   *   app.insertBefore(1, ui => ui.text("compiled in 1.2s", { fg: theme.success }));
   *
   * It is a no-op for a fullscreen or fixed viewport, where there is no "above"
   * to write into -- the app owns every row it can see.
   */
  insertBefore(height: number, draw: (ui: Container) => void): void {
    if (this.terminal.viewport.mode !== "inline" || height <= 0) return;
    const width = this.current.width;
    if (width <= 0) return;

    const buffer = new FrameBuffer(width, height);
    // No background: these lines join the user's terminal, and a block of
    // theme colour across their scrollback is not ours to paint.
    buffer.clear(undefined, this.theme.foreground);
    const surface = createSurface(buffer, this.theme);
    const container = new Container(surface, this.scrollbackContext(), "column");
    draw(container);
    container.flush();

    this.terminal.insertBefore(encodeRows(buffer, {
      colors: this.capabilities.colors,
      monochrome: this.options.monochrome ?? this.capabilities.colors === "none",
    }));
    // Everything below the anchor is now whatever the terminal shifted there.
    this.forceRepaint = true;
    this.dirty = true;
    this.frame();
  }

  /**
   * A render context for lines that are printed once and never redrawn.
   *
   * Scrollback is not interactive: it cannot take focus, a click cannot reach
   * it, and nothing about it can ask for another frame -- by the time anyone
   * looks, it has scrolled away.
   */
  private scrollbackContext(): RenderContext {
    return {
      theme: this.theme,
      capabilities: this.capabilities,
      width: this.current.width,
      height: 0,
      frame: this.frameCount,
      elapsed: Date.now() - this.startedAt,
      focusIndex: -1,
      collapseBorders: this.options.collapseBorders ?? false,
      registerFocus: () => ({ index: -1, focused: false }),
      hit: () => {},
      overlay: () => {},
      invalidate: () => {},
    };
  }

  /** Start the loop. Resolves when the app exits. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    this.terminal.enter();

    // Kept so `stop()` can release them. `Terminal.restore()` detaches from the
    // stream but keeps its listener sets, so discarding these meant a second
    // `start()` handled every keystroke twice, and again for every restart.
    // If an exit handler tears the terminal down and hands the decision to the
    // host, the render loop must not keep drawing into the restored shell.
    this.subscriptions.push(this.terminal.onTeardown(() => this.stop()));
    this.subscriptions.push(this.terminal.onInput((event) => this.handleInput(event)));
    this.subscriptions.push(this.terminal.onResizeEvent(() => {
      const rect = this.terminal.viewportRect();
      this.current.resize(rect.width, rect.height);
      this.previous.resize(rect.width, rect.height);
      this.encoder.origin = { x: rect.x, y: rect.y };
      this.forceRepaint = true;
      this.dirty = true;
      this.emit("resize", { width: rect.width, height: rect.height });
      this.frame();
    }));

    const fps = this.targetFps();
    const interval = Math.max(8, Math.floor(1000 / fps));
    this.frame();
    this.timer = setInterval(() => {
      if (this.options.alwaysRender || this.dirty) this.frame();
    }, interval);
    this.timer.unref?.();

    await new Promise<void>((resolve) => {
      this.exitResolve = resolve;
    });
  }

  private targetFps(): number {
    const base = this.options.fps ?? 30;
    if (this.capabilities.ssh) return Math.min(base, this.options.remoteFps ?? 15);
    return base;
  }

  /** Stop the loop and restore the terminal. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const off of this.subscriptions) off();
    this.subscriptions = [];
    this.terminal.restore();
    this.emit("exit", undefined);
    this.exitResolve?.();
    this.exitResolve = null;
  }

  /** Alias for `stop()`, matching what users type in their key handlers. */
  quit(): void {
    this.stop();
  }

  private handleInput(event: InputEvent): void {
    if (event.type === "key") {
      const quitKeys = this.options.quitKeys ?? ["ctrl+c", "q"];
      if (quitKeys.some((k) => matchKey(event, k))) {
        this.emit("key", event);
        this.stop();
        return;
      }
      if (this.options.focusNavigation !== false) {
        if (event.name === "tab") {
          this.focusNext(event.shift ? -1 : 1);
        } else if (event.name === "enter" || event.name === "space") {
          this.activateFocused();
        }
      }
      this.emit("key", event);
      this.dirty = true;
      return;
    }
    if (event.type === "mouse") {
      const counted = this.countPress(event);
      this.dispatchMouse(counted);
      this.emit("mouse", counted);
      return;
    }
    if (event.type === "paste") {
      this.emit("paste", event);
      this.dirty = true;
      return;
    }
    this.emit("focus", event);
  }

  private lastPress: { at: number; x: number; y: number; button: string; clicks: number } | null = null;

  /** The parser reports one press at a time; a double-click is two of them close together. */
  private countPress(event: MouseEvent): MouseEvent {
    if (event.action !== "press") return event;
    const press = { at: Date.now(), x: event.x, y: event.y, button: event.button };
    const clicks = countClicks(this.lastPress, press);
    this.lastPress = { ...press, clicks };
    return { ...event, clicks };
  }

  private dispatchMouse(event: MouseEvent): void {
    if (dispatchHit(this.hits, event)) this.dirty = true;
  }

  /** Build one frame and push the difference to the terminal. */
  frame(): FrameStats {
    const started = performance.now();
    this.dirty = false;

    const rect = this.terminal.viewportRect();
    if (rect.width !== this.current.width || rect.height !== this.current.height) {
      this.current.resize(rect.width, rect.height);
      this.previous.resize(rect.width, rect.height);
      this.encoder.origin = { x: rect.x, y: rect.y };
      this.forceRepaint = true;
    }

    this.current.clear(this.options.paintBackground === false ? undefined : this.theme.background, this.theme.foreground);
    this.hits = [];
    this.overlays = [];
    this.focusActions = [];
    let focusCursor = 0;

    const ctx: RenderContext = {
      theme: this.theme,
      capabilities: this.capabilities,
      width: this.current.width,
      height: this.current.height,
      frame: this.frameCount,
      elapsed: Date.now() - this.startedAt,
      focusIndex: this.focusIndex,
      collapseBorders: this.options.collapseBorders ?? false,
      registerFocus: (action?: () => void): FocusRegistration => {
        const index = focusCursor++;
        if (action) this.focusActions[index] = action;
        return { index, focused: index === this.focusIndex };
      },
      hit: (region) => this.hits.push(region),
      overlay: (draw) => this.overlays.push(draw),
      invalidate: () => this.invalidate(),
    };

    const root = createSurface(this.current, this.theme);
    const container = new Container(root, ctx, "column");
    this.renderFn({
      ui: container,
      theme: this.theme,
      capabilities: this.capabilities,
      width: this.current.width,
      height: this.current.height,
      frame: this.frameCount,
      elapsed: ctx.elapsed,
      focus: this.focusIndex,
      app: this,
    });
    container.flush();
    for (const overlay of this.overlays) overlay(root);

    this.focusCount = Math.max(focusCursor, 0);
    if (this.focusCount > 0 && this.focusIndex >= this.focusCount) this.focusIndex = 0;

    const result = this.encoder.encode(this.previous, this.current, this.forceRepaint);
    this.forceRepaint = false;

    let output = result.output;
    if (output.length > 0) {
      // An inline viewport measures everything from its own top-left, so the
      // cursor has to be put there before the frame rather than assumed to be
      // wherever the last one finished.
      if (this.encoder.relative) output = ansi.cursorRestore + ansi.cursorSave + "\r" + output;
      if (this.capabilities.synchronizedOutput) output = ansi.beginSync + output + ansi.endSync;
      this.terminal.write(output);
    }
    this.previous.copyFrom(this.current);

    const now = performance.now();
    const stats: FrameStats = {
      frame: this.frameCount++,
      renderMs: now - started,
      changedCells: result.changedCells,
      dirtyRows: result.dirtyRows,
      bytes: output.length,
      fps: this.lastFrameAt ? 1000 / Math.max(1, now - this.lastFrameAt) : 0,
    };
    this.lastFrameAt = now;
    this.lastStats = stats;
    this.emit("frame", stats);
    return stats;
  }
}

/**
 * Create an app. Every option has a sensible default: dark theme, mouse on,
 * 30fps, alternate screen, terminal restored no matter how the process dies.
 *
 *   const app = await createApp();
 *   app.render(({ ui }) => ui.panel({ title: "Hello" }, p => p.text("Hi")));
 *   await app.start();
 */
export async function createApp(options: AppOptions = {}): Promise<App> {
  return new App(options);
}

export { emergencyRestore, themes };
