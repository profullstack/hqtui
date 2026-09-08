//! Sub-cell graphics: a Braille pixel canvas, block-element ramps, and the
//! plotting primitives built on them.

pub const blocks = @import("graphics/blocks.zig");
pub const braille = @import("graphics/braille.zig");
pub const chart_mod = @import("graphics/chart.zig");
pub const plot_mod = @import("graphics/plot.zig");

pub const BrailleCanvas = braille.BrailleCanvas;
pub const FillMode = blocks.FillMode;
pub const Point = braille.Point;

pub const bestMode = blocks.bestMode;
pub const clamp01 = blocks.clamp01;
pub const horizontalGlyph = blocks.horizontalGlyph;
pub const shadeGlyph = blocks.shadeGlyph;
pub const verticalGlyph = blocks.verticalGlyph;

pub const BarOptions = plot_mod.BarOptions;
pub const BarStyle = plot_mod.BarStyle;
pub const DonutOptions = plot_mod.DonutOptions;
pub const DonutSegment = plot_mod.DonutSegment;
pub const GaugeOptions = plot_mod.GaugeOptions;
pub const HistogramOptions = plot_mod.HistogramOptions;
pub const PlotOptions = plot_mod.PlotOptions;
pub const Series = plot_mod.Series;
pub const SparklineOptions = plot_mod.SparklineOptions;

pub const bar = plot_mod.bar;
pub const blitFlat = plot_mod.blitFlat;
pub const blitRamp = plot_mod.blitRamp;
pub const donut = plot_mod.donut;
pub const gauge = plot_mod.gauge;
pub const histogram = plot_mod.histogram;
pub const plot = plot_mod.plot;
pub const AxisOptions = chart_mod.AxisOptions;
pub const ChartPlotOptions = chart_mod.ChartPlotOptions;
pub const ChartSeries = chart_mod.ChartSeries;
pub const Domain = chart_mod.Domain;
pub const MarkType = chart_mod.MarkType;
pub const domainOf = chart_mod.domainOf;
pub const plotPoints = chart_mod.plotPoints;
pub const sparkline = plot_mod.sparkline;
pub const tail = plot_mod.tail;
