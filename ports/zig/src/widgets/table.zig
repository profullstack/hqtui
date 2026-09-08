//! Dense data widgets: tables, lists, trees, tailing logs and the scrollbar they
//! share.
//!
//! The reference implementation is generic over a row type and reads cells with
//! a key or a `render` callback. Zig takes the cells already stringified —
//! `.{ .cells = &.{ "1", "systemd" } }` — which keeps the widget free of type
//! parameters and puts the formatting where the data lives.

const std = @import("std");

const buffer_mod = @import("../buffer.zig");
const color_mod = @import("../color.zig");
const layout = @import("../layout.zig");
const surface_mod = @import("../surface.zig");
const theme_mod = @import("../theme.zig");
const unicode = @import("../unicode.zig");

const Align = unicode.Align;
const Attrs = buffer_mod.Attrs;
const Color = color_mod.Color;
const Constraint = layout.Constraint;
const Style = buffer_mod.Style;
const Surface = surface_mod.Surface;
const roundHalfUp = color_mod.roundHalfUp;
const drawScrollbar = @import("scrollbar.zig").drawScrollbar;

pub const TableColumn = struct {
    title: []const u8 = "",
    width: ?layout.Size = null,
    min: ?usize = null,
    max: ?usize = null,
    alignment: Align = .left,
    color: ?Color = null,
};

pub const TableRow = struct {
    cells: []const []const u8 = &.{},
    /// Colors the whole row, unless the column or the cell says otherwise.
    color: ?Color = null,
    /// Per-cell colors, standing in for the reference's per-column color
    /// function. Where an entry exists for a column it wins outright, including
    /// when it is null — which is what that callback returning undefined does.
    cell_colors: []const ?Color = &.{},
};

pub const TableOptions = struct {
    rows: []const TableRow = &.{},
    columns: []const TableColumn = &.{},
    header: bool = true,
    header_color: ?Color = null,
    /// Index of the highlighted row.
    selected: ?usize = null,
    /// First visible row; combine with `selected` for scrolling lists.
    offset: ?usize = null,
    /// Scroll so `selected` stays visible. Only the table knows how many rows
    /// fit, so working the offset out here saves every caller from tracking
    /// heights.
    follow_selection: bool = false,
    zebra: bool = false,
    gap: usize = 1,
    background: ?Color = null,
    /// Show a scrollbar in the last column when rows overflow.
    scrollbar: bool = false,
};

/// Where the visible window should start: the caller's offset, nudged just far
/// enough to keep the selected row on screen, and clamped to the list.
pub fn resolveOffset(
    offset: ?usize,
    selected: ?usize,
    capacity: usize,
    total: usize,
    follow: bool,
) usize {
    const max_offset = total -| capacity;
    var start = @min(offset orelse 0, max_offset);
    if (follow and capacity > 0) {
        if (selected) |sel| {
            if (sel < start) {
                start = sel;
            } else if (sel >= start + capacity) {
                start = sel - capacity + 1;
            }
        }
    }
    return @min(start, max_offset);
}

