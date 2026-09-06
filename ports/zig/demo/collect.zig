//! Read-only native I/O. Utilities have fixed argv, a deadline and output caps.
const std = @import("std");
const builtin = @import("builtin");
const m = @import("model.zig");
const sensors = @import("sensors.zig");
const traffic = @import("traffic.zig");
const Value = m.Value;
fn read(a: std.mem.Allocator, io: std.Io, path: []const u8) []const u8 {
    return @import("native_io.zig").read(a, io, path);
}
fn number(v: []const u8) f64 {
    return std.fmt.parseFloat(f64, v) catch 0;
}
fn fields(a: std.mem.Allocator, line: []const u8) ![][]const u8 {
    var out: std.ArrayList([]const u8) = .empty;
    var parts = std.mem.tokenizeAny(u8, line, " \t\r");
    while (parts.next()) |part| try out.append(a, part);
    return out.toOwnedSlice(a);
}
fn object(a: std.mem.Allocator, keys: []const []const u8, values: []const Value) !Value {
    return .{ .object = try std.json.ObjectMap.init(a, keys, values) };
}
fn string(value: []const u8) Value {
    return .{ .string = value };
}
fn f(value: f64) Value {
    return .{ .float = value };
}
pub fn rate(current: f64, previous: f64, dt: f64) f64 {
    return if (dt > 0) @max(0, current - previous) / dt else 0;
}
pub fn command(a: std.mem.Allocator, io: std.Io, args: []const []const u8) ?[]const u8 {
    const result = std.process.run(a, io, .{ .argv = args, .expand_arg0 = .expand, .stdout_limit = .limited(1024 * 1024), .stderr_limit = .limited(16384), .timeout = .{ .deadline = std.Io.Clock.Timestamp.now(io, .awake).addDuration(.{ .raw = .fromMilliseconds(700), .clock = .awake }) } }) catch return null;
    return if (result.term == .exited and result.term.exited == 0) result.stdout else null;
}
fn add(_: std.mem.Allocator, s: *Value, key: []const u8, value: Value) !void {
    try m.ptr(s, key).array.append(value);
}
fn history(_: std.mem.Allocator, s: *Value, path: []const u8, ring: *[240]f64, count: usize, value: f64) !void {
    if (count >= 240) {
        std.mem.copyForwards(f64, ring[0..239], ring[1..240]);
        ring[239] = value;
    } else {
        ring[count] = value;
    }
    const target = m.ptr(s, path);
    for (ring[0..@min(count + 1, 240)]) |v| try target.array.append(f(v));
}
pub fn refresh(state: *m.State, io: std.Io) !void {
    const fresh = try std.json.parseFromSlice(Value, state.gpa, @embedFile("sample.json"), .{});
    state.parsed.deinit();
    state.parsed = fresh;
    const s = &state.parsed.value;
    const a = state.allocator();
    m.blank(s);
    m.ptr(s, "telemetry.http").* = .null;
    m.ptr(s, "telemetry.power").* = .null;
    state.missing = "login/SSH/HTTP logs, GPU/power, direction/protocol attribution; process CPU = ps average";
    if (builtin.os.tag != .linux) {
        state.missing = "live metrics require Linux on this port";
        return;
    }
    const now = @as(f64, @floatFromInt(std.Io.Timestamp.now(io, .awake).nanoseconds)) / 1e9;
    const dt = if (state.last_time > 0) now - state.last_time else 0;
    state.last_time = now;
    m.set(s, "time", now);
    m.ptr(s, "system.os").* = string("Linux");
    m.ptr(s, "system.kernel").* = string(std.mem.trim(u8, read(a, io, "/proc/sys/kernel/osrelease"), "\n"));
    m.ptr(s, "system.hostname").* = string(std.mem.trim(u8, read(a, io, "/proc/sys/kernel/hostname"), "\n"));
    var lines = std.mem.splitScalar(u8, read(a, io, "/proc/stat"), '\n');
    var cpu_index: usize = 0;
    while (lines.next()) |line| {
        const parts = try fields(a, line);
        if (parts.len < 2) continue;
        const key = parts[0];
        if (std.mem.startsWith(u8, key, "cpu") and parts.len >= 5) {
            if (cpu_index >= state.cpu_previous.len) continue;
            var total: f64 = 0;
            for (parts[1..@min(9, parts.len)]) |v| total += number(v);
            const idle = number(parts[4]) + (if (parts.len > 5) number(parts[5]) else 0);
            const previous = state.cpu_previous[cpu_index];
            const usage = if (dt > 0 and total > previous[0]) std.math.clamp(1 - (idle - previous[1]) / (total - previous[0]), 0, 1) else 0;
            state.cpu_previous[cpu_index] = .{ total, idle };
            cpu_index += 1;
            if (m.eq(key, "cpu")) {
                m.set(s, "cpu.total", usage);
            } else {
                try add(a, s, "cpu.cores", f(usage));
            }
        } else {
            if (m.eq(key, "ctxt")) {
                m.set(s, "telemetry.kernel.contextSwitches", number(parts[1]));
                m.set(s, "system.contextSwitches", number(parts[1]));
            } else if (m.eq(key, "intr")) {
                m.set(s, "telemetry.kernel.interrupts", number(parts[1]));
            } else if (m.eq(key, "processes")) {
                m.set(s, "telemetry.kernel.forks", number(parts[1]));
            } else if (m.eq(key, "procs_running")) {
                m.set(s, "telemetry.kernel.procsRunning", number(parts[1]));
            } else if (m.eq(key, "procs_blocked")) {
                m.set(s, "telemetry.kernel.procsBlocked", number(parts[1]));
            }
        }
    }
    try history(a, s, "cpu.history", &state.cpu_history, state.history_count, m.num(m.at(s.*, "cpu.total")) * 100);
    lines = std.mem.splitScalar(u8, read(a, io, "/proc/cpuinfo"), '\n');
    while (lines.next()) |line| {
        const cut = std.mem.indexOfScalar(u8, line, ':') orelse continue;
        const key = std.mem.trim(u8, line[0..cut], " \t");
        const value = std.mem.trim(u8, line[cut + 1 ..], " \t");
        if (m.eq(key, "model name")) m.ptr(s, "cpu.model").* = string(value);
        if (m.eq(key, "cpu MHz")) m.set(s, "cpu.frequencyGhz", number(value) / 1000);
    }
    const load = try fields(a, read(a, io, "/proc/loadavg"));
    for (load[0..@min(3, load.len)]) |v| try add(a, s, "cpu.load", f(number(v)));
    lines = std.mem.splitScalar(u8, read(a, io, "/proc/meminfo"), '\n');
    var swap_free: f64 = 0;
    while (lines.next()) |line| {
        const parts = try fields(a, line);
        if (parts.len < 2) continue;
        const value = number(parts[1]) * 1024;
        if (m.eq(parts[0], "SwapFree:")) swap_free = value;
        inline for (.{ "MemTotal:", "MemAvailable:", "MemFree:", "Cached:", "Buffers:", "SwapTotal:" }, .{ "total", "available", "free", "cached", "buffers", "swapTotal" }) |source, dest| {
            if (m.eq(parts[0], source)) m.set(s, "memory." ++ dest, value);
        }
    }
    const used = @max(0, m.num(m.at(s.*, "memory.total")) - m.num(m.at(s.*, "memory.available")));
    m.set(s, "memory.used", used);
    m.set(s, "memory.swapUsed", @max(0, m.num(m.at(s.*, "memory.swapTotal")) - swap_free));
    try history(a, s, "memory.history", &state.mem_history, state.history_count, used / @max(1, m.num(m.at(s.*, "memory.total"))) * 100);
    const uptime = try fields(a, read(a, io, "/proc/uptime"));
    if (uptime.len > 0) m.set(s, "system.uptime", number(uptime[0]));
    var rx: f64 = 0;
    var tx: f64 = 0;
    lines = std.mem.splitScalar(u8, read(a, io, "/proc/net/dev"), '\n');
    while (lines.next()) |line| {
        const cut = std.mem.indexOfScalar(u8, line, ':') orelse continue;
        const name = std.mem.trim(u8, line[0..cut], " \t");
        const parts = try fields(a, line[cut + 1 ..]);
        if (parts.len < 16) continue;
        const base = try std.fmt.allocPrint(a, "/sys/class/net/{s}", .{name});
        const item = try object(a, &.{ "name", "state", "ip", "mac", "mtu", "rxTotal", "txTotal", "rxRate", "txRate", "errors", "drops", "rxHistory", "txHistory" }, &.{ string(name), string(std.mem.trim(u8, read(a, io, try std.fmt.allocPrint(a, "{s}/operstate", .{base})), "\n")), string(""), string(std.mem.trim(u8, read(a, io, try std.fmt.allocPrint(a, "{s}/address", .{base})), "\n")), f(number(std.mem.trim(u8, read(a, io, try std.fmt.allocPrint(a, "{s}/mtu", .{base})), "\n"))), f(number(parts[0])), f(number(parts[8])), f(0), f(0), f(number(parts[2]) + number(parts[10])), f(number(parts[3]) + number(parts[11])), .{ .array = std.json.Array.init(a) }, .{ .array = std.json.Array.init(a) } });
        try add(a, s, "telemetry.interfaces", item);
        if (!m.eq(name, "lo")) {
            rx += number(parts[0]);
            tx += number(parts[8]);
        }
    }
    const down = rate(rx, state.net_previous[0], dt);
    const up = rate(tx, state.net_previous[1], dt);
    state.net_previous = .{ rx, tx };
    m.set(s, "network.downRate", down);
    m.set(s, "network.upRate", up);
    m.set(s, "network.downTotal", rx);
    m.set(s, "network.upTotal", tx);
    m.set(s, "network.downPeak", down);
    m.set(s, "network.upPeak", up);
    try history(a, s, "network.downHistory", &state.rx_history, state.history_count, down);
    try history(a, s, "network.upHistory", &state.tx_history, state.history_count, up);
    try packetCounters(state, read(a, io, "/proc/net/snmp"), dt);
    var missing: std.ArrayList([]const u8) = .empty;
    const ps = command(a, io, &.{ "ps", "-axo", "pid=,pcpu=,pmem=,rss=,nlwp=,stat=,user=,comm=" }) orelse blk: {
        try missing.append(a, "processes");
        break :blk "";
    };
    lines = std.mem.splitScalar(u8, ps, '\n');
    var threads: f64 = 0;
    while (lines.next()) |line| {
        const parts = try fields(a, line);
        if (parts.len < 8) continue;
        const pid = std.fmt.parseInt(i64, parts[0], 10) catch continue;
        threads += number(parts[4]);
        try add(a, s, "processes", try object(a, &.{ "pid", "cpu", "mem", "rss", "threads", "state", "user", "name", "command" }, &.{ .{ .integer = pid }, f(number(parts[1])), f(number(parts[2])), f(number(parts[3]) * 1024), f(number(parts[4])), string(parts[5]), string(parts[6]), string(parts[7]), string(try std.mem.join(a, " ", parts[7..])) }));
        if (m.arr(m.at(s.*, "processes")).len >= 10000) break;
    }
    m.set(s, "system.processCount", @floatFromInt(m.arr(m.at(s.*, "processes")).len));
    m.set(s, "system.threadCount", threads);
    const processes = m.arr(m.at(s.*, "processes"));
    m.set(s, "telemetry.states.total", @floatFromInt(processes.len));
    for (processes) |process| {
        const value = m.string(m.get(process, "state"));
        if (value.len == 0) continue;
        const key = switch (value[0]) {
            'R' => "running",
            'S', 'D' => "sleeping",
            'T', 't' => "stopped",
            'Z' => "zombie",
            else => continue,
        };
        const target = m.ptr(s, "telemetry.states").object.getPtr(key).?;
        target.* = f(m.num(target.*) + 1);
    }
    const who = command(a, io, &.{ "who", "-u" }) orelse blk: {
        try missing.append(a, "sessions");
        break :blk "";
    };
    m.ptr(s, "telemetry.sessions").* = try traffic.sessions(a, who);
    const services = command(a, io, &.{ "systemctl", "list-units", "--type=service", "--all", "--no-legend", "--no-pager", "--plain" }) orelse blk: {
        try missing.append(a, "services");
        break :blk "";
    };
    lines = std.mem.splitScalar(u8, services, '\n');
    while (lines.next()) |line| {
        const parts = try fields(a, line);
        if (parts.len < 5) continue;
        try add(a, s, "telemetry.services", try object(a, &.{ "name", "active", "sub", "description" }, &.{ string(parts[0]), string(parts[2]), string(parts[3]), string(try std.mem.join(a, " ", parts[4..])) }));
        if (m.arr(m.at(s.*, "telemetry.services")).len >= 1000) break;
    }
    const sockets = command(a, io, &.{ "ss", "-H", "-tuna", "-p" }) orelse blk: {
        try missing.append(a, "sockets");
        break :blk "";
    };
    lines = std.mem.splitScalar(u8, sockets, '\n');
    while (lines.next()) |line| {
        const parts = try fields(a, line);
        if (parts.len < 6) continue;
        const process = try std.mem.join(a, " ", parts[6..]);
        try add(a, s, "telemetry.connections", try object(a, &.{ "proto", "state", "local", "remote", "process" }, &.{ string(parts[0]), string(parts[1]), string(parts[4]), string(parts[5]), string(process) }));
        if (m.eq(parts[1], "LISTEN")) {
            const cut = std.mem.lastIndexOfScalar(u8, parts[4], ':') orelse continue;
            try add(a, s, "telemetry.listeners", try object(a, &.{ "proto", "address", "port", "process" }, &.{ string(parts[0]), string(parts[4][0..cut]), string(parts[4][cut + 1 ..]), string(process) }));
        }
        if (m.arr(m.at(s.*, "telemetry.connections")).len >= 5000) break;
    }
    const journal = command(a, io, &.{ "journalctl", "-n", "100", "--no-pager", "-o", "json" }) orelse blk: {
        try missing.append(a, "journal");
        break :blk "";
    };
    lines = std.mem.splitScalar(u8, journal, '\n');
    while (lines.next()) |line| {
        const row = std.json.parseFromSliceLeaky(Value, a, line, .{}) catch continue;
        const entry = try object(a, &.{ "time", "level", "unit", "message", "meta" }, &.{ m.get(row, "__REALTIME_TIMESTAMP"), m.get(row, "PRIORITY"), m.get(row, "_SYSTEMD_UNIT"), m.get(row, "MESSAGE"), string("") });
        try add(a, s, "telemetry.journal", entry);
        try add(a, s, "logs", entry);
    }
    const df = command(a, io, &.{ "df", "-PT", "-B1" }) orelse blk: {
        try missing.append(a, "filesystems");
        break :blk "";
    };
    lines = std.mem.splitScalar(u8, df, '\n');
    _ = lines.next();
    while (lines.next()) |line| {
        const parts = try fields(a, line);
        if (parts.len != 7) continue;
        try add(a, s, "telemetry.filesystems", try object(a, &.{ "device", "type", "size", "used", "mount" }, &.{ string(parts[0]), string(parts[1]), f(number(parts[2])), f(number(parts[3])), string(parts[6]) }));
        if (m.arr(m.at(s.*, "telemetry.filesystems")).len >= 128) break;
    }
    const gpus = try sensors.parseGPUs(a, command(a, io, &.{ "nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw", "--format=csv,noheader,nounits" }) orelse "");
    m.ptr(s, "telemetry.gpus").* = gpus;
    const source: sensors.Source = .{ .a = a, .io = io, .root = "/" };
    var readings = try sensors.collect(source, read(a, io, "/proc/cpuinfo"), gpus, null);
    if (m.arr(readings.temperatures).len == 0) {
        if (command(a, io, &.{ "sensors", "-j" })) |raw| readings.temperatures = .{ .array = try sensors.parseTemperatures(a, raw) };
    }
    m.ptr(s, "temperatures").* = readings.temperatures;
    m.ptr(s, "sensors").* = readings.sensors;
    m.ptr(s, "telemetry.power").* = readings.power;
    if (m.arr(readings.temperatures).len == 0) try missing.append(a, "temperatures");
    if (readings.hardware_count == 0) try missing.append(a, "fans/voltage/power");
    if (m.arr(gpus).len == 0) try missing.append(a, "GPU telemetry");
    const split = try traffic.breakdown(a, m.at(s.*, "telemetry.connections"), m.at(s.*, "telemetry.listeners"));
    inline for (.{ "protocols", "remotes", "inboundConnections", "outboundConnections" }) |key| m.ptr(s, "telemetry." ++ key).* = m.get(split, key);
    const login_raw = command(a, io, &.{ "last", "-n", "20", "-w" }) orelse blk: {
        try missing.append(a, "login history");
        break :blk "";
    };
    const failed_raw = command(a, io, &.{ "lastb", "-n", "15", "-w" }) orelse blk: {
        try missing.append(a, "failed login history");
        break :blk "";
    };
    m.ptr(s, "telemetry.logins").* = try traffic.logins(a, login_raw, "ok");
    m.ptr(s, "telemetry.failedLogins").* = try traffic.logins(a, failed_raw, "failed");
    var auth = command(a, io, &.{ "journalctl", "-u", "ssh", "-u", "sshd", "-n", "80", "--no-pager", "--output=short-iso" });
    if (m.arr(try traffic.ssh(a, auth orelse "")).len == 0) {
        if (traffic.tail(a, io, "/var/log/auth.log")) |fallback| auth = fallback.raw;
    }
    m.ptr(s, "telemetry.ssh").* = try traffic.ssh(a, auth orelse "");
    if (auth == null) try missing.append(a, "SSH authentication log");
    m.ptr(s, "telemetry.http").* = try state.http.sample(a, io, "/", now);
    if (m.at(s.*, "telemetry.http") == .null) try missing.append(a, "HTTP access log");
    try history(a, s, "telemetry.sessionHistory", &state.session_history, state.history_count, @floatFromInt(m.arr(m.at(s.*, "telemetry.sessions")).len));
    try history(a, s, "telemetry.connectionHistory", &state.connection_history, state.history_count, @floatFromInt(m.arr(m.at(s.*, "telemetry.connections")).len));
    state.history_count = @min(240, state.history_count + 1);
    try missing.append(a, "disk I/O; process CPU = ps average");
    state.missing = try std.mem.join(a, ", ", missing.items);
}

