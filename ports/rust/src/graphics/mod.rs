//! Sub-cell graphics: a Braille pixel canvas, block-element ramps, and the
//! plotting primitives built on them.

pub mod blocks;
pub mod braille;
pub mod plot;

pub use blocks::{
    best_mode, horizontal_glyph, shade_glyph, vertical_glyph, FillMode, ASCII_RAMP,
    HORIZONTAL_EIGHTHS, QUADRANTS, SHADES, VERTICAL_EIGHTHS,
};
pub use braille::BrailleCanvas;
pub use plot::{
    bar, blit, donut, gauge, histogram, plot, sparkline, BarOptions, BarStyle, DonutOptions,
    DonutSegment, GaugeOptions, HistogramOptions, PlotOptions, Series, SparklineOptions,
};
