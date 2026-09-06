//! Native Linux sensor collection; all allocation belongs to the sample arena.
const std = @import("std");
const m = @import("model.zig");
const Value = m.Value;
const Allocator = std.mem.Allocator;
fn text(v: []const u8) Value {
    return .{ .string = v };
}
fn numeric(v: f64) Value {
    return .{ .float = v };
}
fn object(a: Allocator, keys: []const []const u8, values: []const Value) !Value {
    return .{ .object = try std.json.ObjectMap.init(a, keys, values) };
}
fn finite(raw: []const u8) ?f64 {
    const value = std.fmt.parseFloat(f64, std.mem.trim(u8, raw, " \t\r\n")) catch return null;
    return if (std.math.isFinite(value)) value else null;
}
fn positive(raw: []const u8) ?f64 {
    const v = finite(raw) orelse return null;
    return if (v > 0) v else null;
}
fn input(name: []const u8, prefix: []const u8, suffix: []const u8) bool {
    if (!std.mem.startsWith(u8, name, prefix) or !std.mem.endsWith(u8, name, suffix) or name.len <= prefix.len + suffix.len) return false;
    for (name[prefix.len .. name.len - suffix.len]) |c| {
        if (!std.ascii.isDigit(c)) return false;
    }
    return true;
}
pub const Source = struct {
    a: Allocator,
    io: std.Io,
    root: []const u8,
    fn join(self: Source, left: []const u8, right: []const u8) ![]const u8 {
        return std.fs.path.join(self.a, &.{ left, right });
    }
    pub fn read(self: Source, path: []const u8) []const u8 {
        const full = self.join(self.root, path) catch return "";
        const raw = @import("native_io.zig").read(self.a, self.io, full);
        return std.mem.trim(u8, raw, " \t\r\n");
    }
    fn entries(self: Source, path: []const u8) ![][]const u8 {
        const full = try self.join(self.root, path);
        var dir = std.Io.Dir.cwd().openDir(self.io, full, .{ .iterate = true }) catch return &.{};
        defer dir.close(self.io);
        var iter = dir.iterate();
        var names: std.ArrayList([]const u8) = .empty;
        while (names.items.len < 4096) {
            const entry = (iter.next(self.io) catch break) orelse break;
            try names.append(self.a, try self.a.dupe(u8, entry.name));
        }
        std.mem.sort([]const u8, names.items, {}, struct {
            fn less(_: void, a: []const u8, b: []const u8) bool {
                return std.mem.lessThan(u8, a, b);
            }
        }.less);
        return names.items;
    }
    fn label(self: Source, dir: []const u8, stem: []const u8, chip: []const u8) ![]const u8 {
        const named = self.read(try self.join(dir, try std.fmt.allocPrint(self.a, "{s}_label", .{stem})));
        if (named.len > 0) return named;
        if (std.mem.startsWith(u8, stem, "fan")) return std.fmt.allocPrint(self.a, "{s} Fan {s}", .{ chip, stem[3..] });
        return std.fmt.allocPrint(self.a, "{s} {s}", .{ chip, stem });
    }
};
pub const Readings = struct { temperatures: Value, sensors: Value, power: Value, hardware_count: usize };
fn row(a: Allocator, label: []const u8, value: []const u8) !Value {
    return object(a, &.{ "label", "value" }, &.{ text(label), text(value) });
}
pub fn collect(src: Source, cpuinfo: []const u8, gpus: Value, lm_raw: ?[]const u8) !Readings {
    const a = src.a;
    var temps = std.json.Array.init(a);
    var rows = std.json.Array.init(a);
    const chips = try src.entries("sys/class/hwmon");
    for (chips[0..@min(128, chips.len)]) |name| {
        const base = try src.join("sys/class/hwmon", name);
        var chip = src.read(try src.join(base, "name"));
        if (chip.len == 0) chip = src.read(try src.join(base, "device/name"));
        if (chip.len == 0) chip = name;
        for ([_][]const u8{ base, try src.join(base, "device") }) |dir| {
            for (try src.entries(dir)) |file| {
                const is_temp = input(file, "temp", "_input");
                const fan = input(file, "fan", "_input");
                const volts = input(file, "in", "_input");
                const watts = input(file, "power", "_input") or input(file, "power", "_average");
                const amps = input(file, "curr", "_input");
                if (!is_temp and !fan and !volts and !watts and !amps) continue;
                const value = positive(src.read(try src.join(dir, file))) orelse continue;
                const stem = file[0..std.mem.lastIndexOfScalar(u8, file, '_').?];
                const label = try src.label(dir, stem, chip);
                if (is_temp) {
                    if (value > 150000 or temps.items.len >= 12) continue;
                    const maximum = positive(src.read(try src.join(dir, try std.fmt.allocPrint(a, "{s}_crit", .{stem})))) orelse 100000;
                    try temps.append(try object(a, &.{ "label", "value", "max" }, &.{ text(label), numeric(value / 1000), numeric(maximum / 1000) }));
                } else if (rows.items.len < 14) {
                    const formatted = if (fan) try std.fmt.allocPrint(a, "{d:.0} RPM", .{@floor(value + 0.5)}) else if (volts) try std.fmt.allocPrint(a, "{d:.2} V", .{value / 1000}) else if (watts) try std.fmt.allocPrint(a, "{d:.1} W", .{value / 1e6}) else try std.fmt.allocPrint(a, "{d:.2} A", .{value / 1000});
                    try rows.append(try row(a, label, formatted));
                }
            }
        }
    }
    if (temps.items.len == 0) {
        const zones = try src.entries("sys/class/thermal");
        for (zones[0..@min(128, zones.len)]) |zone| {
            if (!std.mem.startsWith(u8, zone, "thermal_zone")) continue;
            const dir = try src.join("sys/class/thermal", zone);
            const value = positive(src.read(try src.join(dir, "temp"))) orelse continue;
            if (value > 150000) continue;
            const label = src.read(try src.join(dir, "type"));
            try temps.append(try object(a, &.{ "label", "value", "max" }, &.{ text(if (label.len > 0) label else zone), numeric(value / 1000), numeric(100) }));
            if (temps.items.len == 12) break;
        }
    }
    if (temps.items.len == 0) {
        if (lm_raw) |raw| {
            temps = try parseTemperatures(a, raw);
        }
    }
    const hardware_count = rows.items.len;
    const power = try battery(src);
    if (power == .object) {
        try rows.append(try row(a, "Battery", try std.fmt.allocPrint(a, "{d}% ({s})", .{ m.num(m.get(power, "battery")), m.string(m.get(power, "timeRemaining")) })));
        const watts = m.num(m.get(power, "powerDraw"));
        if (watts > 0) try rows.append(try row(a, "Battery draw", try std.fmt.allocPrint(a, "{d:.1} W", .{watts})));
    }
    const gpu_rows = m.arr(gpus);
    for (gpu_rows[0..@min(16, gpu_rows.len)]) |gpu| {
        const usage = m.get(gpu, "utilization");
        const temperature = m.get(gpu, "temperature");
        const u = if (usage == .null) "unavailable" else try std.fmt.allocPrint(a, "{d:.0}%", .{@floor(m.num(usage) * 100 + 0.5)});
        const t = if (temperature == .null) "temperature unavailable" else try std.fmt.allocPrint(a, "{d}°C", .{m.num(temperature)});
        try rows.append(try row(a, m.string(m.get(gpu, "name")), try std.fmt.allocPrint(a, "{s} · {s}", .{ u, t })));
    }
    var cpus: std.ArrayList(u32) = .empty;
    for (try src.entries("sys/devices/system/cpu")) |name| {
        if (!std.mem.startsWith(u8, name, "cpu")) continue;
        try cpus.append(a, std.fmt.parseInt(u32, name[3..], 10) catch continue);
    }
    std.mem.sort(u32, cpus.items, {}, std.sort.asc(u32));
    var clocks = std.json.Array.init(a);
    for (cpus.items[0..@min(4, cpus.items.len)]) |cpu| {
        const value = positive(src.read(try std.fmt.allocPrint(a, "sys/devices/system/cpu/cpu{d}/cpufreq/scaling_cur_freq", .{cpu}))) orelse continue;
        try clocks.append(try row(a, try std.fmt.allocPrint(a, "cpu{d} clock", .{cpu}), try std.fmt.allocPrint(a, "{d:.2} GHz", .{value / 1e6})));
    }
    if (clocks.items.len == 0) {
        var lines = std.mem.splitScalar(u8, cpuinfo, '\n');
        while (lines.next()) |line| {
            const cut = std.mem.indexOfScalar(u8, line, ':') orelse continue;
            if (!m.eq(std.mem.trim(u8, line[0..cut], " \t"), "cpu MHz")) continue;
            const mhz = positive(line[cut + 1 ..]) orelse continue;
            try clocks.append(try row(a, try std.fmt.allocPrint(a, "cpu{d} clock", .{clocks.items.len}), try std.fmt.allocPrint(a, "{d:.2} GHz", .{mhz / 1000})));
            if (clocks.items.len == 4) break;
        }
    }
    try rows.appendSlice(clocks.items);
    rows.shrinkRetainingCapacity(@min(14, rows.items.len));
    return .{ .temperatures = .{ .array = temps }, .sensors = .{ .array = rows }, .power = power, .hardware_count = hardware_count };
}
pub fn parseTemperatures(a: Allocator, raw: []const u8) !std.json.Array {
    var out = std.json.Array.init(a);
    const chips = std.json.parseFromSliceLeaky(Value, a, raw, .{ .allocate = .alloc_always }) catch return out;
    if (chips != .object) return out;
    var chip_iter = chips.object.iterator();
    while (chip_iter.next()) |chip| {
        if (chip.value_ptr.* != .object) continue;
        var features = chip.value_ptr.object.iterator();
        while (features.next()) |feature| {
            if (feature.value_ptr.* != .object) continue;
            var values = feature.value_ptr.object.iterator();
            while (values.next()) |value| {
                const v = m.num(value.value_ptr.*);
                if (!input(value.key_ptr.*, "temp", "_input") or v <= 0 or v > 150) continue;
                const name = chip.key_ptr.*;
                const cut = std.mem.indexOfScalar(u8, name, '-') orelse name.len;
                try out.append(try object(a, &.{ "label", "value", "max" }, &.{ text(try std.fmt.allocPrint(a, "{s} {s}", .{ name[0..cut], feature.key_ptr.* })), numeric(v), numeric(100) }));
                if (out.items.len == 12) return out;
                break;
            }
        }
    }
    return out;
}
pub fn parseGPUs(a: Allocator, raw: []const u8) !Value {
    var out = std.json.Array.init(a);
    var lines = std.mem.splitScalar(u8, raw, '\n');
    while (lines.next()) |line| {
        var fields = std.mem.splitScalar(u8, line, ',');
        var parts: [6][]const u8 = undefined;
        var count: usize = 0;
        while (fields.next()) |part| {
            if (count == 6) {
                count += 1;
                break;
            }
            parts[count] = std.mem.trim(u8, part, " \r\t");
            count += 1;
        }
        if (count != 6 or parts[0].len == 0) continue;
        var values: [6]Value = .{ text(parts[0]), .null, .null, .null, .null, .null };
        for (parts[1..], [_]f64{ 0.01, 1048576, 1048576, 1, 1 }, 1..) |part, scale, i| {
            if (finite(part)) |v| {
                if (v >= 0) values[i] = numeric(v * scale);
            }
        }
        try out.append(try object(a, &.{ "name", "utilization", "memoryUsed", "memoryTotal", "temperature", "power" }, &values));
        if (out.items.len == 16) break;
    }
    return .{ .array = out };
}
fn battery(src: Source) !Value {
    const names = try src.entries("sys/class/power_supply");
    var ac = false;
    for (names[0..@min(128, names.len)]) |name| {
        const dir = try src.join("sys/class/power_supply", name);
        if (m.eq(src.read(try src.join(dir, "type")), "Mains") and m.eq(src.read(try src.join(dir, "online")), "1")) ac = true;
    }
    for (names[0..@min(128, names.len)]) |name| {
        const dir = try src.join("sys/class/power_supply", name);
        if (!m.eq(src.read(try src.join(dir, "type")), "Battery")) continue;
        const capacity = finite(src.read(try src.join(dir, "capacity"))) orelse continue;
        if (capacity < 0 or capacity > 100) continue;
        const status = src.read(try src.join(dir, "status"));
        var watts: Value = .null;
        if (finite(src.read(try src.join(dir, "power_now")))) |v| {
            watts = numeric(v / 1e6);
        } else {
            if (finite(src.read(try src.join(dir, "current_now")))) |amps| {
                if (finite(src.read(try src.join(dir, "voltage_now")))) |volts| {
                    watts = numeric(amps * volts / 1e12);
                }
            }
        }
        return object(src.a, &.{ "battery", "charging", "timeRemaining", "powerDraw", "acConnected" }, &.{ numeric(capacity), .{ .bool = m.eq(status, "Charging") }, text(status), watts, .{ .bool = ac } });
    }
    return .null;
}