/// A dense, column-aligned table with optional selection and scrollbar.
pub fn drawTable(allocator: std.mem.Allocator, s: Surface, options: TableOptions) !void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const gap = options.gap;
    const header_rows: usize = if (options.header) 1 else 0;
    const body_width = s.width() -| @as(usize, if (options.scrollbar) 1 else 0);

    const constraints = try allocator.alloc(Constraint, options.columns.len);
    defer allocator.free(constraints);
    for (options.columns, 0..) |c, ci| {
        var intrinsic: usize = 0;
        if (c.width == null) {
            // The reference samples the first 200 rows, which is what keeps an
            // auto column cheap on a long table.
            var widest: usize = 0;
            for (options.rows[0..@min(200, options.rows.len)]) |r| {
                if (ci < r.cells.len) widest = @max(widest, unicode.stringWidth(r.cells[ci]));
            }
            intrinsic = @max(unicode.stringWidth(c.title), widest);
        }
        constraints[ci] = .{
            .size = c.width orelse .auto,
            .min = c.min orelse 1,
            .max = c.max,
            .intrinsic = intrinsic,
        };
    }
    const widths = try layout.solve(allocator, body_width, constraints, gap);
    defer allocator.free(widths);

    var cut: [512]u8 = undefined;
    var padded: [512]u8 = undefined;

    if (options.header) {
        var x: isize = 0;
        for (options.columns, 0..) |column, i| {
            const w = widths[i];
            if (w == 0) continue;
            const shown = unicode.fit(
                &padded,
                unicode.truncate(&cut, column.title, w),
                w,
                column.alignment,
            );
            _ = s.text(x, 0, shown, .{
                .fg = options.header_color orelse theme.muted,
                .bg = options.background,
                .attrs = .bold_only,
            });
            x += @intCast(w + gap);
        }
    }

    const capacity = s.height() -| header_rows;
    const offset = resolveOffset(
        options.offset,
        options.selected,
        capacity,
        options.rows.len,
        options.follow_selection,
    );
    const zebra_bg: ?Color = if (options.zebra) theme_mod.elevate(theme.*, 0.04) else null;

    for (0..capacity) |i| {
        const row_index = offset + i;
        if (row_index >= options.rows.len) break;
        const row = options.rows[row_index];
        const y: isize = @intCast(i + header_rows);
        const selected = options.selected != null and options.selected.? == row_index;

        const row_bg: ?Color = if (selected)
            theme.selection
        else if (options.zebra and row_index % 2 == 1)
            zebra_bg
        else
            options.background;
        if (row_bg) |bg| s.fillRect(0, y, body_width, 1, .{ .bg = bg }, 32);

        var x: isize = 0;
        for (options.columns, 0..) |column, ci| {
            const w = widths[ci];
            if (w == 0) continue;
            const text = if (ci < row.cells.len) row.cells[ci] else "";
            const fg: ?Color = if (selected)
                theme.selection_text
            else if (ci < row.cell_colors.len)
                row.cell_colors[ci]
            else if (column.color) |c|
                c
            else
                row.color;
            const shown = unicode.fit(
                &padded,
                unicode.truncate(&cut, text, w),
                w,
                column.alignment,
            );
            _ = s.text(x, y, shown, .{
                .fg = fg orelse theme.foreground,
                .bg = row_bg,
                .attrs = if (selected) Attrs.bold_only else Attrs.none,
            });
            x += @intCast(w + gap);
        }
    }

    if (options.scrollbar and options.rows.len > capacity and capacity > 0) {
        drawScrollbar(
            s,
            @as(isize, @intCast(s.width())) - 1,
            @intCast(header_rows),
            capacity,
            options.rows.len,
            offset,
        );
    }
}

pub const ListItem = struct {
    label: []const u8 = "",
    color: ?Color = null,
    badge: []const u8 = "",
};

pub const ListOptions = struct {
    items: []const ListItem = &.{},
    selected: ?usize = null,
    offset: ?usize = null,
    /// Scroll so `selected` stays visible.
    follow_selection: bool = false,
    background: ?Color = null,
    bullet: []const u8 = "",
    scrollbar: bool = false,
};

pub fn drawList(s: Surface, options: ListOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;
    const width = s.width() -| @as(usize, if (options.scrollbar) 1 else 0);
    const offset = resolveOffset(
        options.offset,
        options.selected,
        s.height(),
        options.items.len,
        options.follow_selection,
    );

    for (0..s.height()) |i| {
        const index = offset + i;
        if (index >= options.items.len) break;
        const item = options.items[index];
        const selected = options.selected != null and options.selected.? == index;

        var label_buf: [512]u8 = undefined;
        const label = if (options.bullet.len > 0)
            (std.fmt.bufPrint(&label_buf, "{s} {s}", .{ options.bullet, item.label }) catch item.label)
        else
            item.label;

        if (selected) s.fillRect(0, @intCast(i), width, 1, .{ .bg = theme.selection }, 32);

        var cut: [512]u8 = undefined;
        var padded: [512]u8 = undefined;
        const shown = unicode.fit(&padded, unicode.truncate(&cut, label, width), width, .left);
        _ = s.text(0, @intCast(i), shown, .{
            .fg = if (selected) theme.selection_text else (item.color orelse theme.foreground),
            .bg = if (selected) theme.selection else options.background,
            .attrs = if (selected) Attrs.bold_only else Attrs.none,
        });
    }

    if (options.scrollbar and options.items.len > s.height()) {
        drawScrollbar(
            s,
            @as(isize, @intCast(s.width())) - 1,
            0,
            s.height(),
            options.items.len,
            offset,
        );
    }
}

pub const TreeValue = struct {
    text: []const u8 = "",
    width: usize = 0,
    color: ?Color = null,
    alignment: Align = .right,
};

