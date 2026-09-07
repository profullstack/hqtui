const std = @import("std");
const h = @import("hqtui");
const m = @import("model.zig");
const ref = @import("reference.zig");
const State = m.State;
const Value = m.Value;
const Container = h.Container;
fn val(s: *State, path: []const u8) Value {
    return m.at(s.data(), path);
}
pub fn sortedProcesses(s: *State, a: std.mem.Allocator) ![]Value {
    var list: std.ArrayList(Value) = .empty;
    for (m.arr(val(s, "processes"))) |row| {
        if (m.contains(m.string(m.get(row, "name")), s.filter.slice()) or m.contains(m.string(m.get(row, "command")), s.filter.slice())) try list.append(a, row);
    }
    const Sort = struct {
        fn less(order: usize, left: Value, right: Value) bool {
            const key = ([_][]const u8{ "cpu", "mem", "pid", "name" })[order];
            if (order == 3) return std.mem.order(u8, m.string(m.get(left, key)), m.string(m.get(right, key))) == .lt;
            return if (order == 2) m.num(m.get(left, key)) < m.num(m.get(right, key)) else m.num(m.get(left, key)) > m.num(m.get(right, key));
        }
    };
    std.mem.sort(Value, list.items, s.sort, Sort.less);
    return list.toOwnedSlice(a);
}

pub fn body(s: *State, p: *Container) anyerror!void {
    switch (s.screen) {
        0 => try @import("dashboard.zig").render(s, p),
        1...4 => try @import("telemetry_view.zig").render(s, p),
        else => try @import("showcase.zig").render(s, p),
    }
}
fn header(s: *State, p: *Container) anyerror!void {
    const t = p.theme().*;
    try ref.sizedText(p, " hqtui.com", .{ .fg = t.title, .bold = true }, 12);
    const tabs = try p.ctx.allocator.alloc([]const u8, 10);
    for (tabs, 0..) |*tab, i| tab.* = try p.fmt("{d} {s}", .{ (i + 1) % 10, m.screens[i] });
    try p.tabs(.{ .tabs = tabs, .active = s.screen }, "tabs0");
    try p.text(try p.fmt("{s}  {s}  {d:.0}fps  {s} ", .{ if (s.paused) "paused" else "live", if (s.real) "real" else "simulated", s.fps, s.clock }), .{ .fg = if (s.paused) t.warning else t.success, .alignment = .right });
}
pub fn render(s: *State, p: *Container) anyerror!void {
    try p.row(.{ .layout = .{ .size = .{ .cells = 1 } } }, h.Body.with(s, header));
    try p.spacer(.{ .cells = 1 });
    try p.column(.{ .layout = .{ .size = .{ .cells = @intCast(p.height() -| 4) } } }, h.Body.with(s, body));
    try p.spacer(.{ .cells = 1 });
    const items = try p.ctx.allocator.dupe(h.widgets.StatusItem, &.{ .{ .key = "F1", .label = "Help" }, .{ .key = "F2", .label = try p.fmt("Theme ({s})", .{p.theme().name}) }, .{ .key = "F3", .label = if (s.filtering) try p.fmt("Filter: {s}_", .{s.filter.slice()}) else "Filter", .active = s.filtering }, .{ .key = "F6", .label = try p.fmt("Sort: {s}", .{([_][]const u8{ "cpu", "mem", "pid", "name" })[s.sort]}) }, .{ .key = "^K", .label = "Palette" }, .{ .key = "Tab", .label = "Screen" }, .{ .key = "q", .label = "Quit" } });
    const right = try p.ctx.allocator.dupe(h.widgets.StatusItem, &.{.{ .label = try p.fmt("{d:.2}ms  {d} cells  {d}B", .{ s.render_ms, s.changed_cells, s.output_bytes }) }});
    try p.statusBar(.{ .items = items, .right = right });
    if (s.help) p.modal(.{ .title = "hqtui — Help", .message = "1–9/0 / Tab: screen\nF2 theme · F3 filter · F6 sort\nCtrl+K palette · Space pause\nArrows / PgUp / PgDn / Home / End: scroll\nMouse tabs, controls, selection and wheel\ne edits text · Esc finishes\nq / Ctrl+C quit · Any key closes help" });
    if (s.modal) p.modal(.{ .title = "Read-only Demo", .message = "No process will be killed and no service changed.\nPress any key to close." });
    if (s.palette) {
        const matches = try s.commands(p.ctx.allocator);
        const options = try p.ctx.allocator.alloc(h.widgets.PaletteItem, matches.len);
        for (matches, 0..) |name, i| options[i] = .{ .label = name };
        p.commandPalette(.{ .query = s.query.slice(), .items = options, .selected = s.palette_index });
    }
}
