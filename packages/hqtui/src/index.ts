/**
 * HQTUI — High Quality Terminal UI for TypeScript.
 *
 *   import { createApp } from "@profullstack/hqtui";
 *
 *   const app = await createApp();
 *   app.render(({ ui }) => {
 *     ui.panel({ title: "Hello" }, panel => panel.text("Hello, terminal."));
 *   });
 *   await app.start();
 *
 * Dark theme, mouse, truecolor, resize handling and terminal restoration are
 * all on by default. https://hqtui.com
 */

export { App, createApp, type AppOptions, type RenderArgs, type RenderFn, type FrameStats } from "./app.ts";
export { Container, GridContainer } from "./ui.ts";
export type {
  RenderContext, ContainerOptions, PanelOptions, GridOptions, CellOptions, HitRegion,
} from "./ui.ts";

// Terminal + capabilities
export {
  Terminal, createTerminal, emergencyRestore,
  type TerminalOptions, type TerminalSize, type Viewport, type Rect as ViewportRect,
} from "./terminal.ts";
export { detectCapabilities, type Capabilities, type ColorDepth, type CapabilityOverrides } from "./capabilities.ts";

// Rendering core
export { FrameBuffer, Attr, type Style, type Attributes } from "./buffer.ts";
export { Encoder, encodeFull, type EncodeResult } from "./diff.ts";
export {
  Surface, createSurface, BORDERS, resolveSides,
  type BorderStyle, type BoxOptions, type Align, type Side, type Sides,
} from "./surface.ts";
export { ansi, stripAnsi, moveTo, setTitle } from "./ansi.ts";

// Color
export {
  rgb, hex, ansi256, gradient, gradientSteps, mix, alpha, lighten, darken, grayscale,
  luminance, contrast, to256, to16, from256, DEFAULT_COLOR, type Color,
} from "./color.ts";

// Theme
export {
  themes, themeList, defineTheme, resolveTheme, elevate, heatColor, seriesColor,
  type Theme, type ThemeName,
} from "./theme.ts";

// Layout
export {
  solve, stack, inset, intersect, contains, isEmpty, fixed, percent, flex, auto, fill,
  remaining, minmax, normalizePadding, distribute,
  type Rect, type Size, type Constraint, type Padding, type Justify,
} from "./layout.ts";

// Input
export { InputParser, matchKey, type InputEvent, type KeyEvent, type MouseEvent, type PasteEvent, type FocusEvent } from "./input.ts";

// Text
export { stringWidth, truncate, fit, wrap, graphemes, charWidth } from "./unicode.ts";
export {
  isRich, spanStyle, spanText, spanWidth, toSpanLines,
  truncateSpans, fitSpans, wrapSpans, wrapRich,
  type Span, type SpanLine, type RichText,
} from "./richtext.ts";

// Graphics
export { BrailleCanvas } from "./graphics/braille.ts";
export {
  plot, blit, sparkline, bar, gauge, donut, histogram,
  verticalGlyph, horizontalGlyph, shadeGlyph, bestMode,
  plotPoints, domainOf, drawCanvas, projection,
  type Series, type PlotOptions, type FillMode,
  type Point, type MarkType, type ChartSeries, type AxisOptions, type ChartPlotOptions,
  type Domain, type Shape, type Bounds, type CanvasOptions, type Projection,
} from "./graphics/index.ts";

// Widgets (for drawing straight onto a Surface)
export * as widgets from "./widgets/index.ts";

// Headless rendering + testing
export { renderToScreen, renderToText, renderToAnsi, renderToHtml, renderFrames } from "./testing.ts";
export type { RenderedScreen, RenderOptions, CellSnapshot } from "./testing.ts";
