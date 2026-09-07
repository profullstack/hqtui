//! Direct native translation of the TS dashboard's responsive layouts.
const r = @import("reference.zig");
const h = r.h;
const m = r.m;
const C = r.C;
const P = r.P;
const std = r.std;
pub fn render(s: *m.State, p: *P) !void {
    const c = try r.root(s, p);
    try draw(c, p);
}
fn draw(c: *C, p: *P) anyerror!void {
    if (p.width() >= 150) {
        try c.row(p, .{ .cells = if (p.height() >= 44) 19 else 16 }, 1, wideTop);
        try c.row(p, .{ .fr = 1 }, 1, wideMiddle);
        try c.row(p, .{ .cells = 12 }, 1, wideBottom);
    } else if (p.width() >= 100) {
        try c.row(p, .{ .cells = 14 }, 1, mediumTop);
        try c.row(p, .{ .fr = 1 }, 1, mediumMiddle);
        try c.row(p, .{ .cells = 10 }, 1, mediumBottom);
    } else {
        try c.row(p, .{ .cells = 10 }, 1, compactTop);
        try c.col(p, .fill, 0, processes);
        try c.row(p, .{ .cells = 8 }, 1, network);
    }
}
fn wideTop(c: *C, p: *P) !void {
    try c.col(p, .{ .fr = 1 }, 0, cpu);
    try c.col(p, .{ .fr = 0.95 }, 0, memory);
    try c.col(p, .{ .fr = 0.95 }, 0, disks);
    try c.col(p, .{ .fr = 1.35 }, 0, system);
}
fn wideMiddle(c: *C, p: *P) !void {
    try c.col(p, .{ .fr = 2 }, 0, processes);
    try c.col(p, .{ .fr = 1.2 }, 0, network);
    try c.col(p, .{ .fr = 1.2 }, 0, diskUsage);
}
fn wideBottom(c: *C, p: *P) !void {
    try temperatures(c, p);
    try sensors(c, p);
    try c.col(p, .{ .fr = 1.6 }, 0, logs);
}
fn mediumTop(c: *C, p: *P) !void {
    try cpu(c, p);
    try memory(c, p);
    try system(c, p);
}
fn mediumMiddle(c: *C, p: *P) !void {
    try c.col(p, .{ .fr = 1.6 }, 0, processes);
    try c.col(p, .fill, 0, network);
}
fn mediumBottom(c: *C, p: *P) !void {
    try temperatures(c, p);
    try logs(c, p);
}
fn compactTop(c: *C, p: *P) !void {
    const compact = try c.sub(p, c.v, 1);
    try cpu(compact, p);
    try memory(c, p);
}
fn cpu(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "CPU Overview", .subtitle = try r.pct(p, c.n("cpu.total")) }, cpuBody);
}
fn cpuBody(c: *C, p: *P) !void {
    const t = p.theme().*;
    try p.label(try p.fmt("{s}   {d:.1} GHz", .{ c.str("cpu.model"), c.n("cpu.frequencyGhz") }));
    try r.plot(p, c.at("cpu.history"), t.success, 100, false);
    const data = m.arr(c.at("cpu.cores"));
    const items = try p.ctx.allocator.alloc(h.widgets.MeterItem, data.len);
    for (data, 0..) |v, i| items[i] = .{ .label = try p.fmt("P{d}", .{i}), .value = m.num(v) };
    try p.meters(.{ .items = items, .columns = if (c.index == 1) 1 else 2, .label_width = 4, .value_width = 5, .style = .segmented });
    try p.divider(.{});
    const load = m.arr(c.at("cpu.load"));
    try r.keys(p, &.{r.kv("Load Avg", try p.fmt("{d:.2}   {d:.2}   {d:.2}", .{ if (load.len > 0) m.num(load[0]) else 0, if (load.len > 1) m.num(load[1]) else 0, if (load.len > 2) m.num(load[2]) else 0 }), t.warning)}, true);
}
fn memory(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Memory & Swap" }, memoryBody);
}
fn memoryBody(c: *C, p: *P) !void {
    const t = p.theme().*;
    const used = c.n("memory.used") / @max(1, c.n("memory.total"));
    const swap = c.n("memory.swapUsed") / @max(1, c.n("memory.swapTotal"));
    try r.tx(p, try p.fmt("Memory      {s} / {s} ({s})", .{ try r.bytes(p, c.n("memory.used"), 2), try r.bytes(p, c.n("memory.total"), 2), try r.pct(p, used) }), t.foreground);
    try r.meter(p, used, null);
    try p.spacer(.{ .cells = 1 });
    try r.keys(p, &.{ r.kv("Used:", try r.bytes(p, c.n("memory.used"), 2), t.warning), r.kv("Available:", try r.bytes(p, c.n("memory.available"), 2), t.success), r.kv("Cached:", try r.bytes(p, c.n("memory.cached"), 2), t.accent), r.kv("Buffers:", try r.bytes(p, c.n("memory.buffers"), 2), t.secondary), r.kv("Free:", try r.bytes(p, c.n("memory.free"), 2), t.muted) }, true);
    try p.spacer(.fill);
    try p.divider(.{});
    try r.tx(p, try p.fmt("Swap        {s} / {s} ({s})", .{ try r.bytes(p, c.n("memory.swapUsed"), 2), try r.bytes(p, c.n("memory.swapTotal"), 2), try r.pct(p, swap) }), t.foreground);
    try r.meter(p, swap, t.secondary);
    try r.keys(p, &.{ r.kv("Used:", try r.bytes(p, c.n("memory.swapUsed"), 2), t.secondary), r.kv("Free:", try r.bytes(p, c.n("memory.swapTotal") - c.n("memory.swapUsed"), 2), t.muted) }, true);
}
fn disks(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Disks" }, disksBody);
}
fn diskRates(c: *C, p: *P) !void {
    const t = p.theme().*;
    try r.tx(p, try p.fmt("Read: {s}", .{try r.byteRate(p, c.n("readRate"))}), t.success);
    try p.text(try p.fmt("Write: {s}", .{try r.byteRate(p, c.n("writeRate"))}), .{ .fg = t.secondary, .alignment = .right });
}
fn disksBody(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = m.arr(c.at("disks"));
    if (data.len == 0) {
        try p.label("No disks reported");
        return;
    }
    for (data[0..@min(2, data.len)], 0..) |v, i| {
        const d = try c.sub(p, v, 0);
        const used = d.n("used") / @max(1, d.n("total"));
        try r.tx(p, try p.fmt("{s} — {s} ({s})", .{ d.str("device"), try r.bytes(p, d.n("total"), 2), d.str("type") }), t.foreground);
        try r.tx(p, try p.fmt("Used: {s} ({s})", .{ try r.bytes(p, d.n("used"), 2), try r.pct(p, used) }), t.muted);
        try r.meter(p, used, null);
        try r.tx(p, try p.fmt("Free: {s}", .{try r.bytes(p, d.n("total") - d.n("used"), 2)}), t.muted);
        try d.row(p, .{ .cells = 1 }, 0, diskRates);
        try r.multi(p, d.at("readHistory"), d.at("writeHistory"), t.success, t.secondary);
        if (i == 0 and data.len > 1) try p.divider(.{});
    }
}
fn system(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "System" }, systemBody);
}
fn processCount(c: *C) f64 {
    return if (c.n("system.processCount") != 0) c.n("system.processCount") else @floatFromInt(m.arr(c.at("processes")).len);
}
fn systemSummary(c: *C, p: *P) !void {
    const t = p.theme().*;
    try r.keys(p, &.{ r.kv("OS:", c.str("system.os"), null), r.kv("Kernel:", c.str("system.kernel"), null), r.kv("Uptime:", try r.duration(p, c.n("system.uptime")), null), r.kv("Hostname:", c.str("system.hostname"), null), r.kv("Shell:", c.str("system.shell"), null), r.kv("Source:", if (c.s.real) "linux/proc" else "simulated", t.accent) }, false);
    const load = m.arr(c.at("cpu.load"));
    try r.keys(p, &.{ r.kv("CPU:", try r.pct(p, c.n("cpu.total")), h.theme.heatColor(t, c.n("cpu.total"))), r.kv("Memory:", try p.fmt("{s} ({s})", .{ try r.pct(p, c.n("memory.used") / @max(1, c.n("memory.total"))), try r.bytes(p, c.n("memory.used"), 2) }), t.warning), r.kv("Swap:", if (c.n("memory.swapTotal") > 0) try r.pct(p, c.n("memory.swapUsed") / c.n("memory.swapTotal")) else "—", t.secondary), r.kv("Load:", try p.fmt("{d:.2} {d:.2} {d:.2}", .{ if (load.len > 0) m.num(load[0]) else 0, if (load.len > 1) m.num(load[1]) else 0, if (load.len > 2) m.num(load[2]) else 0 }), null), r.kv("Processes:", try p.fmt("{d:.0}", .{processCount(c)}), null), r.kv("Threads:", try r.scalar(p, c.at("system.threadCount")), null) }, false);
}
fn cpuHistory(c: *C, p: *P) !void {
    try r.plot(p, c.at("cpu.history"), p.theme().success, 100, true);
}
fn quickStats(c: *C, p: *P) !void {
    const t = p.theme().*;
    try r.keys(p, &.{ r.kv("Uptime", try r.duration(p, c.n("system.uptime")), t.accent), r.kv("Procs", try p.fmt("{d:.0}", .{processCount(c)}), t.accent), r.kv("Threads", if (c.n("system.threadCount") > 0) try r.scalar(p, c.at("system.threadCount")) else "—", t.accent), r.kv("Ctx/s", try p.fmt("{d:.1}K", .{c.n("telemetry.kernel.contextSwitchRate") / 1000}), t.accent) }, true);
}
fn memoryGraph(c: *C, p: *P) !void {
    try r.tx(p, try r.pct(p, c.n("memory.used") / @max(1, c.n("memory.total"))), p.theme().warning);
    try r.plot(p, c.at("memory.history"), p.theme().primary, 100, false);
}
fn tempGauge(c: *C, p: *P) !void {
    const temps = m.arr(c.at("temperatures"));
    var v = c.n("cpu.total");
    var label = try r.pct(p, v);
    if (temps.len > 0) {
        const temp = temps[0];
        const maximum = m.num(m.get(temp, "max"));
        v = @min(1, m.num(m.get(temp, "value")) / (if (maximum == 0) @as(f64, 100) else maximum));
        label = try p.fmt("{d:.0}°C", .{@floor(m.num(m.get(temp, "value")) + 0.5)});
    }
    try p.gauge(.{ .value = v, .label = label });
}
fn systemStats(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Quick Stats" }, quickStats);
    try c.panel(p, .{ .title = "Memory" }, memoryGraph);
    try c.panel(p, .{ .title = "Temp", .layout = .{ .size = .{ .cells = 14 } } }, tempGauge);
}
fn systemBody(c: *C, p: *P) !void {
    const t = p.theme().*;
    try p.row(.{ .layout = .{ .size = .{ .cells = 6 }, .min = 6, .gap = 2 } }, h.Body.with(c, systemSummary));
    try c.panel(p, .{ .title = "CPU History", .layout = .{ .min = 5 } }, cpuHistory);
    if (p.width() >= 46 and p.height() >= 16) {
        try c.row(p, .{ .cells = 6 }, 1, systemStats);
    } else {
        try p.divider(.{});
        try r.keys(p, &.{ r.kv("Threads", try r.scalar(p, c.at("system.threadCount")), t.accent), r.kv("Ctx switches", try p.fmt("{d:.1}K", .{c.n("system.contextSwitches") / 1000}), t.accent) }, true);
    }
}
fn processes(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = try p.fmt("Processes (sorted by {s})", .{([_][]const u8{ "CPU", "MEM", "PID", "NAME" })[c.s.sort]}), .subtitle = if (c.s.filter.len > 0) try p.fmt("filter: {s}", .{c.s.filter.slice()}) else "", .focus_id = "dashboard.processes" }, processesBody);
}
fn processesBody(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = try @import("view.zig").sortedProcesses(c.s, p.ctx.allocator);
    var cols = [_]r.DC{ r.dc("pid", "PID", 7, 0, null, true), r.dc("name", "Name", 0, 8, t.primary, false), r.dc("cpu", "CPU%", 6, 0, null, true), r.dc("mem", "MEM%", 6, 0, t.warning, true), r.dc("rss", "RSS", 9, 0, null, true), r.dc("threads", "Threads", 7, 0, null, true), r.dc("state", "S", 2, 0, null, false), r.dc("user", "User", 10, 0, t.muted, false), r.dc("command", "Command", 0, 10, t.muted, false) };
    cols[2].format = .one;
    cols[2].tint = .cpu;
    cols[3].format = .one;
    cols[4].format = .bytes0;
    cols[6].tint = .state;
    try r.table(c, p, 1, data, &cols, false, true, true);
}
fn network(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Network" }, networkBody);
}
fn networkRates(c: *C, p: *P) !void {
    const t = p.theme().*;
    try r.tx(p, try p.fmt("Download: {s}", .{try r.bitRate(p, c.n("network.downRate"))}), t.primary);
    try p.text(try p.fmt("Upload: {s}", .{try r.bitRate(p, c.n("network.upRate"))}), .{ .fg = t.secondary, .alignment = .right });
}
fn axisBits(buf: []u8, v: f64) []const u8 {
    const b = @max(0, v) * 8;
    for ([_]f64{ 1e9, 1e6, 1e3 }, [_][]const u8{ "Gb/s", "Mb/s", "Kb/s" }) |scale, unit| {
        if (b >= scale) return std.fmt.bufPrint(buf, "{d:.1}{s}", .{ b / scale, unit }) catch "";
    }
    return std.fmt.bufPrint(buf, "{d:.0}b/s", .{b}) catch "";
}
fn networkTotals(c: *C, p: *P) !void {
    const t = p.theme().*;
    inline for (.{ "down", "up" }, 0..) |prefix, i| {
        const color = if (i == 0) t.primary else t.secondary;
        try r.keys(p, &.{ r.kv("Total:", try r.bytes(p, c.n("network." ++ prefix ++ "Total"), 2), color), r.kv("Current:", try r.bitRate(p, c.n("network." ++ prefix ++ "Rate")), color), r.kv("Peak:", try r.bitRate(p, c.n("network." ++ prefix ++ "Peak")), color) }, false);
    }
}
fn networkBody(c: *C, p: *P) !void {
    const t = p.theme().*;
    try c.row(p, .{ .cells = 1 }, 0, networkRates);
    inline for (.{ "downHistory", "upHistory" }, 0..) |key, i| try p.graph(.{ .values = try m.numbers(p.ctx.allocator, c.at("network." ++ key)), .axis = true, .axis_format = axisBits, .plot = .{ .min = 0, .fill = true, .color = if (i == 0) t.primary else t.secondary } });
    try p.divider(.{});
    try c.row(p, .{ .cells = 3 }, 2, networkTotals);
}
fn diskUsage(c: *C, p: *P) !void {
    const disks_ = m.arr(c.at("disks"));
    try c.panel(p, .{ .title = "Disk Usage", .subtitle = if (disks_.len > 0) m.string(m.get(disks_[0], "device")) else "" }, diskUsageBody);
}
fn ioGraph(c: *C, p: *P) !void {
    const read = c.index == 0;
    const color = if (read) p.theme().success else p.theme().secondary;
    try r.tx(p, try p.fmt("{s}: {s}", .{ if (read) "Read" else "Write", try r.byteRate(p, c.n(if (read) "readRate" else "writeRate")) }), color);
    try r.plot(p, c.at(if (read) "readHistory" else "writeHistory"), color, null, false);
}
fn ioColumns(c: *C, p: *P) !void {
    const read = try c.sub(p, c.v, 0);
    const write = try c.sub(p, c.v, 1);
    try read.col(p, .fill, 0, ioGraph);
    try write.col(p, .fill, 0, ioGraph);
}
fn ioBody(c: *C, p: *P) !void {
    try c.row(p, .fill, 2, ioColumns);
}
fn diskUsageBody(c: *C, p: *P) !void {
    const data = m.arr(c.at("disks"));
    for (data) |v| {
        const used = m.num(m.get(v, "used")) / @max(1, m.num(m.get(v, "total")));
        try p.meter(.{ .value = used, .text = try p.fmt("{s} {s} / {s}", .{ try r.pct(p, used), try r.bytes(p, m.num(m.get(v, "used")), 0), try r.bytes(p, m.num(m.get(v, "total")), 0) }), .style = .segmented });
        try p.label(try p.fmt("{s} ({s})", .{ m.string(m.get(v, "mount")), m.string(m.get(v, "device")) }));
    }
    try p.spacer(.{ .cells = 1 });
    const first = try c.sub(p, if (data.len > 0) data[0] else .null, 0);
    try first.panel(p, .{ .title = "I/O Summary" }, ioBody);
}
fn temperatures(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Temperatures" }, temperaturesBody);
}
fn tempRow(c: *C, p: *P) !void {
    const t = p.theme().*;
    const maximum = c.n("max");
    const v = @min(1, c.n("value") / (if (maximum == 0) @as(f64, 100) else maximum));
    try r.sizedText(p, c.str("label"), .{ .fg = t.muted }, 16);
    try p.heatBar(.{ .value = v });
    try r.sizedText(p, try p.fmt("{d:.0}°C", .{@floor(c.n("value") + 0.5)}), .{ .fg = h.theme.heatColor(t, v), .alignment = .right }, 6);
}
fn temperaturesBody(c: *C, p: *P) !void {
    const data = m.arr(c.at("temperatures"));
    if (data.len == 0) {
        try p.label("No thermal sensors on this host.");
        try p.spacer(.{ .cells = 1 });
        try p.label("Run with --sim to see this panel populated.");
        return;
    }
    for (data[0..@min(10, data.len)]) |v| {
        const d = try c.sub(p, v, 0);
        try d.row(p, .{ .cells = 1 }, 0, tempRow);
    }
}
fn sensors(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Sensors" }, sensorsBody);
}
fn sensorsBody(c: *C, p: *P) !void {
    const data = m.arr(c.at("sensors"));
    if (data.len == 0) {
        try p.label("No hardware sensors on this host.");
        try p.spacer(.{ .cells = 1 });
        try p.label("Probed: /sys/class/hwmon, thermal zones, lm-sensors,");
        try p.label("power supplies and nvidia-smi.");
        return;
    }
    const rows = try p.ctx.allocator.alloc(h.widgets.KeyValueRow, data.len);
    for (data, 0..) |v, i| rows[i] = r.kv(m.string(m.get(v, "label")), m.string(m.get(v, "value")), p.theme().accent);
    try r.keys(p, rows, true);
}
fn logs(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Logs" }, logsBody);
}
fn logsBody(c: *C, p: *P) !void {
    try r.log(c, p, 7);
}
