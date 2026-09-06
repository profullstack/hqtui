const std = @import("std");
const h = @import("hqtui");
const m = @import("model.zig");
const view = @import("view.zig");
const cli = @import("main.zig");
const collect = @import("collect.zig");
const sensors = @import("sensors.zig");
const traffic = @import("traffic.zig");
test "Linux procfs readers do not treat zero stat size as empty" {
    if (@import("builtin").os.tag != .linux) return;
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const raw = @import("native_io.zig").read(arena.allocator(), std.testing.io, "/proc/meminfo");
    try std.testing.expect(std.mem.indexOf(u8, raw, "MemTotal:") != null);
}

test "Traffic and Sessions use shared real-source parsers and render rows" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const raw = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, @import("build_options").fixtures ++ "/demo-traffic.json", a, .limited(1024 * 1024));
    const fixture = try std.json.parseFromSliceLeaky(m.Value, a, raw, .{});
    var state = try m.State.init(std.testing.allocator, true, 42);
    defer state.deinit();
    const data = &state.parsed.value;
    const split = try traffic.breakdown(a, m.get(fixture, "connections"), m.get(fixture, "listeners"));
    try std.testing.expectEqual(@as(f64, 1), m.num(m.get(split, "inboundConnections")));
    try std.testing.expectEqual(@as(f64, 2), m.num(m.get(split, "outboundConnections")));
    try std.testing.expectEqual(@as(usize, 3), m.arr(m.get(split, "protocols")).len);
    inline for (.{ "protocols", "remotes", "inboundConnections", "outboundConnections" }) |key| m.ptr(data, "telemetry." ++ key).* = m.get(split, key);
    m.ptr(data, "telemetry.sessions").* = try traffic.sessions(a, m.string(m.get(fixture, "who")));
    m.ptr(data, "telemetry.logins").* = try traffic.logins(a, m.string(m.get(fixture, "last")), "ok");
    m.ptr(data, "telemetry.failedLogins").* = try traffic.logins(a, m.string(m.get(fixture, "lastb")), "failed");
    m.ptr(data, "telemetry.ssh").* = try traffic.ssh(a, m.string(m.get(fixture, "ssh")));
    try std.testing.expectEqualStrings("203.0.113.4", m.string(m.get(m.arr(m.at(data.*, "telemetry.sessions"))[0], "from")));
    const logins = m.arr(m.at(data.*, "telemetry.logins"));
    try std.testing.expectEqual(@as(usize, 1), logins.len);
    try std.testing.expectEqualStrings("still", m.string(m.get(logins[0], "status")));
    const events = m.arr(m.at(data.*, "telemetry.ssh"));
    try std.testing.expectEqual(@as(usize, 3), events.len);
    for (events, [_][]const u8{ "accepted", "invalid", "disconnect" }) |event, action| try std.testing.expectEqualStrings(action, m.string(m.get(event, "action")));
    const http = try traffic.httpStats(a, m.string(m.get(fixture, "http")), "fixture");
    m.ptr(data, "telemetry.http").* = http;
    try std.testing.expectEqual(@as(f64, 3), m.num(m.get(http, "total")));
    try std.testing.expectEqual(@as(f64, 1), m.num(m.get(http, "upgrades")));
    try std.testing.expectEqualStrings("/chat", m.string(m.get(m.arr(m.get(http, "recent"))[0], "path")));
    try std.testing.expectEqualStrings("10:01:02", m.string(m.get(m.arr(m.get(http, "recent"))[0], "time")));
    const serialized = try std.json.Stringify.valueAlloc(a, http, .{});
    try std.testing.expect(std.mem.indexOf(u8, serialized, "secret") == null);
    for ([_]usize{ 1, 2 }) |screen| {
        state.screen = screen;
        var frame = try h.renderToScreen(std.testing.allocator, 240, 80, "dark", h.Body.with(&state, view.render));
        defer frame.deinit();
        for (if (screen == 1) &[_][]const u8{ "HTTPS", "SSH", "accepted", "/chat" } else &[_][]const u8{ "alice", "eve", "Failed Logins", "still" }) |label| try std.testing.expect(frame.contains(label));
    }
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.createDirPath(std.testing.io, "var/log/nginx");
    const root = try tmp.dir.realPathFileAlloc(std.testing.io, ".", a);
    const path = "var/log/nginx/access.log";
    const log = m.string(m.get(fixture, "http"));
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = path, .data = log });
    var collector: traffic.HttpCollector = .{};
    try std.testing.expectEqual(@as(f64, 0), m.num(m.get(try collector.sample(a, std.testing.io, root, 1), "requestsPerSecond")));
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = path, .data = try std.mem.concat(a, u8, &.{ log, log }) });
    try std.testing.expect(m.num(m.get(try collector.sample(a, std.testing.io, root, 2), "requestsPerSecond")) > 0);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = path, .data = log });
    try std.testing.expectEqual(@as(f64, 0), m.num(m.get(try collector.sample(a, std.testing.io, root, 3), "requestsPerSecond")));
    try tmp.dir.deleteFile(std.testing.io, path);
    try std.testing.expect((try collector.sample(a, std.testing.io, root, 4)) == .null);
}

