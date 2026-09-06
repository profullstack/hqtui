//! Colors are packed into a single 32-bit integer so a cell never needs an
//! allocation.
//!
//! ```
//! 0                       -> "terminal default"
//! 0x1000000 | 0xRRGGBB    -> truecolor
//! 0x2000000 | index       -> explicit 256-colour palette index
//! ```

const std = @import("std");

const rgb_flag: u32 = 0x100_0000;
const idx_flag: u32 = 0x200_0000;

/// A packed terminal color. `Color.default` means "whatever the terminal uses".
pub const Color = enum(u32) {
    /// The terminal's own foreground/background. Never emitted as an SGR color.
    default = 0,
    _,

    /// Truecolor from 0-255 components.
    pub fn rgb(r: u8, g: u8, b: u8) Color {
        return @enumFromInt(rgb_flag |
            (@as(u32, r) << 16) | (@as(u32, g) << 8) | @as(u32, b));
    }

    /// `Color.hex(0x00d7ff)`. Comptime-friendly, so themes are built at compile
    /// time.
    pub fn hex(value: u32) Color {
        return @enumFromInt(rgb_flag | (value & 0xff_ffff));
    }

    /// `Color.hexStr("#00d7ff")` or `Color.hexStr("#0df")`.
    ///
    /// Anything unparseable becomes black rather than an error: a color is
    /// cosmetic, and a theme that fails to load is worse than one that is wrong.
    pub fn hexStr(text: []const u8) Color {
        var s = std.mem.trim(u8, text, " \t\r\n");
        if (s.len > 0 and s[0] == '#') s = s[1..];

        var buf: [6]u8 = undefined;
        if (s.len == 3) {
            buf = .{ s[0], s[0], s[1], s[1], s[2], s[2] };
            s = &buf;
        }
        const n = std.fmt.parseUnsigned(u32, s, 16) catch 0;
        return @enumFromInt(rgb_flag | (n & 0xff_ffff));
    }

    /// An explicit xterm-256 palette entry. Rarely needed; truecolor is
    /// quantized for you when the terminal cannot do better.
    pub fn ansi256(index: u8) Color {
        return @enumFromInt(idx_flag | @as(u32, index));
    }

    pub fn raw(self: Color) u32 {
        return @intFromEnum(self);
    }

    pub fn fromRaw(value: u32) Color {
        return @enumFromInt(value);
    }

    pub fn isDefault(self: Color) bool {
        return self == .default;
    }

    fn isIndexed(self: Color) bool {
        return self.raw() & idx_flag != 0;
    }

    pub fn red(self: Color) u8 {
        return @truncate(self.raw() >> 16);
    }

    pub fn green(self: Color) u8 {
        return @truncate(self.raw() >> 8);
    }

    pub fn blue(self: Color) u8 {
        return @truncate(self.raw());
    }

    /// Mix towards `other`. `t` of 0 returns self, 1 returns other.
    /// Software alpha — terminals have none.
    pub fn mix(self: Color, other: Color, t: f64) Color {
        if (self.isDefault() or other.isDefault()) {
            return if (t < 0.5) self else other;
        }
        const k = if (!(t > 0)) 0.0 else if (t > 1) 1.0 else t;
        const lerp = struct {
            fn f(a: u8, z: u8, amount: f64) u8 {
                const av: f64 = @floatFromInt(a);
                const zv: f64 = @floatFromInt(z);
                return @intFromFloat(roundHalfUp(av + (zv - av) * amount));
            }
        }.f;
        return rgb(
            lerp(self.red(), other.red(), k),
            lerp(self.green(), other.green(), k),
            lerp(self.blue(), other.blue(), k),
        );
    }

    /// Blend over a background at `a` (0-1), for subtle fills and shadows.
    pub fn alpha(self: Color, background: Color, a: f64) Color {
        return background.mix(self, a);
    }

    pub fn lighten(self: Color, amount: f64) Color {
        return self.mix(rgb(255, 255, 255), amount);
    }

    pub fn darken(self: Color, amount: f64) Color {
        return self.mix(rgb(0, 0, 0), amount);
    }

    /// Relative luminance, 0-1.
    pub fn luminance(self: Color) f64 {
        const channel = struct {
            fn f(v: u8) f64 {
                const x = @as(f64, @floatFromInt(v)) / 255.0;
                return if (x <= 0.03928)
                    x / 12.92
                else
                    std.math.pow(f64, (x + 0.055) / 1.055, 2.4);
            }
        }.f;
        return 0.2126 * channel(self.red()) +
            0.7152 * channel(self.green()) +
            0.0722 * channel(self.blue());
    }

    /// WCAG contrast ratio against another color (1-21).
    pub fn contrast(self: Color, other: Color) f64 {
        const a = self.luminance();
        const z = other.luminance();
        return (@max(a, z) + 0.05) / (@min(a, z) + 0.05);
    }

    /// Desaturate towards grey — this powers monochrome mode.
    pub fn grayscale(self: Color) Color {
        if (self.isDefault()) return self;
        const v: u8 = @intFromFloat(roundHalfUp(
            0.299 * @as(f64, @floatFromInt(self.red())) +
                0.587 * @as(f64, @floatFromInt(self.green())) +
                0.114 * @as(f64, @floatFromInt(self.blue())),
        ));
        return rgb(v, v, v);
    }

    /// Quantize to the xterm-256 palette, for terminals without truecolor.
    pub fn to256(self: Color) u8 {
        if (self.isIndexed()) return @truncate(self.raw());
        const rv: i32 = self.red();
        const gv: i32 = self.green();
        const bv: i32 = self.blue();
        // The grey ramp often beats the cube for desaturated colors.
        if (@abs(rv - gv) < 8 and @abs(gv - bv) < 8) {
            if (rv < 8) return 16;
            if (rv > 248) return 231;
            const scaled = (@as(f64, @floatFromInt(rv)) - 8.0) / 247.0 * 24.0;
            return 232 + @as(u8, @intFromFloat(roundHalfUp(scaled)));
        }
        return 16 + 36 * nearestCube(self.red()) + 6 * nearestCube(self.green()) + nearestCube(self.blue());
    }

    /// Quantize to the 16-color palette, for last-resort terminals.
    pub fn to16(self: Color) u8 {
        if (self.isIndexed()) {
            const i: u8 = @truncate(self.raw());
            return if (i < 16) i else from256(i).to16();
        }
        const rv: i32 = self.red();
        const gv: i32 = self.green();
        const bv: i32 = self.blue();
        var best: u8 = 7;
        var best_d: i32 = std.math.maxInt(i32);
        for (base16, 0..) |p, i| {
            const d = (rv - p[0]) * (rv - p[0]) +
                (gv - p[1]) * (gv - p[1]) +
                (bv - p[2]) * (bv - p[2]);
            if (d < best_d) {
                best_d = d;
                best = @intCast(i);
            }
        }
        return best;
    }
};

