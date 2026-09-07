//! HQTUI — High Quality Terminal UI.
//!
//! ```no_run
//! use hqtui::prelude::*;
//!
//! fn main() -> std::io::Result<()> {
//!     App::new()?.run(|f| {
//!         f.ui.panel(Panel::new().title("Hello"), |p| {
//!             p.text("Hello, terminal.");
//!         });
//!     })
//! }
//! ```
//!
//! Dark theme, mouse, truecolor, resize handling and terminal restoration are
//! all on by default. <https://hqtui.com>
//!
//! This is the Rust port of the TypeScript reference implementation. Behaviour
//! is pinned to it by a shared conformance suite: the same widget arguments
//! produce the same cells, the same colors and the same escape sequences in
//! both. Where the two differ, it is called out in the module that differs.

pub mod ansi;
pub mod buffer;
pub mod capabilities;
pub mod color;
pub mod diff;
pub mod graphics;
pub mod input;
pub mod layout;
pub mod surface;
pub mod terminal;
pub mod testing;
pub mod theme;
pub mod ui;
pub mod unicode;
pub mod widgets;

mod app;

pub use app::{App, AppOptions, FrameStats, RenderArgs};
pub use buffer::{Attrs, FrameBuffer, Style};
pub use capabilities::{Capabilities, CapabilityOverrides, ColorDepth};
pub use color::{Color, Gradient};
pub use diff::{encode_full, EncodeResult, Encoder, EncoderOptions};
pub use graphics::BrailleCanvas;
pub use input::{FocusEvent, InputEvent, InputParser, KeyEvent, MouseAction, MouseButton, MouseEvent, PasteEvent};
pub use layout::{solve, stack, Constraint, Direction, Padding, Rect, Size};
pub use surface::{BorderStyle, Surface};
pub use terminal::{emergency_restore, Terminal, TerminalOptions, TerminalSize};
pub use theme::{resolve_theme, Theme};
pub use ui::{Column, Container, Grid, GridSpec, Interaction, Overlay, Panel, Row, Span};
pub use unicode::{string_width, truncate, wrap, Align};

/// Everything you need for an ordinary app, in one import.
pub mod prelude {
    pub use crate::app::{App, AppOptions, RenderArgs};
    pub use crate::buffer::{Attrs, Style};
    pub use crate::color::Color;
    pub use crate::input::{InputEvent, KeyEvent, MouseEvent};
    pub use crate::layout::{Constraint, Padding, Rect, Size};
    pub use crate::surface::{BorderStyle, Surface};
    pub use crate::theme::Theme;
    pub use crate::ui::{Column, Container, Grid, GridSpec, Interaction, Panel, Row, Span};
    pub use crate::unicode::Align;
    pub use crate::widgets::*;
}

/// The version of the TypeScript reference implementation this port tracks.
pub const REFERENCE_VERSION: &str = "0.1.12";