pub const TreeNode = struct {
    label: []const u8 = "",
    color: ?Color = null,
    /// Right-aligned columns, e.g. CPU% and MEM% in a process tree.
    values: []const TreeValue = &.{},
    children: []const TreeNode = &.{},
    expanded: bool = true,
};

pub const TreeOptions = struct {
    nodes: []const TreeNode = &.{},
    selected: ?usize = null,
    offset: ?usize = null,
    follow_selection: bool = false,
    background: ?Color = null,
    /// Draw the ├─ └─ connectors.
    guides: bool = true,
    guide_color: ?Color = null,
};

const FlatNode = struct {
    node: TreeNode,
    depth: usize,
    /// One flag per level: whether that ancestor was the last of its siblings.
    last: []bool,
};

fn flatten(
    allocator: std.mem.Allocator,
    nodes: []const TreeNode,
    depth: usize,
    trail: []const bool,
    out: *std.ArrayList(FlatNode),
) !void {
    for (nodes, 0..) |node, i| {
        const last = i == nodes.len - 1;
        const here = try allocator.alloc(bool, trail.len + 1);
        @memcpy(here[0..trail.len], trail);
        here[trail.len] = last;
        try out.append(allocator, .{ .node = node, .depth = depth, .last = here });
        if (node.children.len > 0 and node.expanded) {
            try flatten(allocator, node.children, depth + 1, here, out);
        }
    }
}

/// An indented tree with box-drawing connectors, like `pstree`.
pub fn drawTree(allocator: std.mem.Allocator, s: Surface, options: TreeOptions) !void {
    if (s.isEmpty()) return;
    const theme = s.theme;

    var flat: std.ArrayList(FlatNode) = .empty;
    defer {
        for (flat.items) |entry| allocator.free(entry.last);
        flat.deinit(allocator);
    }
    try flatten(allocator, options.nodes, 0, &.{}, &flat);

    const offset = resolveOffset(
        options.offset,
        options.selected,
        s.height(),
        flat.items.len,
        options.follow_selection,
    );
    const guide_color = options.guide_color orelse theme.border.mix(theme.foreground, 0.15);

    for (0..s.height()) |i| {
        const index = offset + i;
        if (index >= flat.items.len) break;
        const entry = flat.items[index];
        const selected = options.selected != null and options.selected.? == index;
        const bg: ?Color = if (selected) theme.selection else options.background;
        if (selected) s.fillRect(0, @intCast(i), s.width(), 1, .{ .bg = theme.selection }, 32);

        var prefix_buf: [512]u8 = undefined;
        var prefix_len: usize = 0;
        const appendPrefix = struct {
            fn f(buf: []u8, len: *usize, part: []const u8) void {
                if (len.* + part.len > buf.len) return;
                @memcpy(buf[len.*..][0..part.len], part);
                len.* += part.len;
            }
        }.f;

        if (options.guides) {
            for (0..entry.depth) |d| {
                appendPrefix(&prefix_buf, &prefix_len, if (entry.last[d]) "   " else "│  ");
            }
            appendPrefix(&prefix_buf, &prefix_len, if (entry.last[entry.depth]) "└─ " else "├─ ");
        } else {
            for (0..entry.depth) |_| appendPrefix(&prefix_buf, &prefix_len, "  ");
        }
        const prefix = prefix_buf[0..prefix_len];

        var values_width: usize = 0;
        for (entry.node.values) |v| values_width += v.width + 1;
        const label_width = s.width() -| values_width;

        var cut: [512]u8 = undefined;
        _ = s.text(0, @intCast(i), unicode.truncate(&cut, prefix, label_width), .{
            .fg = guide_color,
            .bg = bg,
        });
        const px = @min(unicode.stringWidth(prefix), label_width);

        var label_cut: [512]u8 = undefined;
        _ = s.text(
            @intCast(px),
            @intCast(i),
            unicode.truncate(&label_cut, entry.node.label, label_width -| px),
            .{
                .fg = if (selected) theme.selection_text else (entry.node.color orelse theme.foreground),
                .bg = bg,
                .attrs = if (selected) Attrs.bold_only else Attrs.none,
            },
        );

        var vx = label_width;
        for (entry.node.values) |value| {
            var value_cut: [256]u8 = undefined;
            var value_padded: [256]u8 = undefined;
            const shown = unicode.fit(
                &value_padded,
                unicode.truncate(&value_cut, value.text, value.width),
                value.width,
                value.alignment,
            );
            _ = s.text(@intCast(vx), @intCast(i), shown, .{
                .fg = if (selected) theme.selection_text else (value.color orelse theme.foreground),
                .bg = bg,
            });
            vx += value.width + 1;
        }
    }
}

