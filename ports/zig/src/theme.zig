//! A theme is flat and small on purpose: every token here is one a widget
//! actually reaches for. Anything deeper is computed, not configured.

const std = @import("std");

const color_mod = @import("color.zig");
const Color = color_mod.Color;
const Gradient = color_mod.Gradient;

const hex = Color.hex;

pub const Theme = struct {
    name: []const u8 = "dark",
    /// True for palettes designed against a dark terminal background.
    dark: bool = true,

    background: Color = hex(0x05070a),
    /// Panel interiors, lifted slightly off the page.
    surface: Color = hex(0x0a0e14),
    foreground: Color = hex(0xc6d0db),
    muted: Color = hex(0x5a6b7d),

    primary: Color = hex(0x58a6ff),
    secondary: Color = hex(0xbd93f9),
    accent: Color = hex(0x56d4dd),

    success: Color = hex(0x5fff87),
    warning: Color = hex(0xffd75f),
    danger: Color = hex(0xff6b6b),
    info: Color = hex(0x56d4dd),

    border: Color = hex(0x243040),
    border_focused: Color = hex(0x56d4dd),
    title: Color = hex(0x7ee2ff),

    selection: Color = hex(0x1d3a52),
    selection_text: Color = hex(0xe6f2ff),
    cursor: Color = hex(0x56d4dd),

    /// Series colors for multi-line graphs, in draw order.
    graph: []const Color = &.{
        hex(0x58a6ff), hex(0x5fff87), hex(0xff79c6),
        hex(0xffd75f), hex(0x56d4dd), hex(0xffa657),
    },
    /// Low-to-high ramp for gauges, meters and heat bars.
    heat: []const Color = &.{
        hex(0x5fff87), hex(0xa8ff60), hex(0xffd75f), hex(0xffa657), hex(0xff6b6b),
    },
};

pub const dark: Theme = .{};

/// Every palette below starts from `dark` and overrides, so anything it does not
/// mention is inherited — the reference's `variant(DARK, {...})`.
pub const dracula: Theme = .{
    .name = "dracula",
    .background = hex(0x191a21), .surface = hex(0x21222c),
    .foreground = hex(0xf8f8f2), .muted = hex(0x6272a4),
    .primary = hex(0xbd93f9), .secondary = hex(0xff79c6), .accent = hex(0x8be9fd),
    .success = hex(0x50fa7b), .warning = hex(0xf1fa8c),
    .danger = hex(0xff5555), .info = hex(0x8be9fd),
    .border = hex(0x44475a), .border_focused = hex(0xbd93f9), .title = hex(0xff79c6),
    .selection = hex(0x44475a), .selection_text = hex(0xf8f8f2),
    .graph = &.{ hex(0xbd93f9), hex(0x50fa7b), hex(0xff79c6), hex(0xf1fa8c), hex(0x8be9fd), hex(0xffb86c) },
    .heat = &.{ hex(0x50fa7b), hex(0xf1fa8c), hex(0xffb86c), hex(0xff5555) },
};

pub const nord: Theme = .{
    .name = "nord",
    .background = hex(0x2e3440), .surface = hex(0x333b4a),
    .foreground = hex(0xe5e9f0), .muted = hex(0x7b88a1),
    .primary = hex(0x88c0d0), .secondary = hex(0xb48ead), .accent = hex(0x8fbcbb),
    .success = hex(0xa3be8c), .warning = hex(0xebcb8b),
    .danger = hex(0xbf616a), .info = hex(0x81a1c1),
    .border = hex(0x434c5e), .border_focused = hex(0x88c0d0), .title = hex(0x8fbcbb),
    .selection = hex(0x434c5e), .selection_text = hex(0xeceff4),
    .graph = &.{ hex(0x88c0d0), hex(0xa3be8c), hex(0xb48ead), hex(0xebcb8b), hex(0x81a1c1), hex(0xd08770) },
    .heat = &.{ hex(0xa3be8c), hex(0xebcb8b), hex(0xd08770), hex(0xbf616a) },
};