pub fn packetCounters(state: *m.State, raw: []const u8, dt: f64) !void {
    const a = state.allocator();
    const s = &state.parsed.value;
    const sources = [_][]const u8{ "TcpActiveOpens", "TcpPassiveOpens", "TcpCurrEstab", "TcpInSegs", "TcpOutSegs", "TcpRetransSegs", "TcpInErrs", "TcpOutRsts", "UdpInDatagrams", "UdpOutDatagrams", "UdpInErrors", "IcmpInMsgs", "IcmpOutMsgs" };
    const targets = [_][]const u8{ "tcpActiveOpens", "tcpPassiveOpens", "tcpEstablished", "tcpInSegs", "tcpOutSegs", "tcpRetransSegs", "tcpInErrs", "tcpOutRsts", "udpInDatagrams", "udpOutDatagrams", "udpInErrors", "icmpInMsgs", "icmpOutMsgs" };
    var current: [13]f64 = [_]f64{0} ** 13;
    var lines = std.mem.splitScalar(u8, raw, '\n');
    while (lines.next()) |line| {
        const h = try fields(a, line);
        const v = try fields(a, lines.next() orelse break);
        if (h.len == 0 or v.len == 0 or !m.eq(h[0], v[0])) continue;
        const prefix = std.mem.trimEnd(u8, h[0], ":");
        for (1..@min(h.len, v.len)) |j| {
            const key = try std.mem.concat(a, u8, &.{ prefix, h[j] });
            for (sources, 0..) |source, i| {
                if (m.eq(key, source)) current[i] = number(v[j]);
            }
        }
    }
    for (targets, 0..) |target, i| {
        try m.ptr(s, "telemetry.net").object.put(a, target, f(current[i]));
    }
    for ([_][]const u8{ "inSegs", "outSegs", "retrans", "activeOpens", "passiveOpens", "udpIn", "udpOut" }, [_]usize{ 3, 4, 5, 0, 1, 8, 9 }) |key, i| {
        try m.ptr(s, "telemetry.net.rates").object.put(a, key, f(rate(current[i], state.snmp_previous[i], dt)));
    }
    state.snmp_previous = current;
    m.set(s, "telemetry.net.retransRatio", current[5] / @max(1, current[4]));
    try history(a, s, "telemetry.netInHistory", &state.packet_history[0], state.history_count, m.num(m.at(s.*, "telemetry.net.rates.inSegs")));
    try history(a, s, "telemetry.netOutHistory", &state.packet_history[1], state.history_count, m.num(m.at(s.*, "telemetry.net.rates.outSegs")));
    try history(a, s, "telemetry.retransHistory", &state.packet_history[2], state.history_count, m.num(m.at(s.*, "telemetry.net.retransRatio")) * 100);
}
