import type { Surface, BorderStyle, Align, BoxOptions } from "./surface.ts";
import type { Style } from "./buffer.ts";
import type { Color } from "./color.ts";
import type { Theme } from "./theme.ts";
import type { Capabilities } from "./capabilities.ts";
import {
  type Constraint, type Rect, type Padding, type Size, inset, stack, solve, isEmpty,
} from "./layout.ts";
import { stringWidth, wrap } from "./unicode.ts";
import { BrailleCanvas } from "./graphics/braille.ts";
import * as W from "./widgets/index.ts";

export interface HitRegion {
  rect: Rect;
  onClick?: (x: number, y: number, button: string) => void;
  onScroll?: (delta: number) => void;
  onHover?: (x: number, y: number) => void;
}

export interface FocusRegistration {
  index: number;
  focused: boolean;
}

/** Per-frame services the builder needs from the app. */
export interface RenderContext {
  theme: Theme;
  capabilities: Capabilities;
  width: number;
  height: number;
  /** Frames drawn since start. */
  frame: number;
  /** Milliseconds since the app started. */
  elapsed: number;
  focusIndex: number;
  registerFocus(action?: () => void): FocusRegistration;
  hit(region: HitRegion): void;
  overlay(draw: (root: Surface) => void): void;
  invalidate(): void;
}

interface Child {
  constraint: Constraint;
  draw: (surface: Surface) => void;
}

export interface ContainerOptions {
  gap?: number;
  padding?: Padding;
  /** Size along the parent's main axis. */
  size?: Size;
  width?: Size;
  height?: Size;
  min?: number;
  max?: number;
  background?: Color;
}

export interface PanelOptions extends ContainerOptions {
  title?: string;
  titleAlign?: Align;
  titleColor?: Color;
  subtitle?: string;
  subtitleColor?: Color;
  footer?: string;
  border?: BorderStyle;
  borderColor?: Color;
  /** Draws the focused border color and joins the Tab order. */
  focusable?: boolean;
  focused?: boolean;
  scroll?: number;
}

export interface GridOptions extends ContainerOptions {
  columns?: Size[] | number;
  rows?: Size[] | number;
}

export interface CellOptions {
  colSpan?: number;
  rowSpan?: number;
}

/**
 * The builder. Every container collects its children first, then solves the
 * layout once and draws — which is why `"1fr"` works without a retained tree.
 */
export class Container {
  readonly surface: Surface;
  readonly ctx: RenderContext;
  readonly direction: "row" | "column";
  private children: Child[] = [];
  private gap: number;
  private inner: Surface;

  constructor(
    surface: Surface,
    ctx: RenderContext,
    direction: "row" | "column" = "column",
    options: ContainerOptions = {},
  ) {
    this.surface = surface;
    this.ctx = ctx;
    this.direction = direction;
    this.gap = options.gap ?? 0;
    this.inner = options.padding ? surface.inset(options.padding) : surface;
    if (options.background !== undefined) surface.fill({ bg: options.background });
  }

  get theme(): Theme {
    return this.surface.theme;
  }
  get width(): number {
    return this.inner.width;
  }
  get height(): number {
    return this.inner.height;
  }
  /** Width available to a child laid out along the main axis. */
  private get crossWidth(): number {
    return this.direction === "column" ? this.inner.width : this.inner.height;
  }

  private add(draw: (surface: Surface) => void, constraint: Constraint = {}): this {
    this.children.push({ draw, constraint });
    return this;
  }

  private sizeOf(o: ContainerOptions | undefined, fallback: Size, intrinsic?: number): Constraint {
    const explicit = o?.size ?? (this.direction === "column" ? o?.height : o?.width);
    if (explicit !== undefined) return { size: explicit, min: o?.min, max: o?.max, intrinsic };
    // Intrinsic sizes describe height. Along a row, a widget takes the space it is given.
    const size = this.direction === "row" ? "fill" : fallback;
    return { size, min: o?.min, max: o?.max, intrinsic };
  }

  /** Solve and draw. Called automatically for you by the app and by parents. */
  flush(): void {
    if (this.children.length === 0 || isEmpty(this.inner.rect)) return;
    const rects = stack(
      this.inner.rect,
      this.children.map((c) => c.constraint),
      this.direction,
      this.gap,
    );
    this.children.forEach((child, i) => {
      const rect = rects[i];
      if (!rect || isEmpty(rect)) return;
      child.draw(this.inner.region(rect));
    });
    this.children.length = 0;
  }