pub const tokyo_night: Theme = .{
    .name = "tokyo-night",
    .background = hex(0x1a1b26), .surface = hex(0x1f2335),
    .foreground = hex(0xc0caf5), .muted = hex(0x565f89),
    .primary = hex(0x7aa2f7), .secondary = hex(0xbb9af7), .accent = hex(0x7dcfff),
    .success = hex(0x9ece6a), .warning = hex(0xe0af68),
    .danger = hex(0xf7768e), .info = hex(0x7dcfff),
    .border = hex(0x2f3549), .border_focused = hex(0x7aa2f7), .title = hex(0x7dcfff),
    .selection = hex(0x283457), .selection_text = hex(0xc0caf5),
    .graph = &.{ hex(0x7aa2f7), hex(0x9ece6a), hex(0xbb9af7), hex(0xe0af68), hex(0x7dcfff), hex(0xff9e64) },
    .heat = &.{ hex(0x9ece6a), hex(0xe0af68), hex(0xff9e64), hex(0xf7768e) },
};

pub const gruvbox: Theme = .{
    .name = "gruvbox",
    .background = hex(0x1d2021), .surface = hex(0x282828),
    .foreground = hex(0xebdbb2), .muted = hex(0x928374),
    .primary = hex(0x83a598), .secondary = hex(0xd3869b), .accent = hex(0x8ec07c),
    .success = hex(0xb8bb26), .warning = hex(0xfabd2f),
    .danger = hex(0xfb4934), .info = hex(0x83a598),
    .border = hex(0x3c3836), .border_focused = hex(0xfabd2f), .title = hex(0xfabd2f),
    .selection = hex(0x3c3836), .selection_text = hex(0xfbf1c7),
    .graph = &.{ hex(0x83a598), hex(0xb8bb26), hex(0xd3869b), hex(0xfabd2f), hex(0x8ec07c), hex(0xfe8019) },
    .heat = &.{ hex(0xb8bb26), hex(0xfabd2f), hex(0xfe8019), hex(0xfb4934) },
};

pub const matrix: Theme = .{
    .name = "matrix",
    .background = hex(0x000000), .surface = hex(0x020a02),
    .foreground = hex(0x9dff9d), .muted = hex(0x2f6b2f),
    .primary = hex(0x00ff41), .secondary = hex(0x00c853), .accent = hex(0x7cff7c),
    .success = hex(0x00ff41), .warning = hex(0xd4ff00),
    .danger = hex(0xff3b30), .info = hex(0x00e5b0),
    .border = hex(0x12401f), .border_focused = hex(0x00ff41), .title = hex(0x00ff41),
    .selection = hex(0x0d2f14), .selection_text = hex(0xc9ffc9),
    .graph = &.{ hex(0x00ff41), hex(0x00c853), hex(0x7cff7c), hex(0x00e5b0), hex(0xd4ff00), hex(0x2f9e44) },
    .heat = &.{ hex(0x0f7a2e), hex(0x00c853), hex(0x00ff41), hex(0xd4ff00) },
};

pub const monochrome: Theme = .{
    .name = "monochrome",
    .background = hex(0x000000), .surface = hex(0x0b0b0b),
    .foreground = hex(0xd0d0d0), .muted = hex(0x6e6e6e),
    .primary = hex(0xffffff), .secondary = hex(0xc0c0c0), .accent = hex(0xe0e0e0),
    .success = hex(0xe8e8e8), .warning = hex(0xb8b8b8),
    .danger = hex(0xffffff), .info = hex(0xa0a0a0),
    .border = hex(0x3a3a3a), .border_focused = hex(0xd0d0d0), .title = hex(0xffffff),
    .selection = hex(0x303030), .selection_text = hex(0xffffff),
    .graph = &.{ hex(0xffffff), hex(0xc8c8c8), hex(0x909090), hex(0x686868), hex(0xb0b0b0), hex(0x808080) },
    .heat = &.{ hex(0x585858), hex(0x909090), hex(0xc8c8c8), hex(0xffffff) },
};