pub const LogEntry = struct {
    message: []const u8 = "",
    time: []const u8 = "",
    level: []const u8 = "",
    meta: []const u8 = "",
    color: ?Color = null,
};

pub const LogLevelColor = struct { level: []const u8, color: Color };

pub const LogOptions = struct {
    entries: []const LogEntry = &.{},
    /// Pin to the newest entry. Set false to scroll with `offset`.
    follow: bool = true,
    offset: ?usize = null,
    /// Lines to scroll back from the newest entry. The natural control for a
    /// tailing log: only the widget knows how many rows fit, so an absolute
    /// offset makes small scrolls near the bottom clamp to nothing.
    from_end: usize = 0,
    scrollbar: bool = false,
    background: ?Color = null,
    level_colors: []const LogLevelColor = &.{},
    time_color: ?Color = null,
    meta_color: ?Color = null,
};

/// A tailing log view with colored levels. Newest at the bottom.
pub fn drawLog(s: Surface, options: LogOptions) void {
    if (s.isEmpty()) return;
    const theme = s.theme;

    const levelColor = struct {
        fn f(t: *const theme_mod.Theme, overrides: []const LogLevelColor, name: []const u8) Color {
            var upper_buf: [32]u8 = undefined;
            if (name.len > upper_buf.len) return t.foreground;
            const upper = std.ascii.upperString(upper_buf[0..name.len], name);
            for (overrides) |o| {
                if (std.mem.eql(u8, o.level, upper)) return o.color;
            }
            if (std.mem.eql(u8, upper, "ERROR") or std.mem.eql(u8, upper, "FATAL")) return t.danger;
            if (std.mem.eql(u8, upper, "WARN")) return t.warning;
            if (std.mem.eql(u8, upper, "INFO")) return t.success;
            if (std.mem.eql(u8, upper, "DEBUG") or std.mem.eql(u8, upper, "TRACE")) return t.muted;
            return t.foreground;
        }
    }.f;

    const width = s.width() -| @as(usize, if (options.scrollbar) 1 else 0);
    const max_start = options.entries.len -| s.height();
    const start: usize = if (options.follow or options.from_end > 0)
        @min(max_start, options.entries.len -| s.height() -| options.from_end)
    else
        resolveOffset(options.offset, null, s.height(), options.entries.len, false);

    for (0..s.height()) |i| {
        if (start + i >= options.entries.len) break;
        const entry = options.entries[start + i];
        var x: isize = 0;

        if (entry.time.len > 0) {
            var time_buf: [64]u8 = undefined;
            const timed = std.fmt.bufPrint(&time_buf, "{s} ", .{entry.time}) catch entry.time;
            x += @intCast(s.text(x, @intCast(i), timed, .{
                .fg = options.time_color orelse theme.muted,
                .bg = options.background,
            }));
        }
        if (entry.level.len > 0) {
            var upper_buf: [32]u8 = undefined;
            const upper = if (entry.level.len <= upper_buf.len)
                std.ascii.upperString(upper_buf[0..entry.level.len], entry.level)
            else
                entry.level;
            var padded: [32]u8 = undefined;
            x += @intCast(s.text(x, @intCast(i), unicode.fit(&padded, upper, 5, .left), .{
                .fg = levelColor(theme, options.level_colors, entry.level),
                .bg = options.background,
                .attrs = .bold_only,
            }));
            x += @intCast(s.text(x, @intCast(i), " ", .{ .bg = options.background }));
        }

        const meta_width: usize = if (entry.meta.len > 0)
            unicode.stringWidth(entry.meta) + 1
        else
            0;
        const msg_width: usize = @intCast(@max(
            0,
            @as(isize, @intCast(width)) - x - @as(isize, @intCast(meta_width)),
        ));
        var cut: [512]u8 = undefined;
        _ = s.text(x, @intCast(i), unicode.truncate(&cut, entry.message, msg_width), .{
            .fg = entry.color orelse theme.foreground,
            .bg = options.background,
        });

        if (entry.meta.len > 0 and meta_width < width) {
            _ = s.text(
                @intCast(width - meta_width + 1),
                @intCast(i),
                entry.meta,
                .{ .fg = options.meta_color orelse theme.muted, .bg = options.background },
            );
        }
    }
}
