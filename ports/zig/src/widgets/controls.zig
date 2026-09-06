//! Buttons, inputs, tabs and the overlays that sit above a whole screen.

const std = @import("std");

const buffer_mod = @import("../buffer.zig");
const color_mod = @import("../color.zig");
const surface_mod = @import("../surface.zig");
const theme_mod = @import("../theme.zig");
const unicode = @import("../unicode.zig");

const Align = unicode.Align;
const Attrs = buffer_mod.Attrs;
const BorderStyle = surface_mod.BorderStyle;
const BoxOptions = surface_mod.BoxOptions;
const Color = color_mod.Color;
const Style = buffer_mod.Style;
const Surface = surface_mod.Surface;
const TextOptions = surface_mod.TextOptions;

pub const ButtonVariant = enum { primary, success, warning, danger, ghost };

pub const ButtonOptions = struct {
    label: []const u8 = "",
    focused: bool = false,
    color: ?Color = null,
    variant: ButtonVariant = .primary,
    disabled: bool = false,
    width: ?usize = null,
    alignment: Align = .center,
};

fn variantColor(s: Surface, options: ButtonOptions) Color {
    if (options.color) |c| return c;
    const t = s.theme;
    return switch (options.variant) {
        .success => t.success,
        .warning => t.warning,
        .danger => t.danger,
        .ghost => t.muted,
        .primary => t.primary,
    };
}

/// Returns the width drawn.
pub fn drawButton(s: Surface, options: ButtonOptions) usize {
    if (s.isEmpty()) return 0;
    const theme = s.theme;
    const c = variantColor(s, options);

    var label_buf: [256]u8 = undefined;
    const label = std.fmt.bufPrint(&label_buf, " {s} ", .{options.label}) catch return 0;
    const width = @min(options.width orelse unicode.stringWidth(label), s.width());

    const style: Style = if (options.disabled)
        .{ .fg = theme.muted, .bg = theme_mod.elevate(theme.*, 0.05) }
    else if (options.focused)
        .{
            .fg = if (theme.dark) theme.background else theme.surface,
            .bg = c,
            .attrs = .bold_only,
        }
    else if (options.variant == .ghost)
        .{ .fg = c }
    else
        .{ .fg = c, .bg = theme.surface.mix(c, 0.16), .attrs = .bold_only };

    var cut: [256]u8 = undefined;
    var padded: [256]u8 = undefined;
    const shown = unicode.fit(
        &padded,
        unicode.truncate(&cut, label, width),
        width,
        options.alignment,
    );
    _ = s.text(0, 0, shown, TextOptions.fromStyle(style));
    return width;
}

/// Render as a box, a switch, or a radio dot.
pub const CheckboxVariant = enum { checkbox, toggle, radio };

pub const CheckboxOptions = struct {
    label: []const u8 = "",
    checked: bool = false,
    focused: bool = false,
    color: ?Color = null,
    variant: CheckboxVariant = .checkbox,
};

/// Returns the width drawn.
pub fn drawCheckbox(s: Surface, options: CheckboxOptions) usize {
    if (s.isEmpty()) return 0;
    const theme = s.theme;
    const c = options.color orelse (if (options.checked) theme.success else theme.muted);

    const glyph: []const u8 = switch (options.variant) {
        .toggle => if (options.checked) "[▮ ]" else "[ ▮]",
        .radio => if (options.checked) "(●)" else "( )",
        .checkbox => if (options.checked) "[✓]" else "[ ]",
    };

    const attrs: Attrs = if (options.focused) .bold_only else .none;
    var x = s.text(0, 0, glyph, .{ .fg = c, .attrs = attrs });
    if (options.label.len > 0) {
        var label_buf: [256]u8 = undefined;
        const labelled = std.fmt.bufPrint(&label_buf, " {s}", .{options.label}) catch return x;
        x += s.text(@intCast(x), 0, labelled, .{
            .fg = if (options.focused) theme.foreground else theme.muted,
            .attrs = attrs,
        });
    }
    return x;
}

pub const SelectOptions = struct {
    value: []const u8 = "",
    focused: bool = false,
    open: bool = false,
    options: []const []const u8 = &.{},
    selected_index: usize = 0,
    width: ?usize = null,
    color: ?Color = null,
};