  // ---------------------------------------------------------------- layout

  /** A horizontal container. Children default to equal shares. */
  row(options: ContainerOptions = {}, build?: (row: Container) => void): this {
    return this.add((surface) => {
      const container = new Container(surface, this.ctx, "row", options);
      build?.(container);
      container.flush();
    }, this.sizeOf(options, "fill"));
  }

  /** A vertical container. */
  column(options: ContainerOptions = {}, build?: (column: Container) => void): this {
    return this.add((surface) => {
      const container = new Container(surface, this.ctx, "column", options);
      build?.(container);
      container.flush();
    }, this.sizeOf(options, "fill"));
  }

  /**
   * A CSS-ish grid. Children are placed in order and may span cells:
   *
   *   ui.grid({ columns: ["2fr", "1fr"], rows: [12, "1fr"] }, g => {
   *     g.panel({ title: "CPU" });
   *     g.panel({ title: "Memory", colSpan: 2 });
   *   });
   */
  grid(options: GridOptions = {}, build?: (grid: GridContainer) => void): this {
    return this.add((surface) => {
      const container = new GridContainer(surface, this.ctx, options);
      build?.(container);
      container.flush();
    }, this.sizeOf(options, "fill"));
  }

  /** A bordered panel. The callback receives its interior as a column. */
  panel(options: PanelOptions = {}, build?: (panel: Container) => void): this {
    const focus = options.focusable ? this.ctx.registerFocus() : undefined;
    return this.add((surface) => {
      const focused = options.focused ?? focus?.focused ?? false;
      const boxOptions: BoxOptions = {
        title: options.title,
        titleAlign: options.titleAlign,
        titleColor: options.titleColor,
        subtitle: options.subtitle,
        subtitleColor: options.subtitleColor,
        footer: options.footer,
        border: options.border ?? "rounded",
        borderColor: options.borderColor ?? (focused ? this.theme.borderFocused : this.theme.border),
        bg: options.background,
      };
      const interior = surface.box(boxOptions);
      const container = new Container(interior, this.ctx, "column", {
        gap: options.gap,
        padding: options.padding ?? [0, 1],
      });
      build?.(container);
      container.flush();
    }, this.sizeOf(options, "fill"));
  }

  /** A panel without a border — a grouping box that costs no rows. */
  box(options: PanelOptions = {}, build?: (box: Container) => void): this {
    return this.panel({ ...options, border: options.border ?? "none" }, build);
  }

  /** Blank space. */
  spacer(size: Size = "fill"): this {
    return this.add(() => {}, { size });
  }

  /** A horizontal rule, optionally labelled. */
  divider(options: W.DividerOptions = {}): this {
    return this.add((s) => W.drawDivider(s, options), { size: 1 });
  }

  // ------------------------------------------------------------------ text

  text(content: string, options: W.TextOptions & ContainerOptions = {}): this {
    const lines = options.wrap ? wrap(content, this.crossWidth).length : content.split("\n").length;
    return this.add((s) => W.drawText(s, content, options), this.sizeOf(options, "auto", lines));
  }

  /** Muted secondary text. */
  label(content: string, options: W.TextOptions & ContainerOptions = {}): this {
    return this.text(content, { fg: this.theme.muted, ...options });
  }

  /** Bold heading in the theme's title color. */
  heading(content: string, options: W.TextOptions & ContainerOptions = {}): this {
    return this.text(content, { fg: this.theme.title, bold: true, ...options });
  }

  badge(options: W.BadgeOptions & ContainerOptions): this {
    return this.add((s) => W.drawBadge(s, options), this.sizeOf(options, "auto", 1));
  }

  /** Aligned label/value pairs. */
  keyValues(rows: W.KeyValueRow[], options: Omit<W.KeyValueOptions, "rows"> & ContainerOptions = {}): this {
    return this.add((s) => W.drawKeyValues(s, { ...options, rows }), this.sizeOf(options, "auto", rows.length));
  }

  // ------------------------------------------------------------------ data

