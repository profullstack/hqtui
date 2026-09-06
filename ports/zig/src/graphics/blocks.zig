//! Sub-cell glyph ramps. Every one degrades to ASCII when Unicode is off.

const std = @import("std");

const roundHalfUp = @import("../color.zig").roundHalfUp;

/// Left-to-right eighths: ▏▎▍▌▋▊▉█ — horizontal bars and meters.
pub const horizontal_eighths = [9][]const u8{ "", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█" };
/// Bottom-up eighths: ▁▂▃▄▅▆▇█ — sparklines and column charts.
pub const vertical_eighths = [9][]const u8{ "", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█" };
/// Quadrants indexed by a 4-bit mask: 1=TL, 2=TR, 4=BL, 8=BR.
pub const quadrants = [16][]const u8{
    " ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█",
};
pub const shades = [4][]const u8{ "░", "▒", "▓", "█" };
pub const ascii_ramp = [10][]const u8{ " ", ".", ":", "-", "=", "+", "*", "#", "%", "@" };

/// How sub-cell detail is drawn. Braille is sharpest; the rest are the graceful
/// degradations for terminals or fonts that cannot manage it.
pub const FillMode = enum {
    braille,
    block,
    half,
    quadrant,
    ascii,

    pub fn parse(name: []const u8) FillMode {
        inline for (@typeInfo(FillMode).@"enum".fields) |field| {
            if (std.mem.eql(u8, field.name, name)) return @enumFromInt(field.value);
        }
        return .braille;
    }
};

/// Clamp to 0-1.
///
/// NaN becomes 0 rather than propagating. The reference lets it through, where
/// every subsequent comparison is false and the widget draws its empty state;
/// `@intFromFloat` on NaN is illegal behaviour in Zig, and 0 reaches the same
/// empty state without it.
pub fn clamp01(ratio: f64) f64 {
    if (std.math.isNan(ratio)) return 0;
    if (ratio <= 0) return 0;
    if (ratio >= 1) return 1;
    return ratio;
}

/// Pick the glyph for a 0-1 fill of one cell, bottom-up.
pub fn verticalGlyph(ratio: f64, mode: FillMode) []const u8 {
    const r = clamp01(ratio);
    switch (mode) {
        .ascii => {
            if (r == 0) return " ";
            if (r < 0.4) return ".";
            return if (r < 0.7) "=" else "#";
        },
        .half => {
            if (r == 0) return " ";
            return if (r < 0.5) "▄" else "█";
        },
        else => {},
    }
    const i: usize = @intFromFloat(roundHalfUp(r * 8));
    return if (i == 0) " " else vertical_eighths[i];
}

/// Pick the glyph for a 0-1 fill of one cell, left to right.
pub fn horizontalGlyph(ratio: f64, mode: FillMode) []const u8 {
    const r = clamp01(ratio);
    if (mode == .ascii) {
        if (r == 0) return " ";
        return if (r < 0.5) "-" else "#";
    }
    const i: usize = @intFromFloat(roundHalfUp(r * 8));
    return if (i == 0) " " else horizontal_eighths[i];
}

/// Map a 0-1 value onto a shade block, for heatmaps and dim fills.
pub fn shadeGlyph(ratio: f64, unicode_ok: bool) []const u8 {
    const r = clamp01(ratio);
    if (!unicode_ok) {
        const i: usize = @intFromFloat(roundHalfUp(r * @as(f64, ascii_ramp.len - 1)));
        return ascii_ramp[i];
    }
    if (r == 0) return " ";
    const i: usize = @intFromFloat(@floor(r * @as(f64, shades.len)));
    return shades[@min(shades.len - 1, i)];
}

/// Braille when the terminal supports it, blocks when it does not.
pub fn bestMode(unicode_ok: bool, braille_ok: bool) FillMode {
    if (braille_ok) return .braille;
    return if (unicode_ok) .block else .ascii;
}

/// Every glyph ramp entry is a single character; this is the reference's
/// `codePointAt(0)` on a one-glyph string.
pub fn firstCodepoint(text: []const u8) u21 {
    if (text.len == 0) return ' ';
    const len = std.unicode.utf8ByteSequenceLength(text[0]) catch return ' ';
    if (len > text.len) return ' ';
    return std.unicode.utf8Decode(text[0..len]) catch ' ';
}