/// JavaScript's `Math.round`, which rounds half *up* including for negatives,
/// where Zig's `@round` rounds half away from zero. Every quantization here has
/// to agree with the reference implementation cell for cell, so the tie-break is
/// spelled out rather than inherited.
pub fn roundHalfUp(value: f64) f64 {
    if (std.math.isNan(value) or std.math.isInf(value)) return value;
    return @floor(value + 0.5);
}

const cube = [6]i32{ 0, 95, 135, 175, 215, 255 };

fn nearestCube(v: u8) u8 {
    var best: u8 = 0;
    var best_d: i32 = std.math.maxInt(i32);
    for (cube, 0..) |c, i| {
        const d: i32 = @intCast(@abs(c - @as(i32, v)));
        if (d < best_d) {
            best_d = d;
            best = @intCast(i);
        }
    }
    return best;
}

const base16 = [16][3]i32{
    .{ 0, 0, 0},       .{ 205, 49, 49 },   .{ 13, 188, 121 },  .{ 229, 229, 16 },
    .{ 36, 114, 200 }, .{ 188, 63, 188 },  .{ 17, 168, 205 },  .{ 229, 229, 229 },
    .{ 102, 102, 102 }, .{ 241, 76, 76 },  .{ 35, 209, 139 },  .{ 245, 245, 67 },
    .{ 59, 142, 234 }, .{ 214, 112, 214 }, .{ 41, 184, 219 },  .{ 255, 255, 255 },
};

/// Convert a 256-palette index back to truecolor.
pub fn from256(index: u8) Color {
    if (index < 16) {
        const p = base16[index];
        return Color.rgb(@intCast(p[0]), @intCast(p[1]), @intCast(p[2]));
    }
    if (index >= 232) {
        const v: u8 = @intCast(8 + (@as(u32, index) - 232) * 10);
        return Color.rgb(v, v, v);
    }
    const n: usize = index - 16;
    return Color.rgb(
        @intCast(cube[(n / 36) % 6]),
        @intCast(cube[(n / 6) % 6]),
        @intCast(cube[n % 6]),
    );
}

/// A multi-stop color ramp.
///
/// The stops are borrowed, not owned — a theme's ramp outlives every gradient
/// built from it, and copying six colors per frame is exactly the allocation
/// this library exists to avoid.
pub const Gradient = struct {
    stops: []const Color,

    pub fn init(stops: []const Color) Gradient {
        return .{ .stops = stops };
    }

    pub fn sample(self: Gradient, t: f64) Color {
        if (self.stops.len == 0) return .default;
        if (self.stops.len == 1) return self.stops[0];
        // Ordered so NaN falls through to 0 rather than indexing wild.
        const k = if (t > 1) 1.0 else if (t > 0) t else 0.0;
        const pos = k * @as(f64, @floatFromInt(self.stops.len - 1));
        const floored = @floor(pos);
        const i = @min(@as(usize, @intFromFloat(@max(0, floored))), self.stops.len - 2);
        return self.stops[i].mix(self.stops[i + 1], pos - @as(f64, @floatFromInt(i)));
    }

    /// Sample `n` evenly spaced colors into `out`, which must hold `n` of them.
    pub fn steps(self: Gradient, out: []Color) void {
        for (out, 0..) |*slot, i| {
            const t = if (out.len == 1)
                0.0
            else
                @as(f64, @floatFromInt(i)) / @as(f64, @floatFromInt(out.len - 1));
            slot.* = self.sample(t);
        }
    }
};