  table<Row>(options: W.TableOptions<Row> & ContainerOptions): this {
    const intrinsic = options.rows.length + (options.header === false ? 0 : 1);
    return this.add((s) => W.drawTable(s, options), this.sizeOf(options, "fill", intrinsic));
  }

  list(options: W.ListOptions & ContainerOptions): this {
    return this.add((s) => W.drawList(s, options), this.sizeOf(options, "fill", options.items.length));
  }

  tree(options: W.TreeOptions & ContainerOptions): this {
    return this.add((s) => W.drawTree(s, options), this.sizeOf(options, "fill"));
  }

  log(options: W.LogOptions & ContainerOptions): this {
    return this.add((s) => W.drawLog(s, options), this.sizeOf(options, "fill", options.entries.length));
  }

  // --------------------------------------------------------------- metrics

  /** `label ████████░░░ 42%` */
  meter(options: W.MeterOptions & ContainerOptions): this {
    return this.add((s) => W.drawMeter(s, options), this.sizeOf(options, "auto", 1));
  }

  /** A stack or grid of meters. */
  meters(items: W.MetersOptions["items"], options: Omit<W.MetersOptions, "items"> & ContainerOptions = {}): this {
    const columns = Math.max(1, options.columns ?? 1);
    const rows = Math.ceil(items.length / columns);
    return this.add((s) => W.drawMeters(s, { ...options, items }), this.sizeOf(options, "auto", rows));
  }

  progress(options: W.ProgressOptions & ContainerOptions): this {
    return this.add((s) => W.drawProgress(s, options), this.sizeOf(options, "auto", 1));
  }

  /** Braille line/area graph. Fills the space it is given. */
  graph(options: W.GraphOptions & ContainerOptions): this {
    return this.add((s) => W.drawGraph(s, options), this.sizeOf(options, "fill"));
  }

  /** A filled area graph — `graph` with `fill` on. */
  areaGraph(options: W.GraphOptions & ContainerOptions): this {
    return this.graph({ fill: true, ...options });
  }

  /** Several series on one set of axes. */
  multiGraph(series: W.GraphOptions["series"], options: Omit<W.GraphOptions, "series"> & ContainerOptions = {}): this {
    return this.graph({ ...options, series });
  }

  sparkline(options: W.SparklineOptions & ContainerOptions): this {
    return this.add((s) => W.drawSparklineWidget(s, options), this.sizeOf(options, "auto", 1));
  }

  histogram(options: W.ColumnsOptions & ContainerOptions): this {
    return this.add((s) => W.drawColumns(s, options), this.sizeOf(options, "fill"));
  }

  /** A semicircular dial. Wants at least 9x5. */
  gauge(options: W.GaugeOptions & ContainerOptions): this {
    return this.add((s) => W.drawGauge(s, options), this.sizeOf(options, "fill"));
  }

  donut(options: W.DonutOptions & ContainerOptions): this {
    return this.add((s) => W.drawDonut(s, options), this.sizeOf(options, "fill"));
  }

  /** Segmented temperature-style bar. */
  heatBar(options: W.HeatBarOptions & ContainerOptions): this {
    return this.add((s) => W.drawHeatBar(s, options), this.sizeOf(options, "auto", 1));
  }

  // ---------------------------------------------------------------- inputs

  /** A button. Pass `onPress` and it joins the Tab order automatically. */
  button(options: W.ButtonOptions & ContainerOptions & { onPress?: () => void }): this {
    const focus = this.ctx.registerFocus(options.onPress);
    return this.add((s) => {
      W.drawButton(s, { ...options, focused: options.focused ?? focus.focused });
      this.ctx.hit({ rect: s.hitRect(), onClick: () => options.onPress?.() });
    }, this.sizeOf(options, "auto", 1));
  }

  /** A row of buttons, sized to their labels. */
  buttons(
    items: (W.ButtonOptions & { onPress?: () => void })[],
    options: ContainerOptions & { align?: Align } = {},
  ): this {
    return this.row({ ...options, size: options.size ?? 1 }, (row) => {
      if (options.align === "right") row.spacer("fill");
      items.forEach((item) => {
        row.button({ ...item, width: stringWidth(item.label) + 2, size: stringWidth(item.label) + 2 });
        row.spacer(2);
      });
      if (options.align !== "right") row.spacer("fill");
    });
  }