/// A closed dropdown, or an open one with its option list underneath.
pub fn drawSelect(s: Surface, options: SelectOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const width = @min(options.width orelse s.width(), s.width());
    const c = options.color orelse
        (if (options.focused) theme.border_focused else theme.border);
    const field_bg = theme_mod.elevate(theme.*, 0.05);

    var value_cut: [256]u8 = undefined;
    var label_buf: [256]u8 = undefined;
    const value = unicode.truncate(&value_cut, options.value, width -| 4);
    const label = std.fmt.bufPrint(&label_buf, " {s}", .{value}) catch " ";

    var padded: [256]u8 = undefined;
    _ = s.text(0, 0, unicode.fit(&padded, label, width -| 2, .left), .{
        .fg = theme.foreground,
        .bg = field_bg,
        .attrs = if (options.focused) Attrs.bold_only else Attrs.none,
    });
    _ = s.text(
        @as(isize, @intCast(width)) - 2,
        0,
        if (options.open) " ▴" else " ▾",
        .{ .fg = c, .bg = field_bg },
    );

    if (options.open and options.options.len > 0) {
        const height = @min(options.options.len, s.height() -| 1);
        const list_bg = theme_mod.elevate(theme.*, 0.08);
        for (0..height) |i| {
            const selected = i == options.selected_index;
            var item_cut: [256]u8 = undefined;
            var item_buf: [256]u8 = undefined;
            var item_padded: [256]u8 = undefined;
            const item = unicode.truncate(&item_cut, options.options[i], width -| 2);
            const spaced = std.fmt.bufPrint(&item_buf, " {s}", .{item}) catch " ";
            _ = s.text(0, @intCast(i + 1), unicode.fit(&item_padded, spaced, width, .left), .{
                .fg = if (selected) theme.selection_text else theme.foreground,
                .bg = if (selected) theme.selection else list_bg,
            });
        }
    }
}

pub const TextInputOptions = struct {
    value: []const u8 = "",
    placeholder: []const u8 = "",
    focused: bool = false,
    /// Caret index; null means the end of the value.
    cursor: ?usize = null,
    width: ?usize = null,
    label: []const u8 = "",
    password: bool = false,
    color: ?Color = null,
};

pub fn drawTextInput(s: Surface, options: TextInputOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const width = @min(options.width orelse s.width(), s.width());
    const label_width: usize = if (options.label.len > 0)
        unicode.stringWidth(options.label) + 1
    else
        0;
    if (options.label.len > 0) {
        _ = s.text(0, 0, options.label, .{ .fg = theme.muted });
    }
    const field_width = width -| label_width;
    const bg = theme_mod.elevate(theme.*, if (options.focused) 0.1 else 0.05);
    s.fillRect(@intCast(label_width), 0, field_width, 1, .{ .bg = bg }, 32);

    // The reference counts UTF-16 units for the password mask and the default
    // caret; counting codepoints is the same for every value a person types and
    // is what a Zig caller would expect.
    var mask_buf: [256]u8 = undefined;
    var shown = options.value;
    if (options.password) {
        var n: usize = 0;
        var it = std.unicode.Utf8Iterator{ .bytes = options.value, .i = 0 };
        while (it.nextCodepoint()) |_| : (n += 1) {
            if ((n + 1) * 3 > mask_buf.len) break;
            @memcpy(mask_buf[n * 3 ..][0..3], "•");
        }
        shown = mask_buf[0 .. n * 3];
    }
    const empty = shown.len == 0;
    const text = if (empty) options.placeholder else shown;

    var cut: [256]u8 = undefined;
    _ = s.text(
        @as(isize, @intCast(label_width)) + 1,
        0,
        unicode.truncate(&cut, text, field_width -| 2),
        .{ .fg = if (empty) theme.muted else theme.foreground, .bg = bg },
    );

    if (options.focused) {
        const caret = options.cursor orelse unicode.stringWidth(shown);
        const cursor_x = @min(label_width + 1 + caret, label_width + (field_width -| 1));
        s.styleRect(@intCast(cursor_x), 0, 1, 1, .{
            .fg = theme.background,
            .bg = options.color orelse theme.cursor,
        });
    }
}

