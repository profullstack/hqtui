//! Text, badges, label/value pairs, dividers and the function-key bar.

const std = @import("std");

const buffer_mod = @import("../buffer.zig");
const color_mod = @import("../color.zig");
const surface_mod = @import("../surface.zig");
const theme_mod = @import("../theme.zig");
const unicode = @import("../unicode.zig");

const Align = unicode.Align;
const Attrs = buffer_mod.Attrs;
const Color = color_mod.Color;
const Style = buffer_mod.Style;
const Surface = surface_mod.Surface;
const TextOptions = surface_mod.TextOptions;

pub const TextStyle = struct {
    fg: ?Color = null,
    bg: ?Color = null,
    attrs: ?Attrs = null,
    alignment: Align = .left,
    wrap: bool = false,
    bold: bool = false,
    dim: bool = false,
    italic: bool = false,
    underline: bool = false,

    fn resolvedAttrs(self: TextStyle) Attrs {
        var a = self.attrs orelse Attrs.none;
        if (self.bold) a.bold = true;
        if (self.dim) a.dim = true;
        if (self.italic) a.italic = true;
        if (self.underline) a.underline = true;
        return a;
    }
};

/// `allocator` is only touched when `style.wrap` is set; unwrapped text splits
/// on newlines in place.
pub fn drawText(
    allocator: std.mem.Allocator,
    s: Surface,
    content: []const u8,
    style: TextStyle,
) !void {
    if (s.isEmpty()) return;
    const options: TextOptions = .{
        .fg = style.fg orelse s.theme.foreground,
        .bg = style.bg,
        .attrs = style.resolvedAttrs(),
    };

    var scratch: [4096]u8 = undefined;
    var padded: [4096]u8 = undefined;

    if (style.wrap) {
        const lines = try unicode.wrap(allocator, content, s.width());
        defer unicode.freeWrapped(allocator, lines);
        for (lines, 0..) |line, i| {
            if (i >= s.height()) break;
            const cut = unicode.truncate(&scratch, line, s.width());
            const shown = unicode.fit(&padded, cut, s.width(), style.alignment);
            _ = s.text(0, @intCast(i), shown, options);
        }
        return;
    }

    var it = std.mem.splitScalar(u8, content, '\n');
    var i: usize = 0;
    while (it.next()) |line| : (i += 1) {
        if (i >= s.height()) break;
        const cut = unicode.truncate(&scratch, line, s.width());
        const shown = unicode.fit(&padded, cut, s.width(), style.alignment);
        _ = s.text(0, @intCast(i), shown, options);
    }
}

/// Filled reads as a chip; outline keeps the panel quiet.
pub const BadgeVariant = enum { filled, outline, subtle };

pub const BadgeOptions = struct {
    text: []const u8 = "",
    color: ?Color = null,
    variant: BadgeVariant = .filled,
    alignment: Align = .left,
};

/// Returns the width drawn, so callers can advance a cursor past it.
pub fn drawBadge(s: Surface, options: BadgeOptions) usize {
    if (s.isEmpty()) return 0;
    const theme = s.theme;
    const c = options.color orelse theme.primary;

    var label_buf: [256]u8 = undefined;
    const label = std.fmt.bufPrint(&label_buf, " {s} ", .{options.text}) catch return 0;

    const style: Style = switch (options.variant) {
        .filled => .{
            .fg = if (theme.dark) theme.background else theme.surface,
            .bg = c,
            .attrs = .bold_only,
        },
        .subtle => .{ .fg = c, .bg = theme.surface.mix(c, 0.18) },
        .outline => .{ .fg = c, .attrs = .bold_only },
    };

    const width = @min(unicode.stringWidth(label), s.width());
    const x: isize = switch (options.alignment) {
        .right => @as(isize, @intCast(s.width())) - @as(isize, @intCast(width)),
        .center => @divFloor(@as(isize, @intCast(s.width())) - @as(isize, @intCast(width)), 2),
        .left => 0,
    };
    var cut: [256]u8 = undefined;
    _ = s.text(@max(0, x), 0, unicode.truncate(&cut, label, s.width()), TextOptions.fromStyle(style));
    return width;
}

pub const KeyValueRow = struct {
    label: []const u8,
    value: []const u8,
    color: ?Color = null,
    label_color: ?Color = null,
};

pub const KeyValueOptions = struct {
    rows: []const KeyValueRow = &.{},
    /// Columns reserved for labels. Null means the widest label.
    label_width: ?usize = null,
    gap: usize = 1,
    /// Push values to the right edge instead of next to the label.
    spread: bool = true,
    label_color: ?Color = null,
    value_color: ?Color = null,
    background: ?Color = null,
};

