const std = @import("std");
const h = @import("hqtui");
const m = @import("model.zig");
const view = @import("view.zig");
const cli = @import("main.zig");
const collect = @import("collect.zig");

test "all ten screens, all themes, small and large terminals" {
    var state = try m.State.init(std.testing.allocator, false, 1337);
    defer state.deinit();
    for (m.screens, 0..) |name, i| {
        state.screen = i;
        for (m.themes, 0..) |theme, j| {
            state.theme = j;
            var screen = try h.renderToScreen(std.testing.allocator, 120, 40, theme, h.Body.with(&state, view.render));
            defer screen.deinit();
            try std.testing.expect(screen.contains("hqtui"));
            try std.testing.expect(screen.contains(name));
        }
        for ([_][2]usize{ .{ 1, 1 }, .{ 20, 5 }, .{ 40, 12 }, .{ 80, 24 }, .{ 160, 55 } }) |size| {
            var screen = try h.renderToScreen(std.testing.allocator, size[0], size[1], "dark", h.Body.with(&state, view.render));
            defer screen.deinit();
            try std.testing.expectEqual(size[0], screen.width);
            try std.testing.expectEqual(size[1], screen.height);
        }
    }
}
test "seeded native histories are deterministic and bounded" {
    var a = try m.State.init(std.testing.allocator, false, 42);
    defer a.deinit();
    var b = try m.State.init(std.testing.allocator, false, 42);
    defer b.deinit();
    var c = try m.State.init(std.testing.allocator, false, 43);
    defer c.deinit();
    try std.testing.expectEqual(m.num(m.at(a.data(), "cpu.total")), m.num(m.at(b.data(), "cpu.total")));
    try std.testing.expect(m.num(m.at(a.data(), "cpu.total")) != m.num(m.at(c.data(), "cpu.total")));
    for (0..500) |_| try a.simulate();
    try std.testing.expect(m.arr(m.at(a.data(), "cpu.history")).len <= 240);
}
test "overlays own keys and text input cannot quit" {
    var s = try m.State.init(std.testing.allocator, false, 42);
    defer s.deinit();
    _ = try s.key("f3", "");
    try std.testing.expect(!(try s.key("q", "q")));
    try std.testing.expectEqualStrings("q", s.filter.slice());
    _ = try s.key("escape", "");
    _ = try s.key("ctrl+k", "");
    _ = try s.key("t", "themes");
    _ = try s.key("enter", "");
    try std.testing.expectEqual(@as(usize, 7), s.screen);
    s.screen = 8;
    _ = try s.key("e", "e");
    _ = try s.key("q", "q");
    _ = try s.key("1", "1");
    try std.testing.expectEqualStrings("q1", s.input.slice());
    try std.testing.expectEqual(@as(usize, 8), s.screen);
    _ = try s.key("escape", "");
    try std.testing.expect(try s.key("q", "q"));
}
test "independent scroll panes" {
    var s = try m.State.init(std.testing.allocator, false, 42);
    defer s.deinit();
    var frame = try h.renderToScreen(std.testing.allocator, 160, 55, "dark", h.Body.with(&s, view.render));
    defer frame.deinit();
    s.panes[1].move(20);
    try std.testing.expectEqual(@as(usize, 0), s.panes[7].selected);
    try std.testing.expect(s.panes[1].selected > 0);
}
test "CLI rejects invalid options before terminal acquisition" {
    for ([_][]const []const u8{ &.{ "--fps", "0" }, &.{ "--interval", "nan" }, &.{ "--width", "99999" }, &.{ "--seed", "-1" }, &.{ "--ticks", "-1" }, &.{ "--theme", "wrong" }, &.{ "--sim", "--real" } }) |args| {
        if (cli.options(args)) |_| {
            return error.AcceptedInvalidOption;
        } else |_| {}
    }
}
test "real state has no simulation rows and counters reset safely" {
    var s = try m.State.init(std.testing.allocator, true, 42);
    defer s.deinit();
    try std.testing.expectEqual(@as(usize, 0), m.arr(m.at(s.data(), "processes")).len);
    try std.testing.expectEqual(@as(usize, 0), m.arr(m.at(s.data(), "telemetry.sessions")).len);
    try std.testing.expectEqual(@as(f64, 25), collect.rate(100, 50, 2));
    try std.testing.expectEqual(@as(f64, 0), collect.rate(10, 50, 1));
    try std.testing.expectEqual(@as(f64, 0), collect.rate(100, 0, 0));
}