/// Underline the active tab instead of filling it.
pub const TabVariant = enum { filled, underline };

pub const TabsOptions = struct {
    tabs: []const []const u8 = &.{},
    active: usize = 0,
    color: ?Color = null,
    alignment: Align = .left,
    variant: TabVariant = .filled,
};

pub fn drawTabs(s: Surface, options: TabsOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const c = options.color orelse theme.accent;

    var total: usize = 0;
    for (options.tabs) |t| total += unicode.stringWidth(t) + 4;

    const width: isize = @intCast(s.width());
    var x: isize = switch (options.alignment) {
        .center => @max(0, @divFloor(width - @as(isize, @intCast(total)), 2)),
        .right => @max(0, width - @as(isize, @intCast(total))),
        .left => 0,
    };

    for (options.tabs, 0..) |tab, i| {
        var label_buf: [256]u8 = undefined;
        const label = std.fmt.bufPrint(&label_buf, "  {s}  ", .{tab}) catch continue;
        const style: Style = if (i == options.active) switch (options.variant) {
            .underline => .{ .fg = c, .attrs = .{ .bold = true, .underline = true } },
            .filled => .{
                .fg = if (theme.dark) theme.background else theme.surface,
                .bg = c,
                .attrs = .bold_only,
            },
        } else .{ .fg = theme.muted };
        x += @intCast(s.text(x, 0, label, TextOptions.fromStyle(style)));
    }
}

pub const ModalButton = struct {
    label: []const u8 = "",
    variant: ButtonVariant = .primary,
    focused: bool = false,
};

pub const ModalOptions = struct {
    title: []const u8 = "",
    message: []const u8 = "",
    width: ?usize = null,
    height: ?usize = null,
    /// Dim the screen behind the dialog.
    backdrop: bool = true,
    buttons: []const ModalButton = &.{},
    color: ?Color = null,
    alignment: Align = .center,
};

/// Centres a dialog over the whole surface and returns its interior, so callers
/// can draw custom content instead of `message` if they want to.
pub fn drawModal(allocator: std.mem.Allocator, root: Surface, options: ModalOptions) !Surface {
    const theme = root.theme;
    if (options.backdrop) {
        // Dim rather than blank: the dashboard stays legible behind the dialog.
        root.styleRect(0, 0, root.width(), root.height(), .{
            .fg = theme.foreground.mix(theme.background, 0.72),
        });
    }

    const width = @min(options.width orelse 48, root.width() -| 2);

    var message_lines: usize = 0;
    if (options.message.len > 0) message_lines = unicode.wrapCount(options.message, width -| 4);
    const default_height = message_lines + @as(usize, if (options.buttons.len > 0) 5 else 4);
    const height = @min(options.height orelse default_height, root.height() -| 2);

    const x = @max(0, @divFloor(@as(isize, @intCast(root.width())) - @as(isize, @intCast(width)), 2));
    const y = @max(0, @divFloor(@as(isize, @intCast(root.height())) - @as(isize, @intCast(height)), 2));

    const s = root.sub(x, y, width, height);
    const inner = s.box(.{
        .title = options.title,
        .title_align = options.alignment,
        .border = .rounded,
        .border_color = options.color orelse theme.border_focused,
        .bg = theme_mod.elevate(theme.*, 0.08),
    });

    if (options.message.len > 0) {
        const lines = try unicode.wrap(allocator, options.message, inner.width() -| 2);
        defer unicode.freeWrapped(allocator, lines);
        for (lines, 0..) |line, i| {
            if (i + 1 >= inner.height()) break;
            var padded: [512]u8 = undefined;
            _ = inner.text(
                1,
                @intCast(i + 1),
                unicode.fit(&padded, line, inner.width() -| 2, options.alignment),
                .{ .fg = theme.foreground },
            );
        }
    }

    if (options.buttons.len > 0) {
        var total: isize = -2;
        for (options.buttons) |b| total += @intCast(unicode.stringWidth(b.label) + 4 + 2);
        var bx: isize = @max(0, @divFloor(@as(isize, @intCast(inner.width())) - total, 2));
        const by: isize = @as(isize, @intCast(inner.height())) - 2;
        for (options.buttons) |button| {
            const bw = unicode.stringWidth(button.label) + 4;
            _ = drawButton(inner.sub(bx, by, bw, 1), .{
                .label = button.label,
                .variant = button.variant,
                .focused = button.focused,
                .width = bw,
            });
            bx += @as(isize, @intCast(bw)) + 2;
        }
    }

    return inner;
}