test "packet counters refresh and resets do not spike" {
    var state = try m.State.init(std.testing.allocator, true, 42);
    defer state.deinit();
    try collect.packetCounters(&state, "Tcp: ActiveOpens PassiveOpens CurrEstab InSegs OutSegs RetransSegs\nTcp: 10 20 3 100 200 2\nUdp: InDatagrams OutDatagrams\nUdp: 50 60\n", 0);
    try std.testing.expectEqual(@as(f64, 3), m.num(m.at(state.data(), "telemetry.net.tcpEstablished")));
    try std.testing.expectEqual(@as(f64, 0), m.num(m.at(state.data(), "telemetry.net.rates.inSegs")));
    try collect.packetCounters(&state, "Tcp: ActiveOpens PassiveOpens CurrEstab InSegs OutSegs RetransSegs\nTcp: 11 21 4 150 300 3\n", 2);
    try std.testing.expectEqual(@as(f64, 25), m.num(m.at(state.data(), "telemetry.net.rates.inSegs")));
    try collect.packetCounters(&state, "Tcp: InSegs OutSegs\nTcp: 2 3\n", 1);
    try std.testing.expectEqual(@as(f64, 0), m.num(m.at(state.data(), "telemetry.net.rates.inSegs")));
}

fn writeSensorFiles(dir: std.Io.Dir, files: m.Value) !void {
    if (files != .object) return;
    var iter = files.object.iterator();
    while (iter.next()) |entry| {
        if (std.fs.path.dirname(entry.key_ptr.*)) |parent| try dir.createDirPath(std.testing.io, parent);
        try dir.writeFile(std.testing.io, .{ .sub_path = entry.key_ptr.*, .data = m.string(entry.value_ptr.*) });
    }
}
fn checkSensorValues(readings: m.Value, expected: m.Value) !void {
    if (expected != .object) return;
    var iter = expected.object.iterator();
    while (iter.next()) |entry| {
        var found = false;
        for (m.arr(readings)) |sensor| {
            if (!m.eq(m.string(m.get(sensor, "label")), entry.key_ptr.*)) continue;
            try std.testing.expectEqualStrings(m.string(entry.value_ptr.*), m.string(m.get(sensor, "value")));
            found = true;
        }
        try std.testing.expect(found);
    }
}
test "shared sensor sources refresh and render" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const raw = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, @import("build_options").fixtures ++ "/demo-sensors.json", a, .limited(1024 * 1024));
    const cases = try std.json.parseFromSliceLeaky(m.Value, a, raw, .{});
    for (m.arr(cases)) |case| {
        var tmp = std.testing.tmpDir(.{});
        defer tmp.cleanup();
        const root = try tmp.dir.realPathFileAlloc(std.testing.io, ".", a);
        try writeSensorFiles(tmp.dir, m.get(case, "files"));
        const source: sensors.Source = .{ .a = a, .io = std.testing.io, .root = root };
        const gpus = try sensors.parseGPUs(a, m.string(m.get(case, "gpus")));
        const first = try sensors.collect(source, m.string(m.get(case, "cpuinfo")), gpus, m.string(m.get(case, "lm")));
        const expected = m.arr(m.get(case, "temperatures"));
        try std.testing.expectEqual(expected.len, m.arr(first.temperatures).len);
        for (expected, m.arr(first.temperatures)) |value, temp| try std.testing.expectEqual(m.num(value), m.num(m.get(temp, "value")));
        try checkSensorValues(first.sensors, m.get(case, "sensors"));
        var state = try m.State.init(std.testing.allocator, true, 42);
        defer state.deinit();
        m.ptr(&state.parsed.value, "temperatures").* = first.temperatures;
        m.ptr(&state.parsed.value, "sensors").* = first.sensors;
        var frame = try h.renderToScreen(std.testing.allocator, 220, 70, "dark", h.Body.with(&state, view.render));
        defer frame.deinit();
        for (m.arr(first.sensors)) |sensor| {
            try std.testing.expect(frame.contains(m.string(m.get(sensor, "label"))));
            try std.testing.expect(frame.contains(m.string(m.get(sensor, "value"))));
        }
        try writeSensorFiles(tmp.dir, m.get(case, "changes"));
        const next_cpu = m.get(case, "nextCpuinfo");
        const next = try sensors.collect(source, m.string(if (next_cpu == .null) m.get(case, "cpuinfo") else next_cpu), gpus, m.string(m.get(case, "lm")));
        try checkSensorValues(next.sensors, m.get(case, "nextSensors"));
    }
}

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
