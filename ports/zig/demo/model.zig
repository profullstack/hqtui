const std = @import("std");
pub const Value = std.json.Value;
pub const screens = [_][]const u8{ "dashboard", "traffic", "sessions", "network", "services", "components", "graphics", "themes", "input", "stress" };
pub const themes = [_][]const u8{ "dark", "dracula", "nord", "tokyo-night", "gruvbox", "matrix", "monochrome", "high-contrast", "light" };
pub fn eq(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}
pub fn get(v: Value, key: []const u8) Value {
    return if (v == .object) v.object.get(key) orelse .null else .null;
}
pub fn at(v: Value, keys: []const u8) Value {
    var result = v;
    var parts = std.mem.splitScalar(u8, keys, '.');
    while (parts.next()) |key| {
        result = get(result, key);
    }
    return result;
}
pub fn ptr(v: *Value, keys: []const u8) *Value {
    var result = v;
    var parts = std.mem.splitScalar(u8, keys, '.');
    while (parts.next()) |key| {
        result = result.object.getPtr(key).?;
    }
    return result;
}
pub fn arr(v: Value) []const Value {
    return if (v == .array) v.array.items else &.{};
}
pub fn num(v: Value) f64 {
    return switch (v) {
        .float => v.float,
        .integer => @floatFromInt(v.integer),
        else => 0,
    };
}
pub fn string(v: Value) []const u8 {
    return if (v == .string) v.string else "";
}
pub fn display(a: std.mem.Allocator, v: Value) ![]const u8 {
    return switch (v) {
        .string => v.string,
        .integer => try std.fmt.allocPrint(a, "{d}", .{v.integer}),
        .float => try std.fmt.allocPrint(a, "{d:.1}", .{v.float}),
        .bool => if (v.bool) "true" else "false",
        else => "—",
    };
}
pub fn numbers(a: std.mem.Allocator, v: Value) ![]f64 {
    const out = try a.alloc(f64, arr(v).len);
    for (arr(v), 0..) |value, i| out[i] = num(value);
    return out;
}
pub fn set(v: *Value, key: []const u8, value: f64) void {
    ptr(v, key).* = .{ .float = value };
}
pub fn push(a: std.mem.Allocator, v: *Value, value: f64) !void {
    if (v.* != .array) v.* = .{ .array = std.json.Array.init(a) };
    if (v.array.items.len >= 240) _ = v.array.orderedRemove(0);
    try v.array.append(.{ .float = value });
}
pub fn blank(v: *Value) void {
    switch (v.*) {
        .object => {
            for (v.object.values()) |*item| blank(item);
        },
        .array => v.array.clearRetainingCapacity(),
        .integer => v.* = .{ .integer = 0 },
        .float => v.* = .{ .float = 0 },
        .string => v.* = .{ .string = "" },
        .bool => v.* = .{ .bool = false },
        else => {},
    }
}
pub const Text = struct {
    buffer: [4096]u8 = undefined,
    len: usize = 0,
    pub fn slice(self: *const Text) []const u8 {
        return self.buffer[0..self.len];
    }
    pub fn append(self: *Text, value: []const u8) void {
        for (value) |ch| {
            if (ch < 32 or ch == 127) continue;
            if (self.len == self.buffer.len) break;
            self.buffer[self.len] = ch;
            self.len += 1;
        }
    }
    pub fn clear(self: *Text) void {
        self.len = 0;
    }
    pub fn backspace(self: *Text) void {
        if (self.len == 0) return;
        self.len -= 1;
        while (self.len > 0 and self.buffer[self.len] & 0xc0 == 0x80) self.len -= 1;
    }
};
pub const Pane = struct {
    selected: usize = 0,
    offset: usize = 0,
    total: usize = 0,
    log: bool = false,
    pub fn move(self: *Pane, d: i64) void {
        if (self.log) {
            self.offset = @intCast(std.math.clamp(@as(i64, @intCast(self.offset)) - d, 0, @as(i64, @intCast(self.total -| 1))));
            return;
        }
        self.selected = @intCast(std.math.clamp(@as(i64, @intCast(self.selected)) + d, 0, @as(i64, @intCast(self.total -| 1))));
    }
};
pub const State = struct {
    http: @import("traffic.zig").HttpCollector = .{},
    parsed: std.json.Parsed(Value),
    gpa: std.mem.Allocator,
    real: bool,
    seed: u32,
    tick: u64 = 0,
    screen: usize = 0,
    theme: usize = 0,
    sort: usize = 0,
    paused: bool = false,
    help: bool = false,
    modal: bool = false,
    palette: bool = false,
    filtering: bool = false,
    editing: bool = false,
    checked: bool = true,
    toggle: bool = true,
    select_open: bool = false,
    select_index: usize = 0,
    palette_index: usize = 0,
    filter: Text = .{},
    input: Text = .{},
    query: Text = .{},
    last_key: Text = .{},
    last_mouse: Text = .{},
    key_log: [100][64]u8 = undefined,
    key_lens: [100]usize = [_]usize{0} ** 100,
    key_count: usize = 0,
    fps: f64 = 0,
    render_ms: f64 = 0,
    changed_cells: usize = 0,
    output_bytes: usize = 0,
    slider: f64 = 0.7,
    clock: [8]u8 = "12:00:00".*,
    panes: [80]Pane = [_]Pane{.{}} ** 80,
    focused: [10]usize = .{ 1, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
    missing: []const u8 = "",
    cpu_previous: [257][2]f64 = [_][2]f64{.{ 0, 0 }} ** 257,
    net_previous: [2]f64 = .{ 0, 0 },
    last_time: f64 = 0,
    cpu_history: [240]f64 = [_]f64{0} ** 240,
    mem_history: [240]f64 = [_]f64{0} ** 240,
    rx_history: [240]f64 = [_]f64{0} ** 240,
    tx_history: [240]f64 = [_]f64{0} ** 240,
    history_count: usize = 0,
    snmp_previous: [13]f64 = [_]f64{0} ** 13,
    packet_history: [3][240]f64 = [_][240]f64{[_]f64{0} ** 240} ** 3,
    session_history: [240]f64 = [_]f64{0} ** 240,
    connection_history: [240]f64 = [_]f64{0} ** 240,
    pub fn init(gpa: std.mem.Allocator, real: bool, seed: u32) !State {
        var result = State{ .parsed = try std.json.parseFromSlice(Value, gpa, @embedFile("sample.json"), .{}), .gpa = gpa, .real = real, .seed = seed };
        if (real) {
            blank(&result.parsed.value);
            ptr(&result.parsed.value, "telemetry.http").* = .null;
            ptr(&result.parsed.value, "telemetry.power").* = .null;
        } else {
            for (0..120) |_| try result.simulate();
        }
        return result;
    }
    pub fn deinit(self: *State) void {
        self.parsed.deinit();
    }
    pub fn data(self: *const State) Value {
        return self.parsed.value;
    }
    pub fn allocator(self: *State) std.mem.Allocator {
        return self.parsed.arena.allocator();
    }
    pub fn overlay(self: *const State) bool {
        return self.help or self.modal or self.palette or self.filtering;
    }
    pub fn simulate(self: *State) !void {
        self.tick += 1;
        const t = @as(f64, @floatFromInt(self.tick)) * 0.1;
        const phase = @as(f64, @floatFromInt(self.seed % 10000)) / 100;
        const a = self.allocator();
        const s = &self.parsed.value;
        set(s, "time", t);
        var total: f64 = 0;
        const cores = ptr(s, "cpu.cores");
        cores.array.clearRetainingCapacity();
        for (0..12) |i| {
            const value = std.math.clamp(0.4 + 0.22 * @sin(t / 3 + phase + @as(f64, @floatFromInt(i)) * 0.7), 0.02, 0.98);
            try cores.array.append(.{ .float = value });
            total += value;
        }
        total /= 12;
        set(s, "cpu.total", total);
        set(s, "cpu.frequencyGhz", 2.1 + num(cores.array.items[0]));
        const load = ptr(s, "cpu.load");
        for (load.array.items, 0..) |*v, i| {
            v.* = .{ .float = total * ([_]f64{ 4, 3.5, 3 })[i] };
        }
        try push(a, ptr(s, "cpu.history"), total * 100);
        const used = num(at(s.*, "memory.total")) * (0.42 + 0.05 * @sin(t / 13 + phase));
        const available = num(at(s.*, "memory.total")) - used;
        set(s, "memory.used", used);
        set(s, "memory.available", available);
        set(s, "memory.free", @max(0, available - num(at(s.*, "memory.cached")) - num(at(s.*, "memory.buffers"))));
        try push(a, ptr(s, "memory.history"), used / num(at(s.*, "memory.total")) * 100);
        const down = (2 + @sin(t / 2 + phase)) * 1048576;
        const up = down * 0.35;
        inline for (.{ "down", "up" }, .{ @as(f64, 1), @as(f64, 0.35) }) |dir, factor| {
            const value = down * factor;
            set(s, "network." ++ dir ++ "Rate", value);
            set(s, "network." ++ dir ++ "Total", num(at(s.*, "network." ++ dir ++ "Total")) + value * 0.1);
            set(s, "network." ++ dir ++ "Peak", @max(num(at(s.*, "network." ++ dir ++ "Peak")), value));
            try push(a, ptr(s, "network." ++ dir ++ "History"), value);
        }
        for (ptr(s, "processes").array.items, 0..) |*p, i| set(p, "cpu", @max(0, 8 + 8 * @sin(t / 3 + phase + @as(f64, @floatFromInt(i)))));
        for (ptr(s, "disks").array.items, 0..) |*d, i| {
            inline for (.{ "read", "write" }, .{ @as(f64, 1), @as(f64, 0.4) }) |dir, factor| {
                const value = (1 + @sin(t / 4 + @as(f64, @floatFromInt(i)) + phase)) * 1048576 * factor;
                set(d, dir ++ "Rate", value);
                try push(a, ptr(d, dir ++ "History"), value);
            }
        }
        set(s, "system.uptime", 9254 + t);
        for (ptr(s, "telemetry.interfaces").array.items, 0..) |*v, i| {
            const divisor: @TypeOf(down) = @floatFromInt(i + 1);
            set(v, "rxRate", down / divisor);
            set(v, "txRate", up / divisor);
            try push(a, ptr(v, "rxHistory"), down / divisor);
            try push(a, ptr(v, "txHistory"), up / divisor);
        }
        try push(a, ptr(s, "telemetry.netInHistory"), down / 1400);
        try push(a, ptr(s, "telemetry.netOutHistory"), up / 1400);
        try push(a, ptr(s, "telemetry.retransHistory"), 0.1 + 0.1 * @sin(t));
        try push(a, ptr(s, "telemetry.connectionHistory"), @floatFromInt(arr(at(s.*, "telemetry.connections")).len));
        try push(a, ptr(s, "telemetry.sessionHistory"), @floatFromInt(arr(at(s.*, "telemetry.sessions")).len));
    }
    pub fn commands(self: *const State, a: std.mem.Allocator) ![][]const u8 {
        var out: std.ArrayList([]const u8) = .empty;
        for (screens) |name| {
            if (contains(name, self.query.slice())) try out.append(a, name);
        }
        for ([_][]const u8{ "pause", "sort CPU", "sort memory" }) |name| {
            if (contains(name, self.query.slice())) try out.append(a, name);
        }
        return out.toOwnedSlice(a);
    }
    pub fn key(self: *State, k: []const u8, ch: []const u8) !bool {
        self.last_key.clear();
        self.last_key.append(k);
        if (self.key_count == 100) {
            std.mem.copyForwards([64]u8, self.key_log[0..99], self.key_log[1..100]);
            std.mem.copyForwards(usize, self.key_lens[0..99], self.key_lens[1..100]);
            self.key_count = 99;
        }
        const len = @min(k.len, 64);
        @memcpy(self.key_log[self.key_count][0..len], k[0..len]);
        self.key_lens[self.key_count] = len;
        self.key_count += 1;
        if (eq(k, "ctrl+c")) return true;
        if (self.palette) {
            var arena = std.heap.ArenaAllocator.init(self.gpa);
            defer arena.deinit();
            const matches = try self.commands(arena.allocator());
            if (eq(k, "escape")) {
                self.palette = false;
            } else if (eq(k, "up")) {
                self.palette_index -|= 1;
            } else if (eq(k, "down")) {
                self.palette_index = @min(self.palette_index + 1, matches.len -| 1);
            } else if (eq(k, "enter")) {
                if (matches.len > 0) {
                    const action = matches[@min(self.palette_index, matches.len - 1)];
                    if (index(&screens, action)) |i| {
                        self.screen = i;
                    } else if (eq(action, "pause")) {
                        self.paused = !self.paused;
                    } else {
                        self.sort = if (eq(action, "sort memory")) 1 else 0;
                    }
                }
                self.palette = false;
            } else if (eq(k, "backspace")) {
                self.query.backspace();
                self.palette_index = 0;
            } else {
                self.query.append(ch);
                self.palette_index = 0;
            }
            return false;
        }
        if (self.help or self.modal) {
            self.help = false;
            self.modal = false;
            return false;
        }
        if (self.filtering or self.editing) {
            const target = if (self.editing) &self.input else &self.filter;
            if (eq(k, "escape")) {
                if (self.filtering) target.clear();
                self.filtering = false;
                self.editing = false;
            } else if (eq(k, "enter")) {
                self.filtering = false;
            } else if (eq(k, "backspace")) {
                target.backspace();
            } else {
                target.append(ch);
            }
            return false;
        }
        if (self.select_open) {
            if (eq(k, "escape")) {
                self.select_open = false;
            } else if (eq(k, "up")) {
                self.select_index = (self.select_index + 3) % 4;
            } else if (eq(k, "down")) {
                self.select_index = (self.select_index + 1) % 4;
            } else if (eq(k, "enter")) {
                self.theme = self.select_index;
                self.select_open = false;
            }
            return false;
        }
        if (eq(k, "q") or eq(k, "f10")) return true;
        if (eq(k, "f1")) {
            self.help = true;
        } else if (eq(k, "f2")) {
            self.theme = (self.theme + 1) % themes.len;
        } else if (eq(k, "f3")) {
            self.filtering = true;
        } else if (eq(k, "f6")) {
            self.sort = (self.sort + 1) % 4;
        } else if (eq(k, "ctrl+k")) {
            self.palette = true;
            self.query.clear();
            self.palette_index = 0;
        } else if (eq(k, "space")) {
            self.paused = !self.paused;
        } else if (eq(k, "enter")) {
            self.modal = true;
        } else if (eq(k, "e") and (self.screen == 5 or self.screen == 8)) {
            self.editing = true;
        } else if (eq(k, "tab")) {
            self.screen = (self.screen + 1) % 10;
        } else if (eq(k, "left") and self.screen == 7) {
            self.theme = (self.theme + themes.len - 1) % themes.len;
        } else if (eq(k, "right") and self.screen == 7) {
            self.theme = (self.theme + 1) % themes.len;
        } else if (k.len == 1 and std.mem.indexOfScalar(u8, "1234567890", k[0]) != null) {
            self.screen = std.mem.indexOfScalar(u8, "1234567890", k[0]).?;
        } else {
            const delta: i64 = if (eq(k, "up")) -1 else if (eq(k, "down")) 1 else if (eq(k, "pageup")) -10 else if (eq(k, "pagedown")) 10 else if (eq(k, "home")) -1000000 else if (eq(k, "end")) 1000000 else 0;
            self.panes[self.screen * 8 + self.focused[self.screen]].move(delta);
        }
        return false;
    }
};
pub fn index(items: []const []const u8, needle: []const u8) ?usize {
    for (items, 0..) |item, i| if (eq(item, needle)) return i;
    return null;
}
pub fn contains(haystack: []const u8, needle: []const u8) bool {
    if (needle.len > haystack.len) return false;
    for (0..haystack.len - needle.len + 1) |i| {
        if (std.ascii.eqlIgnoreCase(haystack[i..][0..needle.len], needle)) return true;
    }
    return false;
}
