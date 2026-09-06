//! A clipped, translated view onto the framebuffer. Widgets only ever see a
//! `Surface`, so nothing can draw outside the rectangle it was given.

const std = @import("std");

const buffer_mod = @import("buffer.zig");
const color_mod = @import("color.zig");
const layout = @import("layout.zig");
const theme_mod = @import("theme.zig");
const unicode = @import("unicode.zig");

const Attrs = buffer_mod.Attrs;
const Cell = unicode.Cell;
const Color = color_mod.Color;
const FrameBuffer = buffer_mod.FrameBuffer;
const Padding = layout.Padding;
const Rect = layout.Rect;
const Style = buffer_mod.Style;
const Theme = theme_mod.Theme;

pub const BorderStyle = enum {
    rounded,
    single,
    double,
    thick,
    dashed,
    ascii,
    none,

    pub fn parse(name: []const u8) BorderStyle {
        inline for (@typeInfo(BorderStyle).@"enum".fields) |field| {
            if (std.mem.eql(u8, field.name, name)) return @enumFromInt(field.value);
        }
        return .rounded;
    }

    pub fn chars(self: BorderStyle) ?BorderChars {
        return switch (self) {
            .rounded => .{ .tl = '╭', .tr = '╮', .bl = '╰', .br = '╯', .h = '─', .v = '│' },
            .single => .{ .tl = '┌', .tr = '┐', .bl = '└', .br = '┘', .h = '─', .v = '│' },
            .double => .{ .tl = '╔', .tr = '╗', .bl = '╚', .br = '╝', .h = '═', .v = '║' },
            .thick => .{ .tl = '┏', .tr = '┓', .bl = '┗', .br = '┛', .h = '━', .v = '┃' },
            .dashed => .{ .tl = '╭', .tr = '╮', .bl = '╰', .br = '╯', .h = '╌', .v = '╎' },
            .ascii => .{ .tl = '+', .tr = '+', .bl = '+', .br = '+', .h = '-', .v = '|' },
            .none => null,
        };
    }
};

pub const BorderChars = struct {
    tl: u21,
    tr: u21,
    bl: u21,
    br: u21,
    h: u21,
    v: u21,
};

/// How a run of text is drawn into a surface.
pub const TextOptions = struct {
    fg: ?Color = null,
    bg: ?Color = null,
    attrs: ?Attrs = null,
    alignment: unicode.Align = .left,
    /// Truncate with an ellipsis instead of clipping mid-word.
    ellipsis: bool = true,
    max_width: ?usize = null,

    pub fn style(self: TextOptions) Style {
        return .{ .fg = self.fg, .bg = self.bg, .attrs = self.attrs };
    }

    pub fn fromStyle(s: Style) TextOptions {
        return .{ .fg = s.fg, .bg = s.bg, .attrs = s.attrs };
    }
};

/// A bordered box: the workhorse behind every panel in the library.
pub const BoxOptions = struct {
    bg: ?Color = null,
    border: BorderStyle = .rounded,
    border_color: ?Color = null,
    title: []const u8 = "",
    title_align: unicode.Align = .left,
    title_color: ?Color = null,
    /// Right-aligned text on the top border, e.g. a value or a hint.
    subtitle: []const u8 = "",
    subtitle_color: ?Color = null,
    /// Paint the interior with `bg` before drawing.
    fill: bool = true,
    footer: []const u8 = "",
    footer_color: ?Color = null,
};

