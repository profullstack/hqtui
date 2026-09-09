//! Native reference screen helpers. All temporary data is owned by the frame
//! arena; no callback retains a pointer to a stack-local loop variable.
pub const std = @import("std");
pub const h = @import("hqtui");
pub const m = @import("model.zig");
pub const P = h.Container;
pub const V = m.Value;
pub const Color = h.color.Color;
pub const Size = h.layout.Size;
pub const C = struct {
    s: *m.State,
    v: V,
    index: usize = 0,
    color: ?Color = null,
    /// The size the enclosing row gave this panel, if it gave one. Null leaves
    /// the container's own default in place.
    size: ?Size = null,
    pub fn sub(c: *C, p: *P, v: V, index: usize) !*C {
        const child = try p.ctx.allocator.create(C);
        child.* = .{ .s = c.s, .v = v, .index = index, .color = c.color };
        return child;
    }
    /// Draw `f` with an explicit size, the way the reference demo passes one
    /// straight to the panel rather than wrapping it in a column.
    pub fn sized(c: *C, p: *P, size: Size, comptime f: fn (*C, *P) anyerror!void) !void {
        const child = try p.ctx.allocator.create(C);
        child.* = c.*;
        child.size = size;
        try f(child, p);
    }
    pub fn at(c: *C, path: []const u8) V {
        return m.at(c.v, path);
    }
    pub fn n(c: *C, path: []const u8) f64 {
        return m.num(c.at(path));
    }
    pub fn str(c: *C, path: []const u8) []const u8 {
        return m.string(c.at(path));
    }
    /// The seam a container of panels should use. Read it at the call site:
    /// the demo screens run under both border modes.
    pub fn panelGap(c: *C) usize {
        return c.s.panelGap();
    }
    pub fn row(c: *C, p: *P, size: Size, gap: usize, comptime f: fn (*C, *P) anyerror!void) !void {
        try p.row(.{ .layout = .{ .size = size, .gap = gap } }, h.Body.with(c, f));
    }
    pub fn col(c: *C, p: *P, size: Size, gap: usize, bordered: bool, comptime f: fn (*C, *P) anyerror!void) !void {
        try p.column(
            .{ .layout = .{ .size = size, .gap = gap, .bordered = bordered } },
            h.Body.with(c, f),
        );
    }
    pub fn panel(c: *C, p: *P, o: h.ui.PanelOptions, comptime f: fn (*C, *P) anyerror!void) !void {
        try p.panel(o, h.Body.with(c, f));
    }
};
pub fn root(s: *m.State, p: *P) !*C {
    const c = try p.ctx.allocator.create(C);
    c.* = .{ .s = s, .v = s.data() };
    return c;
}
pub fn tx(p: *P, text: []const u8, color: Color) !void {
    try p.text(text, .{ .fg = color });
}
pub fn scalar(p: *P, v: V) ![]const u8 {
    return switch (v) {
        .integer => |n| p.fmt("{d}", .{n}),
        .float => |n| p.fmt("{d}", .{n}),
        .string => |s| s,
        .bool => |b| if (b) "true" else "false",
        else => "—",
    };
}
pub fn pct(p: *P, v: f64) ![]const u8 {
    return p.fmt("{d:.0}%", .{@floor(std.math.clamp(v, 0, 1) * 100 + 0.5)});
}
pub fn bytes(p: *P, value: f64, digits: usize) ![]const u8 {
    if (!std.math.isFinite(value)) return "—";
    var v = @max(0, value);
    for ([_][]const u8{ "B", "KiB", "MiB", "GiB", "TiB", "PiB" }, 0..) |unit, i| {
        if (v < 1024 or i == 5) {
            return switch (if (i == 0) @as(usize, 0) else digits) {
                0 => p.fmt("{d:.0} {s}", .{ v, unit }),
                1 => p.fmt("{d:.1} {s}", .{ v, unit }),
                else => p.fmt("{d:.2} {s}", .{ v, unit }),
            };
        }
        v /= 1024;
    }
    return "";
}
pub fn bitRate(p: *P, v: f64) ![]const u8 {
    const b = @max(0, v) * 8;
    for ([_]f64{ 1e9, 1e6, 1e3 }, [_][]const u8{ "Gb/s", "Mb/s", "Kb/s" }) |scale, unit| {
        if (b >= scale) return p.fmt("{d:.1} {s}", .{ b / scale, unit });
    }
    return p.fmt("{d:.0} b/s", .{b});
}
pub fn byteRate(p: *P, v: f64) ![]const u8 {
    for ([_]f64{ 1e9, 1e6, 1e3 }, [_][]const u8{ "GB/s", "MB/s", "KB/s" }) |scale, unit| {
        if (v >= scale) return p.fmt("{d:.1} {s}", .{ v / scale, unit });
    }
    return p.fmt("{d:.0} B/s", .{@max(0, v)});
}
pub fn duration(p: *P, v: f64) ![]const u8 {
    const n: u64 = @intFromFloat(@max(0, v));
    const d = n / 86400;
    const hours = n % 86400 / 3600;
    const mins = n % 3600 / 60;
    if (d > 0) return p.fmt("{d}d {d}h {d}m", .{ d, hours, mins });
    if (hours > 0) return p.fmt("{d}h {d}m", .{ hours, mins });
    return p.fmt("{d}m {d}s", .{ mins, n % 60 });
}
pub fn kv(label: []const u8, value: []const u8, color: ?Color) h.widgets.KeyValueRow {
    return .{ .label = label, .value = value, .color = color };
}
pub fn keys(p: *P, rows: []const h.widgets.KeyValueRow, spread: bool) !void {
    try p.keyValues(.{ .rows = try p.ctx.allocator.dupe(h.widgets.KeyValueRow, rows), .spread = spread });
}
pub fn plot(p: *P, v: V, color: Color, maximum: ?f64, axis: bool) !void {
    try p.graph(.{ .values = try m.numbers(p.ctx.allocator, v), .axis = axis, .plot = .{ .min = 0, .max = maximum, .fill = true, .color = color } });
}
pub fn multi(p: *P, a: V, b: V, ca: Color, cb: Color) !void {
    const sr = try p.ctx.allocator.alloc(h.graphics.Series, 2);
    sr[0] = .{ .values = try m.numbers(p.ctx.allocator, a), .color = ca, .fill = true };
    sr[1] = .{ .values = try m.numbers(p.ctx.allocator, b), .color = cb, .fill = true };
    try p.graph(.{ .series = sr, .plot = .{ .min = 0 } });
}
pub fn meter(p: *P, v: f64, color: ?Color) !void {
    try p.meter(.{ .value = v, .color = color, .show_value = false, .style = .segmented });
}
pub fn sizedText(p: *P, value: []const u8, style: h.widgets.TextStyle, size: usize) !void {
    const T = struct {
        v: []const u8,
        style: h.widgets.TextStyle,
        fn draw(c: *@This(), q: *P) !void {
            try q.text(c.v, c.style);
        }
    };
    const c = try p.ctx.allocator.create(T);
    c.* = .{ .v = value, .style = style };
    try p.sized(.{ .cells = @intCast(size) }, h.Body.with(c, T.draw));
}
pub const DC = struct { key: []const u8, col: h.widgets.TableColumn, format: enum { raw, one, bytes0, pct, inodes } = .raw, tint: enum { none, cpu, state, login, ssh, status, service, usage } = .none };
pub fn dc(key: []const u8, title: []const u8, width: usize, minimum: usize, color: ?Color, right: bool) DC {
    return .{ .key = key, .col = .{ .title = title, .width = if (width > 0) .{ .cells = @intCast(width) } else null, .min = if (minimum > 0) minimum else null, .color = color, .alignment = if (right) .right else .left } };
}
pub fn statusColor(t: h.theme.Theme, name: []const u8) Color {
    return if (m.eq(name, "1xx")) t.secondary else if (m.eq(name, "2xx")) t.success else if (m.eq(name, "3xx")) t.accent else if (m.eq(name, "4xx")) t.warning else if (m.eq(name, "5xx")) t.danger else t.muted;
}
pub fn table(c: *C, p: *P, index: usize, data: []const V, columns: []const DC, zebra: bool, header: bool, scrollbar: bool) !void {
    const Table = struct {
        c: *C,
        index: usize,
        data: []const V,
        columns: []const DC,
        zebra: bool,
        header: bool,
        scrollbar: bool,
        fn draw(ctx: *@This(), surface: *P) anyerror!void {
            try drawTable(ctx.c, surface, ctx.index, ctx.data, ctx.columns, ctx.zebra, ctx.header, ctx.scrollbar);
        }
    };
    const ctx = try p.ctx.allocator.create(Table);
    ctx.* = .{ .c = c, .index = index, .data = data, .columns = try p.ctx.allocator.dupe(DC, columns), .zebra = zebra, .header = header, .scrollbar = scrollbar };
    try p.column(.{}, h.Body.with(ctx, Table.draw));
}
fn drawTable(c: *C, p: *P, index: usize, data: []const V, columns: []const DC, zebra: bool, header: bool, scrollbar: bool) !void {
    const a = p.ctx.allocator;
    const t = p.theme().*;
    const pane = &c.s.panes[c.s.screen * 8 + index];
    pane.total = data.len;
    pane.move(0);
    pane.offset = h.widgets.resolveOffset(pane.offset, pane.selected, p.height() -| @as(usize, if (header) 1 else 0), data.len, true);
    const cols = try a.alloc(h.widgets.TableColumn, columns.len);
    for (columns, 0..) |d, i| cols[i] = d.col;
    const rows = try a.alloc(h.widgets.TableRow, data.len);
    for (data, 0..) |d, i| {
        const cells = try a.alloc([]const u8, columns.len);
        const colors = try a.alloc(?Color, columns.len);
        for (columns, 0..) |co, j| {
            const v = m.get(d, co.key);
            cells[j] = switch (co.format) {
                .raw => try scalar(p, v),
                .one => try p.fmt("{d:.1}", .{m.num(v)}),
                .bytes0 => try bytes(p, m.num(v), 0),
                .pct => if (m.num(m.get(d, "size")) > 0) try pct(p, m.num(m.get(d, "used")) / m.num(m.get(d, "size"))) else "-",
                .inodes => if (m.num(m.get(d, "inodesTotal")) > 0) try p.fmt("{s} of {d:.1}M", .{ try pct(p, m.num(m.get(d, "inodesUsed")) / m.num(m.get(d, "inodesTotal"))), m.num(m.get(d, "inodesTotal")) / 1e6 }) else "-",
            };
            colors[j] = switch (co.tint) {
                .none => co.col.color,
                .cpu => h.theme.heatColor(t, @min(1, m.num(v) / 100)),
                .state => if (m.eq(m.string(v), "R")) t.success else t.muted,
                .login => if (m.eq(m.string(v), "still")) t.success else t.muted,
                .ssh => if (m.eq(m.string(v), "accepted")) t.success else if (m.eq(m.string(v), "disconnect")) t.muted else t.danger,
                .status => if (cells[j].len > 0) statusColor(t, try p.fmt("{c}xx", .{cells[j][0]})) else t.muted,
                .service => if (m.eq(m.string(v), "failed")) t.danger else if (m.eq(m.string(v), "active")) t.success else t.muted,
                .usage => if (m.num(m.get(d, "size")) > 0 and m.num(m.get(d, "used")) / m.num(m.get(d, "size")) > 0.9) t.danger else t.warning,
            };
        }
        rows[i] = .{ .cells = cells, .cell_colors = colors };
    }
    try p.table(.{ .rows = rows, .columns = cols, .selected = pane.selected, .offset = pane.offset, .follow_selection = true, .zebra = zebra, .header = header, .scrollbar = scrollbar }, try p.fmt("pane:{d}", .{c.s.screen * 8 + index}));
}
pub fn log(c: *C, p: *P, index: usize) !void {
    const data = m.arr(m.at(c.s.data(), "logs"));
    const pane = &c.s.panes[c.s.screen * 8 + index];
    pane.log = true;
    pane.total = data.len;
    const entries = try p.ctx.allocator.alloc(h.widgets.LogEntry, data.len);
    for (data, 0..) |v, i| entries[i] = .{ .time = m.string(m.get(v, "time")), .level = m.string(m.get(v, "level")), .message = m.string(m.get(v, "message")), .meta = try p.fmt("{{{s}}}", .{m.string(m.get(v, "meta"))}) };
    try p.log(.{ .entries = entries, .from_end = pane.offset, .scrollbar = true }, try p.fmt("pane:{d}", .{c.s.screen * 8 + index}));
}
