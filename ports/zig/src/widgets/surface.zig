//! Two primitives for the space behind a widget rather than the widget itself.
//!
//! `modal` already blanks the region it is about to draw into, but it does it
//! privately, so anything else that floats -- a custom overlay, a popover, a
//! tooltip somebody wrote themselves -- has no way to say "this region is mine
//! now". These make that sayable.

const std = @import("std");

const buffer_mod = @import("../buffer.zig");
const color_mod = @import("../color.zig");
const surface_mod = @import("../surface.zig");
const unicode = @import("../unicode.zig");

const Attrs = buffer_mod.Attrs;
const Color = color_mod.Color;
const Style = buffer_mod.Style;
const Surface = surface_mod.Surface;

pub const ClearOptions = struct {
    /// What to leave behind. Defaults to the theme's background.
    background: ?Color = null,
};

/// Reset a region to empty, so an overlay can draw over what was there.
///
/// Without this an overlay is drawn *into* whatever it lands on: the cells it
/// does not touch keep the widget underneath, and a dialog ends up with someone
/// else's table showing through the gaps between its words.
pub fn drawClear(s: Surface, options: ClearOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    s.fill(.{
        .fg = theme.foreground,
        .bg = options.background orelse theme.background,
        .attrs = Attrs.none,
    });
}

pub const FillOptions = struct {
    /// The symbol to repeat. A wide one is stepped over rather than written per
    /// column, since each glyph owns a continuation cell.
    symbol: []const u8 = " ",
    fg: ?Color = null,
    bg: ?Color = null,
    attrs: ?Attrs = null,
};

/// Flood a region with one repeated symbol and style.
pub fn drawFill(s: Surface, options: FillOptions) void {
    if (s.isEmpty()) return;
    const symbol = if (options.symbol.len > 0) options.symbol else " ";
    const style = Style{ .fg = options.fg, .bg = options.bg, .attrs = options.attrs };

    const len = std.unicode.utf8ByteSequenceLength(symbol[0]) catch 1;
    const glyph: u21 = if (len <= symbol.len)
        std.unicode.utf8Decode(symbol[0..len]) catch ' '
    else
        ' ';
    const glyph_width = @max(1, unicode.stringWidth(symbol));

    // A one-cell symbol is what `fill` is for. Anything wider has to be stepped
    // over rather than written per column: each glyph owns a continuation cell,
    // and writing the next one on top of it leaves a row of half-characters.
    if (glyph_width == 1) {
        s.fillRect(0, 0, s.width(), s.height(), style, glyph);
        return;
    }
    for (0..s.height()) |y| {
        // The last glyph is dropped rather than clipped when the region does
        // not divide evenly: half a wide character is not a fill, it is damage.
        var x: usize = 0;
        while (x + glyph_width <= s.width()) : (x += glyph_width) {
            s.glyph(@intCast(x), @intCast(y), glyph, style);
        }
    }
}