pub const Surface = struct {
    buffer: *FrameBuffer,
    rect: Rect,
    clip: Rect,
    theme: *const Theme,

    pub fn init(buf: *FrameBuffer, rect: Rect, theme: *const Theme, clip: ?Rect) Surface {
        return .{
            .buffer = buf,
            .rect = rect,
            .clip = if (clip) |c| rect.intersect(c) else rect,
            .theme = theme,
        };
    }

    /// A surface covering a whole framebuffer.
    pub fn root(buf: *FrameBuffer, theme: *const Theme) Surface {
        return init(buf, .{ .width = buf.width, .height = buf.height }, theme, null);
    }

    pub fn width(self: Surface) usize {
        return self.rect.width;
    }

    pub fn height(self: Surface) usize {
        return self.rect.height;
    }

    pub fn isEmpty(self: Surface) bool {
        return self.rect.isEmpty();
    }

    /// A child surface in local coordinates, clipped to this one.
    pub fn sub(self: Surface, x: isize, y: isize, w: usize, h: usize) Surface {
        return init(
            self.buffer,
            .{ .x = self.rect.x + x, .y = self.rect.y + y, .width = w, .height = h },
            self.theme,
            self.clip,
        );
    }

    /// A child surface from an absolute rect, as the layout solver produces.
    pub fn region(self: Surface, rect: Rect) Surface {
        return init(self.buffer, rect, self.theme, self.clip);
    }

    pub fn inset(self: Surface, padding: Padding) Surface {
        return self.region(self.rect.inset(padding));
    }

    /// Absolute rect of this surface, for hit-testing mouse events.
    pub fn hitRect(self: Surface) Rect {
        return self.rect;
    }

    pub fn char(self: Surface, x: isize, y: isize, value: Cell, style: Style) void {
        const ax = self.rect.x + x;
        const ay = self.rect.y + y;
        if (!self.clip.contains(ax, ay)) return;
        _ = self.buffer.setCell(ax, ay, value, style);
    }

    /// Convenience for the common case of a literal glyph.
    pub fn glyph(self: Surface, x: isize, y: isize, value: u21, style: Style) void {
        self.char(x, y, @as(Cell, value), style);
    }

    /// Draw text at local (x, y). Returns columns written.
    pub fn text(self: Surface, x: isize, y: isize, content: []const u8, options: TextOptions) usize {
        const ay = self.rect.y + y;
        if (ay < self.clip.y or ay >= self.clip.y + @as(isize, @intCast(self.clip.height))) {
            return 0;
        }
        const room: usize = @intCast(@max(0, @as(isize, @intCast(self.width())) - x));
        const limit = if (options.max_width) |m| @min(m, room) else room;
        if (limit == 0) return 0;

        var scratch: [4096]u8 = undefined;
        var shown = content;
        if (options.ellipsis and unicode.stringWidth(shown) > limit) {
            shown = unicode.truncate(&scratch, shown, limit);
        }
        var aligned: [4096]u8 = undefined;
        if (options.alignment != .left) {
            shown = unicode.fit(&aligned, shown, limit, options.alignment);
        }

        const style = options.style();
        var cx = self.rect.x + x;
        var written: usize = 0;
        var it = unicode.graphemes(shown);
        while (it.next()) |g| {
            if (written + g.width > limit) break;
            if (cx >= self.clip.x and
                cx + @as(isize, @intCast(g.width)) <=
                    self.clip.x + @as(isize, @intCast(self.clip.width)))
            {
                _ = self.buffer.setCell(cx, ay, g.value, style);
            }
            cx += @intCast(g.width);
            written += g.width;
        }
        return written;
    }

    /// Text positioned within the full surface width.
    pub fn textAligned(
        self: Surface,
        y: isize,
        content: []const u8,
        alignment: unicode.Align,
        options: TextOptions,
    ) void {
        var truncated: [4096]u8 = undefined;
        var padded: [4096]u8 = undefined;
        const cut = unicode.truncate(&truncated, content, self.width());
        const shown = unicode.fit(&padded, cut, self.width(), alignment);
        var o = options;
        o.alignment = .left;
        _ = self.text(0, y, shown, o);
    }

    pub fn fill(self: Surface, style: Style) void {
        self.fillRect(0, 0, self.width(), self.height(), style, 32);
    }

    pub fn fillRect(self: Surface, x: isize, y: isize, w: usize, h: usize, style: Style, ch: Cell) void {
        const abs = (Rect{
            .x = self.rect.x + x,
            .y = self.rect.y + y,
            .width = w,
            .height = h,
        }).intersect(self.clip);
        if (abs.isEmpty()) return;
        self.buffer.fillRect(abs.x, abs.y, abs.width, abs.height, ch, style);
    }

    pub fn styleRect(self: Surface, x: isize, y: isize, w: usize, h: usize, style: Style) void {
        const abs = (Rect{
            .x = self.rect.x + x,
            .y = self.rect.y + y,
            .width = w,
            .height = h,
        }).intersect(self.clip);
        if (abs.isEmpty()) return;
        self.buffer.styleRect(abs.x, abs.y, abs.width, abs.height, style);
    }

    pub fn hline(self: Surface, x: isize, y: isize, length: usize, ch: u21, style: Style) void {
        for (0..length) |i| self.glyph(x + @as(isize, @intCast(i)), y, ch, style);
    }

    pub fn vline(self: Surface, x: isize, y: isize, length: usize, ch: u21, style: Style) void {
        for (0..length) |i| self.glyph(x, y + @as(isize, @intCast(i)), ch, style);
    }

    /// Draw a bordered box with an optional title, and return the interior
    /// surface. Every panel in the library goes through here.
    pub fn box(self: Surface, options: BoxOptions) Surface {
        const fg = options.border_color orelse self.theme.border;
        const bg = options.bg;

        if (options.fill) {
            if (bg) |v| self.fill(.{ .bg = v });
        }

        const chars = options.border.chars() orelse return self.inset(.none);
        if (self.width() < 2 or self.height() < 1) return self.inset(Padding.all(1));

        const w = self.width();
        const h = self.height();
        const border_style: Style = .{ .fg = fg, .bg = bg };

        self.glyph(0, 0, chars.tl, border_style);
        self.glyph(@intCast(w - 1), 0, chars.tr, border_style);
        self.hline(1, 0, w - 2, chars.h, border_style);
        if (h > 1) {
            self.glyph(0, @intCast(h - 1), chars.bl, border_style);
            self.glyph(@intCast(w - 1), @intCast(h - 1), chars.br, border_style);
            self.hline(1, @intCast(h - 1), w - 2, chars.h, border_style);
            self.vline(0, 1, h - 2, chars.v, border_style);
            self.vline(@intCast(w - 1), 1, h - 2, chars.v, border_style);
        }

        // Measured before the title is drawn: both share the top border row, and
        // the title used to be truncated against the full width and then painted
        // over by the subtitle.
        var subtitle_buf: [256]u8 = undefined;
        var subtitle: []const u8 = "";
        var subtitle_width: usize = 0;
        if (options.subtitle.len > 0 and options.subtitle.len + 2 <= subtitle_buf.len) {
            subtitle = std.fmt.bufPrint(&subtitle_buf, " {s} ", .{options.subtitle}) catch "";
            if (unicode.stringWidth(subtitle) + 4 < w) {
                subtitle_width = unicode.stringWidth(subtitle);
            }
        }

        if (options.title.len > 0) {
            var label_buf: [256]u8 = undefined;
            const label = std.fmt.bufPrint(&label_buf, " {s} ", .{options.title}) catch "";
            // The title lives in [2, limit). Reserving the width is not enough
            // on its own: right- and centre-aligned titles are positioned from
            // the panel edge, so they would still be drawn over the subtitle —
            // and a wide glyph straddling the boundary bisects it, leaving an
            // orphaned half-character. Both labels carry a space of padding, and
            // those two spaces may share a column, so the region ends one past
            // the subtitle when there is one.
            const limit: isize = if (subtitle_width > 0)
                @as(isize, @intCast(w)) - 1 - @as(isize, @intCast(subtitle_width))
            else
                @as(isize, @intCast(w)) - 2;
            const room: usize = @intCast(@max(0, limit - 2));
            var shown_buf: [256]u8 = undefined;
            const shown = unicode.truncate(&shown_buf, label, room);
            const tw: isize = @intCast(unicode.stringWidth(shown));
            const tx: isize = switch (options.title_align) {
                .left => 2,
                .right => @max(2, limit - tw),
                .center => @max(2, @min(limit - tw, @divFloor(@as(isize, @intCast(w)) - tw, 2))),
            };
            _ = self.text(tx, 0, shown, .{
                .fg = options.title_color orelse self.theme.title,
                .bg = bg,
                .attrs = .bold_only,
            });
        }

        if (subtitle_width > 0) {
            _ = self.text(
                @as(isize, @intCast(w)) - 2 - @as(isize, @intCast(subtitle_width)),
                0,
                subtitle,
                .{ .fg = options.subtitle_color orelse self.theme.muted, .bg = bg },
            );
        }

        if (options.footer.len > 0 and h > 2) {
            var footer_buf: [256]u8 = undefined;
            const foot = std.fmt.bufPrint(&footer_buf, " {s} ", .{options.footer}) catch "";
            if (unicode.stringWidth(foot) + 4 < w) {
                _ = self.text(2, @intCast(h - 1), foot, .{
                    .fg = options.footer_color orelse self.theme.muted,
                    .bg = bg,
                });
            }
        }

        return self.sub(1, 1, w -| 2, h -| 2);
    }
};