pub const PaletteItem = struct {
    label: []const u8 = "",
    hint: []const u8 = "",
};

pub const CommandPaletteOptions = struct {
    query: []const u8 = "",
    items: []const PaletteItem = &.{},
    selected: usize = 0,
    width: ?usize = null,
    height: ?usize = null,
    placeholder: []const u8 = "",
};

/// Ctrl+K style palette: a query line above a filtered list.
pub fn drawCommandPalette(root: Surface, options: CommandPaletteOptions) void {
    const theme = root.theme;
    const width = @min(options.width orelse 60, root.width() -| 2);
    const default_height = @min(options.items.len + 4, 14);
    const height = @min(options.height orelse default_height, root.height() -| 2);

    const x = @max(0, @divFloor(@as(isize, @intCast(root.width())) - @as(isize, @intCast(width)), 2));
    const y = @max(1, @as(isize, @intCast(root.height() / 5)));

    root.styleRect(0, 0, root.width(), root.height(), .{
        .fg = theme.foreground.mix(theme.background, 0.7),
    });

    const s = root.sub(x, y, width, height);
    const inner = s.box(.{
        .border = .rounded,
        .border_color = theme.border_focused,
        .bg = theme_mod.elevate(theme.*, 0.1),
        .title = "Command Palette",
    });

    _ = inner.text(0, 0, "› ", .{ .fg = theme.accent, .attrs = .bold_only });
    const query_empty = options.query.len == 0;
    const query = if (!query_empty)
        options.query
    else if (options.placeholder.len > 0)
        options.placeholder
    else
        "Type a command…";
    _ = inner.text(2, 0, query, .{
        .fg = if (query_empty) theme.muted else theme.foreground,
    });
    inner.hline(0, 1, inner.width(), '─', .{ .fg = theme.border });

    const list_height = inner.height() -| 2;
    for (0..list_height) |i| {
        if (i >= options.items.len) break;
        const item = options.items[i];
        const selected = i == options.selected;
        const yy: isize = @intCast(i + 2);
        if (selected) inner.fillRect(0, yy, inner.width(), 1, .{ .bg = theme.selection }, 32);

        var cut: [256]u8 = undefined;
        _ = inner.text(1, yy, unicode.truncate(&cut, item.label, inner.width() -| 2), .{
            .fg = if (selected) theme.selection_text else theme.foreground,
            .bg = if (selected) theme.selection else null,
            .attrs = if (selected) Attrs.bold_only else Attrs.none,
        });

        if (item.hint.len > 0) {
            const hw = unicode.stringWidth(item.hint);
            if (hw + 3 < inner.width()) {
                _ = inner.text(@intCast(inner.width() - hw - 1), yy, item.hint, .{
                    .fg = theme.muted,
                    .bg = if (selected) theme.selection else null,
                });
            }
        }
    }
}

pub const TooltipOptions = struct {
    text: []const u8 = "",
    x: isize = 0,
    y: isize = 0,
    color: ?Color = null,
};

pub fn drawTooltip(root: Surface, options: TooltipOptions) void {
    const theme = root.theme;
    const width = @min(unicode.stringWidth(options.text) + 4, root.width());
    const x = @max(0, @min(options.x, @as(isize, @intCast(root.width())) - @as(isize, @intCast(width))));
    const y = @max(0, @min(options.y, @as(isize, @intCast(root.height())) - 3));

    const s = root.sub(x, y, width, 3);
    const inner = s.box(.{
        .border = .rounded,
        .border_color = options.color orelse theme.border_focused,
        .bg = theme_mod.elevate(theme.*, 0.12),
    });
    var cut: [256]u8 = undefined;
    _ = inner.text(0, 0, unicode.truncate(&cut, options.text, inner.width()), .{
        .fg = theme.foreground,
    });
}
