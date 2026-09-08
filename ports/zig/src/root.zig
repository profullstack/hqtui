//! HQTUI — High Quality Terminal UI for Zig.
//!
//! ```zig
//! const hqtui = @import("hqtui");
//!
//! pub fn main() !void {
//!     var app = try hqtui.App.init(allocator, .{});
//!     defer app.deinit();
//!     try app.run(view);
//! }
//! ```
//!
//! This is the Zig port of the TypeScript reference implementation. Behaviour is
//! pinned to it by a shared conformance suite: the same widget arguments produce
//! the same cells, the same colors and the same escape bytes in both.

pub const ansi = @import("ansi.zig");
pub const app = @import("app.zig");
pub const buffer = @import("buffer.zig");
pub const capabilities = @import("capabilities.zig");
pub const color = @import("color.zig");
pub const diff = @import("diff.zig");
pub const graphics = @import("graphics.zig");
pub const input = @import("input.zig");
pub const layout = @import("layout.zig");
pub const surface = @import("surface.zig");
pub const terminal = @import("terminal.zig");
pub const testing = @import("testing.zig");
pub const theme = @import("theme.zig");
pub const ui = @import("ui.zig");
pub const unicode = @import("unicode.zig");
pub const widgets = @import("widgets.zig");

pub const Color = color.Color;
pub const Gradient = color.Gradient;
pub const from256 = color.from256;

pub const Align = unicode.Align;
pub const Cell = unicode.Cell;

pub const Attrs = buffer.Attrs;
pub const FrameBuffer = buffer.FrameBuffer;
pub const Style = buffer.Style;

pub const Constraint = layout.Constraint;
pub const Direction = layout.Direction;
pub const Padding = layout.Padding;
pub const Rect = layout.Rect;
pub const Size = layout.Size;

pub const Capabilities = capabilities.Capabilities;
pub const ColorDepth = capabilities.ColorDepth;

pub const EncodeResult = diff.EncodeResult;
pub const Encoder = diff.Encoder;

pub const BorderStyle = surface.BorderStyle;
pub const BoxOptions = surface.BoxOptions;
pub const Surface = surface.Surface;
pub const TextOptions = surface.TextOptions;

pub const Theme = theme.Theme;
pub const resolveTheme = theme.resolve;

pub const BrailleCanvas = graphics.BrailleCanvas;
pub const FillMode = graphics.FillMode;

pub const InputEvent = input.InputEvent;
pub const InputParser = input.InputParser;
pub const KeyEvent = input.KeyEvent;
pub const MouseEvent = input.MouseEvent;
pub const matchKey = input.matchKey;

pub const Body = ui.Body;
pub const Container = ui.Container;
pub const Grid = ui.Grid;
pub const GridBody = ui.GridBody;
pub const HitRegion = ui.HitRegion;
pub const Interaction = ui.Interaction;
pub const PanelOptions = ui.PanelOptions;
pub const Span = ui.Span;

pub const App = app.App;
pub const AppOptions = app.Options;
pub const FrameStats = app.FrameStats;

pub const Terminal = terminal.Terminal;
pub const TerminalOptions = terminal.Options;
pub const TerminalSize = terminal.TerminalSize;

pub const RenderedScreen = testing.RenderedScreen;
pub const renderToScreen = testing.renderToScreen;
pub const renderCollapsedToScreen = testing.renderCollapsedToScreen;

test {
    @import("std").testing.refAllDecls(@This());
    _ = @import("conformance.zig");
    _ = @import("conformance_widgets.zig");
    _ = @import("conformance_screen.zig");
    _ = @import("conformance_input.zig");
}
