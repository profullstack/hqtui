import { FrameBuffer } from "./buffer.ts";
import { Encoder } from "./diff.ts";
import { ansi } from "./ansi.ts";
import { Terminal, type TerminalOptions, emergencyRestore } from "./terminal.ts";
import type { Capabilities } from "./capabilities.ts";
import { type Theme, type ThemeName, resolveTheme, themes } from "./theme.ts";
import { Surface, createSurface } from "./surface.ts";
import { Container, type RenderContext, type HitRegion, type FocusRegistration } from "./ui.ts";
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

    const { columns, rows } = this.terminal.size();
    this.current = new FrameBuffer(columns, rows);
    this.previous = new FrameBuffer(columns, rows);
    this.encoder = new Encoder({
      colors: this.capabilities.colors,
      monochrome: options.monochrome ?? this.capabilities.colors === "none",
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
    this.subscriptions.push(this.terminal.onResizeEvent(({ columns, rows }) => {
      this.current.resize(columns, rows);
      this.previous.resize(columns, rows);
      this.forceRepaint = true;
      this.dirty = true;
      this.emit("resize", { width: columns, height: rows });
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
      this.dispatchMouse(event);
      this.emit("mouse", event);
      return;
    }
    if (event.type === "paste") {
      this.emit("paste", event);
      this.dirty = true;
      return;
    }
    this.emit("focus", event);
  }

  private dispatchMouse(event: MouseEvent): void {
    // Later regions are drawn on top, so hit-test in reverse.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const hit = this.hits[i];
      const r = hit.rect;
      if (event.x < r.x || event.y < r.y || event.x >= r.x + r.width || event.y >= r.y + r.height) continue;
      if (event.action === "scroll") hit.onScroll?.(event.scroll);
      else if (event.action === "press") hit.onClick?.(event.x - r.x, event.y - r.y, event.button);
      else if (event.action === "move") hit.onHover?.(event.x - r.x, event.y - r.y);
      this.dirty = true;
      return;
    }
  }

  /** Build one frame and push the difference to the terminal. */
  frame(): FrameStats {
    const started = performance.now();
    this.dirty = false;

    const size = this.terminal.size();
    if (size.columns !== this.current.width || size.rows !== this.current.height) {
      this.current.resize(size.columns, size.rows);
      this.previous.resize(size.columns, size.rows);
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