  checkbox(options: W.CheckboxOptions & ContainerOptions & { onToggle?: () => void }): this {
    const focus = this.ctx.registerFocus(options.onToggle);
    return this.add((s) => {
      W.drawCheckbox(s, { ...options, focused: options.focused ?? focus.focused });
      this.ctx.hit({ rect: s.hitRect(), onClick: () => options.onToggle?.() });
    }, this.sizeOf(options, "auto", 1));
  }

  select(options: W.SelectOptions & ContainerOptions & { onOpen?: () => void }): this {
    const focus = this.ctx.registerFocus(options.onOpen);
    return this.add((s) => {
      W.drawSelect(s, { ...options, focused: options.focused ?? focus.focused });
      this.ctx.hit({ rect: s.hitRect(), onClick: () => options.onOpen?.() });
    }, this.sizeOf(options, "auto", options.open ? (options.options?.length ?? 0) + 1 : 1));
  }

  textInput(options: W.TextInputOptions & ContainerOptions): this {
    const focus = this.ctx.registerFocus();
    return this.add(
      (s) => W.drawTextInput(s, { ...options, focused: options.focused ?? focus.focused }),
      this.sizeOf(options, "auto", 1),
    );
  }

  tabs(options: W.TabsOptions & ContainerOptions & { onSelect?: (index: number) => void }): this {
    return this.add((s) => {
      W.drawTabs(s, options);
      if (options.onSelect) {
        let x = 0;
        options.tabs.forEach((tab, i) => {
          const w = stringWidth(tab) + 4;
          const r = s.hitRect();
          this.ctx.hit({
            rect: { x: r.x + x, y: r.y, width: w, height: 1 },
            onClick: () => options.onSelect?.(i),
          });
          x += w;
        });
      }
    }, this.sizeOf(options, "auto", 1));
  }

  statusBar(options: W.StatusBarOptions & ContainerOptions): this {
    return this.add((s) => W.drawStatusBar(s, options), this.sizeOf(options, "auto", 1));
  }

  // -------------------------------------------------------------- overlays

  /** A centred dialog drawn above everything else this frame. */
  modal(options: W.ModalOptions, build?: (modal: Container) => void): this {
    this.ctx.overlay((root) => {
      const inner = W.drawModal(root, options);
      if (build) {
        const container = new Container(inner, this.ctx, "column", { padding: [1, 1] });
        build(container);
        container.flush();
      }
    });
    return this;
  }

  commandPalette(options: W.CommandPaletteOptions): this {
    this.ctx.overlay((root) => W.drawCommandPalette(root, options));
    return this;
  }

  tooltip(options: W.TooltipOptions): this {
    this.ctx.overlay((root) => W.drawTooltip(root, options));
    return this;
  }

  // --------------------------------------------------------- escape hatches

  /** Draw straight onto the framebuffer region. Nothing is off limits. */
  draw(fn: (surface: Surface) => void, options: ContainerOptions = {}): this {
    return this.add(fn, this.sizeOf(options, "fill"));
  }

  /** A Braille pixel canvas sized to the region, blitted when you are done. */
  canvas(
    fn: (canvas: BrailleCanvas, surface: Surface) => void,
    options: ContainerOptions & { color?: Color } = {},
  ): this {
    return this.add((surface) => {
      const canvas = new BrailleCanvas(surface.width, surface.height);
      fn(canvas, surface);
      const color = options.color ?? this.theme.accent;
      for (let row = 0; row < canvas.rows; row++) {
        for (let col = 0; col < canvas.cols; col++) {
          const value = canvas.cell(col, row);
          if (value !== 0) surface.char(col, row, value, { fg: color });
        }
      }
    }, this.sizeOf(options, "fill"));
  }

  /**
   * Pick a layout by available width:
   *   ui.responsive({ 120: wide, 80: medium, 0: compact });
   */
  responsive(breakpoints: Record<number, (ui: Container) => void>): this {
    const widths = Object.keys(breakpoints)
      .map(Number)
      .sort((a, b) => b - a);
    const chosen = widths.find((w) => this.width >= w) ?? widths[widths.length - 1];
    breakpoints[chosen]?.(this);
    return this;
  }

  /** Run `build` only when the container is at least this wide. */
  when(condition: boolean, build: (ui: Container) => void): this {
    if (condition) build(this);
    return this;
  }
}