/// Aligned label/value pairs — the backbone of every "System" panel.
pub fn drawKeyValues(s: Surface, options: KeyValueOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;

    const label_width = options.label_width orelse blk: {
        var widest: usize = 0;
        for (options.rows) |r| widest = @max(widest, unicode.stringWidth(r.label));
        const cap = @max(4, @as(usize, @intFromFloat(@as(f64, @floatFromInt(s.width())) * 0.6)));
        break :blk @min(widest + 1, cap);
    };

    for (options.rows, 0..) |row, i| {
        if (i >= s.height()) break;
        var cut: [256]u8 = undefined;
        var padded: [256]u8 = undefined;
        const label = unicode.fit(
            &padded,
            unicode.truncate(&cut, row.label, label_width),
            label_width,
            .left,
        );
        _ = s.text(0, @intCast(i), label, .{
            .fg = row.label_color orelse options.label_color orelse theme.muted,
            .bg = options.background,
        });

        const vx = label_width + options.gap;
        const vw = s.width() -| vx;
        if (vw == 0) continue;

        var value_cut: [256]u8 = undefined;
        var value_padded: [256]u8 = undefined;
        var value = unicode.truncate(&value_cut, row.value, vw);
        if (options.spread) value = unicode.fit(&value_padded, value, vw, .right);
        _ = s.text(@intCast(vx), @intCast(i), value, .{
            .fg = row.color orelse options.value_color orelse theme.foreground,
            .bg = options.background,
        });
    }
}

pub const DividerOptions = struct {
    label: []const u8 = "",
    color: ?Color = null,
    char: u21 = '─',
    alignment: Align = .left,
};

pub fn drawDivider(s: Surface, options: DividerOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    s.hline(0, 0, s.width(), options.char, .{ .fg = options.color orelse theme.border });
    if (options.label.len == 0) return;

    var label_buf: [256]u8 = undefined;
    const label = std.fmt.bufPrint(&label_buf, " {s} ", .{options.label}) catch return;
    const w: isize = @intCast(unicode.stringWidth(label));
    const width: isize = @intCast(s.width());
    const x: isize = switch (options.alignment) {
        .left => 1,
        .right => width - w - 1,
        .center => @divFloor(width - w, 2),
    };
    var cut: [256]u8 = undefined;
    _ = s.text(@max(0, x), 0, unicode.truncate(&cut, label, s.width()), .{ .fg = theme.muted });
}

pub const StatusItem = struct {
    label: []const u8 = "",
    key: []const u8 = "",
    color: ?Color = null,
    /// Highlight this entry, e.g. the active tab or a live indicator.
    active: bool = false,
};

/// Caps reverse-videos the key caps, like a function-key bar.
pub const KeyStyle = enum { caps, plain };

pub const StatusBarOptions = struct {
    items: []const StatusItem = &.{},
    right: []const StatusItem = &.{},
    background: ?Color = null,
    key_color: ?Color = null,
    key_style: KeyStyle = .caps,
};

/// The F1/F2/F10 bar along the bottom of every serious TUI.
pub fn drawStatusBar(s: Surface, options: StatusBarOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const bg = options.background orelse theme_mod.elevate(theme.*, 0.04);
    s.fill(.{ .bg = bg });
    const key_color = options.key_color orelse theme.accent;

    const drawItems = struct {
        fn f(
            surface: Surface,
            items: []const StatusItem,
            start_x: isize,
            bar_bg: Color,
            cap_color: Color,
            key_style: KeyStyle,
        ) isize {
            const t = surface.theme;
            var cx = start_x;
            for (items) |item| {
                if (cx >= @as(isize, @intCast(surface.width()))) break;
                if (item.key.len > 0) {
                    const cap: Style = switch (key_style) {
                        .plain => .{ .fg = cap_color, .bg = bar_bg, .attrs = .bold_only },
                        .caps => .{
                            .fg = if (t.dark) t.background else t.surface,
                            .bg = cap_color,
                            .attrs = .bold_only,
                        },
                    };
                    cx += @intCast(surface.text(cx, 0, item.key, TextOptions.fromStyle(cap)));
                    cx += @intCast(surface.text(cx, 0, " ", .{ .bg = bar_bg }));
                }
                cx += @intCast(surface.text(cx, 0, item.label, .{
                    .fg = if (item.active) t.foreground else (item.color orelse t.muted),
                    .bg = bar_bg,
                    .attrs = if (item.active) Attrs.bold_only else Attrs.none,
                }));
                cx += @intCast(surface.text(cx, 0, "  ", .{ .bg = bar_bg }));
            }
            return cx;
        }
    }.f;

    const x = drawItems(s, options.items, 1, bg, key_color, options.key_style);

    if (options.right.len > 0) {
        var width: usize = 0;
        for (options.right) |i| {
            width += unicode.stringWidth(i.label) + 2;
            if (i.key.len > 0) width += unicode.stringWidth(i.key) + 1;
        }
        const from = @max(x, @as(isize, @intCast(s.width())) - @as(isize, @intCast(width)) - 1);
        _ = drawItems(s, options.right, from, bg, key_color, options.key_style);
    }
}