pub const high_contrast: Theme = .{
    .name = "high-contrast",
    .background = hex(0x000000), .surface = hex(0x000000),
    .foreground = hex(0xffffff), .muted = hex(0xc0c0c0),
    .primary = hex(0x00ffff), .secondary = hex(0xff00ff), .accent = hex(0xffff00),
    .success = hex(0x00ff00), .warning = hex(0xffff00),
    .danger = hex(0xff0000), .info = hex(0x00ffff),
    .border = hex(0xffffff), .border_focused = hex(0xffff00), .title = hex(0xffffff),
    .selection = hex(0xffffff), .selection_text = hex(0x000000),
    .graph = &.{ hex(0x00ffff), hex(0x00ff00), hex(0xff00ff), hex(0xffff00), hex(0xffffff), hex(0xff8000) },
    .heat = &.{ hex(0x00ff00), hex(0xffff00), hex(0xff8000), hex(0xff0000) },
};

pub const light: Theme = .{
    .name = "light",
    .dark = false,
    .background = hex(0xfbfcfd), .surface = hex(0xffffff),
    .foreground = hex(0x1c2530), .muted = hex(0x6b7a8c),
    .primary = hex(0x0b62d0), .secondary = hex(0x7c3aed), .accent = hex(0x0e7490),
    .success = hex(0x128a3f), .warning = hex(0xa86a00),
    .danger = hex(0xc62828), .info = hex(0x0e7490),
    .border = hex(0xd3dbe4), .border_focused = hex(0x0b62d0), .title = hex(0x0b3d78),
    .selection = hex(0xd6e6fb), .selection_text = hex(0x0b2545), .cursor = hex(0x0b62d0),
    .graph = &.{ hex(0x0b62d0), hex(0x128a3f), hex(0xa3348a), hex(0xa86a00), hex(0x0e7490), hex(0xc2410c) },
    .heat = &.{ hex(0x128a3f), hex(0x7aa300), hex(0xa86a00), hex(0xc2410c), hex(0xc62828) },
};

const Named = struct { key: []const u8, theme: Theme };

/// Every built-in, in the reference implementation's order. The key is what
/// callers pass to `resolve`; both `tokyoNight` and `tokyo-night` reach the same
/// palette.
pub const themes = [_]Named{
    .{ .key = "dark", .theme = dark },
    .{ .key = "dracula", .theme = dracula },
    .{ .key = "nord", .theme = nord },
    .{ .key = "tokyoNight", .theme = tokyo_night },
    .{ .key = "gruvbox", .theme = gruvbox },
    .{ .key = "matrix", .theme = matrix },
    .{ .key = "monochrome", .theme = monochrome },
    .{ .key = "highContrast", .theme = high_contrast },
    .{ .key = "light", .theme = light },
};

/// Look a theme up by key or by its own name. Unknown names fall back to dark,
/// because a mistyped theme should not stop an app from starting.
pub fn resolve(name: []const u8) Theme {
    for (themes) |t| {
        if (std.mem.eql(u8, t.key, name)) return t.theme;
    }
    for (themes) |t| {
        if (std.mem.eql(u8, t.theme.name, name)) return t.theme;
    }
    return dark;
}

/// A slightly lifted or dropped shade of the surface, for zebra rows and tracks.
pub fn elevate(theme: Theme, amount: f64) Color {
    return theme.surface.mix(if (theme.dark) hex(0xffffff) else hex(0x000000), amount);
}

/// Color a 0-1 ratio along the theme's heat ramp: green when idle, red when hot.
pub fn heatColor(theme: Theme, ratio: f64) Color {
    return Gradient.init(theme.heat).sample(ratio);
}

/// The nth series color, wrapping around. Negative indices wrap from the end.
pub fn seriesColor(theme: Theme, index: i64) Color {
    const n: i64 = @intCast(theme.graph.len);
    if (n == 0) return .default;
    return theme.graph[@intCast(@mod(@mod(index, n) + n, n))];
}