/** Grid placement with spans. Cells are filled row-major. */
export class GridContainer {
  private surface: Surface;
  private ctx: RenderContext;
  private options: GridOptions;
  private cells: { options: PanelOptions & CellOptions; draw: (surface: Surface) => void }[] = [];

  constructor(surface: Surface, ctx: RenderContext, options: GridOptions) {
    this.surface = options.padding ? surface.inset(options.padding) : surface;
    this.ctx = ctx;
    this.options = options;
  }

  get theme(): Theme {
    return this.surface.theme;
  }

  private track(spec: Size[] | number | undefined, fallback: number): Size[] {
    if (Array.isArray(spec)) return spec;
    const count = spec ?? fallback;
    return new Array(Math.max(1, count)).fill("1fr");
  }

  private push(options: PanelOptions & CellOptions, draw: (surface: Surface) => void): this {
    this.cells.push({ options, draw });
    return this;
  }

  /** A panel occupying the next free cell (or several, with colSpan/rowSpan). */
  panel(options: PanelOptions & CellOptions = {}, build?: (panel: Container) => void): this {
    return this.push(options, (surface) => {
      const container = new Container(surface, this.ctx, "column");
      container.panel(options, build);
      container.flush();
    });
  }

  cell(options: CellOptions & ContainerOptions = {}, build?: (cell: Container) => void): this {
    return this.push(options, (surface) => {
      const container = new Container(surface, this.ctx, "column", options);
      build?.(container);
      container.flush();
    });
  }

  row(options: CellOptions & ContainerOptions = {}, build?: (row: Container) => void): this {
    return this.push(options, (surface) => {
      const container = new Container(surface, this.ctx, "row", options);
      build?.(container);
      container.flush();
    });
  }

  flush(): void {
    if (this.cells.length === 0 || isEmpty(this.surface.rect)) return;
    const gap = this.options.gap ?? 0;
    const columnSpec = this.track(this.options.columns, Math.min(this.cells.length, 3));
    const rowCount = Array.isArray(this.options.rows)
      ? this.options.rows.length
      : (this.options.rows ?? Math.ceil(this.cells.length / columnSpec.length));
    const rowSpec = this.track(this.options.rows, rowCount);

    const colWidths = solve(this.surface.width, columnSpec.map((size) => ({ size })), gap);
    const rowHeights = solve(this.surface.height, rowSpec.map((size) => ({ size })), gap);

    const occupied = new Set<string>();
    let cursor = 0;

    for (const cell of this.cells) {
      const colSpan = Math.max(1, cell.options.colSpan ?? 1);
      const rowSpan = Math.max(1, cell.options.rowSpan ?? 1);

      // Find the next free slot that fits the span.
      let placed = false;
      while (!placed && cursor < colWidths.length * rowHeights.length + colWidths.length) {
        const col = cursor % colWidths.length;
        const row = Math.floor(cursor / colWidths.length);
        if (row >= rowHeights.length) break;
        let free = col + colSpan <= colWidths.length;
        if (free) {
          for (let r = row; r < row + rowSpan && free; r++) {
            for (let c = col; c < col + colSpan && free; c++) {
              if (occupied.has(`${c},${r}`)) free = false;
            }
          }
        }
        if (!free) {
          cursor++;
          continue;
        }
        for (let r = row; r < row + rowSpan; r++) {
          for (let c = col; c < col + colSpan; c++) occupied.add(`${c},${r}`);
        }

        let x = this.surface.rect.x;
        for (let c = 0; c < col; c++) x += colWidths[c] + gap;
        let y = this.surface.rect.y;
        for (let r = 0; r < row; r++) y += rowHeights[r] + gap;
        let width = 0;
        for (let c = col; c < col + colSpan && c < colWidths.length; c++) width += colWidths[c] + gap;
        width = Math.max(0, width - gap);
        let height = 0;
        for (let r = row; r < row + rowSpan && r < rowHeights.length; r++) height += rowHeights[r] + gap;
        height = Math.max(0, height - gap);

        const rect: Rect = { x, y, width, height };
        if (!isEmpty(rect)) cell.draw(this.surface.region(rect));
        placed = true;
        cursor++;
      }
    }
    this.cells.length = 0;
  }
}
