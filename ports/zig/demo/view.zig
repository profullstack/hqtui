const std = @import("std");
const h = @import("hqtui");
const m = @import("model.zig");
const State = m.State;
const Value = m.Value;
const Container = h.Container;
const Col = struct { []const u8, []const u8 };
const Context = struct { state: *State, index: usize };
fn val(s: *State, path: []const u8) Value {
    return m.at(s.data(), path);
}
fn graph(p: *Container, v: Value, label: []const u8, other: ?Value) !void {
    const a = p.ctx.allocator;
    const series = try a.alloc(h.graphics.Series, if (other != null) 2 else 1);
    series[0] = .{ .values = try m.numbers(a, v), .label = label };
    if (other) |v2| series[1] = .{ .values = try m.numbers(a, v2), .label = "out" };
    try p.graph(.{ .series = series, .axis = true, .legend = label.len > 0, .plot = .{ .fill = true } });
}
fn bytes(p: *Container, value: f64) ![]const u8 {
    var v = value;
    for ([_][]const u8{ "B", "KiB", "MiB", "GiB", "TiB" }) |unit| {
        if (@abs(v) < 1024 or m.eq(unit, "TiB")) return p.fmt("{d:.1} {s}", .{ v, unit });
        v /= 1024;
    }
    return "";
}
fn table(ctx: *Context, p: *Container, data: []const Value, columns: []const Col, fixed: usize) !void {
    const a = p.ctx.allocator;
    const pane = &ctx.state.panes[ctx.state.screen * 8 + ctx.index];
    pane.total = data.len;
    pane.move(0);
    pane.offset = h.widgets.resolveOffset(pane.offset, pane.selected, p.height() -| (fixed + 1), data.len, true);
    const rows = try a.alloc(h.widgets.TableRow, data.len);
    const cols = try a.alloc(h.widgets.TableColumn, columns.len);
    for (columns, 0..) |c, i| cols[i] = .{ .title = c[1] };
    for (data, 0..) |row, i| {
        const cells = try a.alloc([]const u8, columns.len);
        for (columns, 0..) |c, j| cells[j] = try m.display(a, m.get(row, c[0]));
        rows[i] = .{ .cells = cells };
    }
    try p.table(.{ .rows = rows, .columns = cols, .selected = pane.selected, .offset = pane.offset, .follow_selection = true, .zebra = true, .scrollbar = true }, try p.fmt("pane:{d}", .{ctx.state.screen * 8 + ctx.index}));
}
fn sortedProcesses(s: *State, a: std.mem.Allocator) ![]Value {
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
fn dashboard(ctx: *Context, p: *Container) !void {
    const s = ctx.state;
    const a = p.ctx.allocator;
    switch (ctx.index) {
        0 => {
            try p.label(try p.fmt("{s}  {d:.1} GHz", .{ m.string(val(s, "cpu.model")), m.num(val(s, "cpu.frequencyGhz")) }));
            try graph(p, val(s, "cpu.history"), "CPU %", null);
            const items = try a.alloc(h.widgets.MeterItem, m.arr(val(s, "cpu.cores")).len);
            for (m.arr(val(s, "cpu.cores")), 0..) |v, i| items[i] = .{ .label = try p.fmt("P{d}", .{i}), .value = m.num(v) };
            try p.meters(.{ .items = items, .columns = if (p.width() > 35) 2 else 1 });
        },
        1 => {
            try p.label(try p.fmt("F3 filter: {s}  F6 sort: {s}", .{ s.filter.slice(), ([_][]const u8{ "cpu", "mem", "pid", "name" })[s.sort] }));
            try table(ctx, p, try sortedProcesses(s, a), &.{ .{ "pid", "PID" }, .{ "name", "Name" }, .{ "cpu", "CPU%" }, .{ "mem", "MEM%" }, .{ "threads", "THR" }, .{ "state", "S" }, .{ "user", "User" }, .{ "command", "Command" } }, 1);
        },
        2 => {
            try p.meter(.{ .label = "RAM", .value = m.num(val(s, "memory.used")), .max = @max(1, m.num(val(s, "memory.total"))) });
            inline for (.{ "used", "available", "cached", "buffers", "free" }) |key| try p.label(try p.fmt("{s: <12} {s}", .{ key, try bytes(p, m.num(val(s, "memory." ++ key))) }));
            try p.meter(.{ .label = "Swap", .value = m.num(val(s, "memory.swapUsed")), .max = @max(1, m.num(val(s, "memory.swapTotal"))) });
            try graph(p, val(s, "memory.history"), "", null);
        },
        3 => {
            try p.label(try p.fmt("Down {s}/s  Up {s}/s", .{ try bytes(p, m.num(val(s, "network.downRate"))), try bytes(p, m.num(val(s, "network.upRate"))) }));
            try graph(p, val(s, "network.downHistory"), "down", val(s, "network.upHistory"));
            try p.label(try p.fmt("Received {s}", .{try bytes(p, m.num(val(s, "network.downTotal")))}));
            try p.label(try p.fmt("Sent {s}", .{try bytes(p, m.num(val(s, "network.upTotal")))}));
        },
        4 => {
            const disks = m.arr(val(s, "disks"));
            for (disks[0..@min(2, disks.len)]) |d| {
                try p.label(try p.fmt("{s} {s}", .{ m.string(m.get(d, "device")), m.string(m.get(d, "mount")) }));
                try p.meter(.{ .label = "Used", .value = m.num(m.get(d, "used")), .max = @max(1, m.num(m.get(d, "total"))) });
                try graph(p, m.get(d, "readHistory"), "read", m.get(d, "writeHistory"));
            }
        },
        5 => {
            inline for (.{ "hostname", "os", "kernel", "shell", "processCount", "threadCount", "uptime" }) |key| try p.label(try p.fmt("{s: <12} {s}", .{ key, try m.display(a, val(s, "system." ++ key)) }));
            try graph(p, val(s, "cpu.history"), "CPU History", null);
        },
        6 => {
            const temps = m.arr(val(s, "temperatures"));
            if (temps.len == 0) try p.label("No thermal sensors available");
            for (temps) |t| try p.meter(.{ .label = m.string(m.get(t, "label")), .value = m.num(m.get(t, "value")), .max = 100, .text = try p.fmt("{d:.0}°C", .{m.num(m.get(t, "value"))}) });
        },
        else => try table(ctx, p, m.arr(val(s, "logs")), &.{ .{ "time", "Time" }, .{ "level", "Level" }, .{ "message", "Message" } }, 0),
    }
}
fn telemetry(ctx: *Context, p: *Container) !void {
    const s = ctx.state;
    switch (s.screen) {
        1 => switch (ctx.index) {
            0 => try table(ctx, p, m.arr(val(s, "telemetry.protocols")), &.{ .{ "protocol", "Protocol" }, .{ "inbound", "In" }, .{ "outbound", "Out" }, .{ "total", "Total" } }, 0),
            1 => try graph(p, val(s, "telemetry.netInHistory"), "in", val(s, "telemetry.netOutHistory")),
            2 => try graph(p, val(s, "telemetry.retransHistory"), "Retransmits", null),
            3 => {
                if (val(s, "telemetry.http") == .null) {
                    try p.label("HTTP access log unavailable (read-only)");
                } else {
                    try table(ctx, p, m.arr(val(s, "telemetry.http.recent")), &.{ .{ "time", "Time" }, .{ "method", "Method" }, .{ "path", "Path" }, .{ "status", "Status" }, .{ "client", "Client" } }, 0);
                }
            },
            4 => try table(ctx, p, m.arr(val(s, "telemetry.remotes")), &.{ .{ "host", "Host" }, .{ "connections", "Connections" }, .{ "protocols", "Protocols" } }, 0),
            else => try table(ctx, p, m.arr(val(s, "telemetry.ssh")), &.{ .{ "time", "Time" }, .{ "action", "Action" }, .{ "user", "User" }, .{ "from", "From" } }, 0),
        },
        2 => switch (ctx.index) {
            0 => try table(ctx, p, m.arr(val(s, "telemetry.sessions")), &.{ .{ "user", "User" }, .{ "tty", "TTY" }, .{ "from", "From" }, .{ "idle", "Idle" }, .{ "what", "Command" } }, 0),
            1 => try table(ctx, p, m.arr(val(s, "telemetry.logins")), &.{ .{ "user", "User" }, .{ "tty", "TTY" }, .{ "from", "From" }, .{ "when", "When" }, .{ "status", "Status" } }, 0),
            2 => try table(ctx, p, m.arr(val(s, "telemetry.ssh")), &.{ .{ "time", "Time" }, .{ "action", "Action" }, .{ "user", "User" }, .{ "from", "From" } }, 0),
            else => try graph(p, val(s, "telemetry.sessionHistory"), "Sessions", null),
        },
        3 => switch (ctx.index) {
            0 => try table(ctx, p, m.arr(val(s, "telemetry.interfaces")), &.{ .{ "name", "Name" }, .{ "state", "State" }, .{ "rxRate", "RX B/s" }, .{ "txRate", "TX B/s" }, .{ "errors", "Errors" }, .{ "drops", "Drops" } }, 0),
            1 => try table(ctx, p, m.arr(val(s, "telemetry.connections")), &.{ .{ "proto", "Proto" }, .{ "state", "State" }, .{ "local", "Local" }, .{ "remote", "Remote" }, .{ "process", "Process" } }, 0),
            2 => try table(ctx, p, m.arr(val(s, "telemetry.listeners")), &.{ .{ "proto", "Proto" }, .{ "address", "Address" }, .{ "port", "Port" }, .{ "process", "Process" } }, 0),
            else => try graph(p, val(s, "telemetry.connectionHistory"), "Connections", null),
        },
        else => switch (ctx.index) {
            0 => try table(ctx, p, m.arr(val(s, "telemetry.services")), &.{ .{ "name", "Unit" }, .{ "active", "State" }, .{ "description", "Description" } }, 0),
            1 => try table(ctx, p, m.arr(val(s, "telemetry.filesystems")), &.{ .{ "mount", "Mount" }, .{ "device", "Device" }, .{ "type", "Type" }, .{ "used", "Used B" }, .{ "size", "Size B" } }, 0),
            2 => {
                inline for (.{ "contextSwitchRate", "interruptRate", "forkRate", "procsRunning", "procsBlocked", "entropy", "openFiles" }) |key| try p.label(try p.fmt("{s}  {s}", .{ key, try m.display(p.ctx.allocator, val(s, "telemetry.kernel." ++ key)) }));
            },
            else => try table(ctx, p, m.arr(val(s, "telemetry.journal")), &.{ .{ "time", "Time" }, .{ "level", "Level" }, .{ "unit", "Unit" }, .{ "message", "Message" } }, 0),
        },
    }
}
fn canvas(ctx: *Context, c: *h.graphics.BrailleCanvas) !void {
    for (0..c.width) |x| {
        c.pixel(@floatFromInt(x), (0.5 + 0.35 * @sin(@as(f64, @floatFromInt(x)) / 12 + m.num(val(ctx.state, "time")))) * @as(f64, @floatFromInt(c.height -| 1)));
    }
}
fn body(ctx: *Context, p: *Container) anyerror!void {
    const s = ctx.state;
    switch (s.screen) {
        0 => try dashboard(ctx, p),
        1...4 => try telemetry(ctx, p),
        5 => switch (ctx.index) {
            0 => {
                try p.label("Click controls; e edits text; Esc finishes");
                for ([_][]const u8{ "Primary", "Success", "Warning", "Danger", "Ghost" }) |name| try p.button(.{ .label = name }, try p.fmt("button:{s}", .{name}));
                try p.checkbox(.{ .label = "Notifications", .checked = s.checked }, "check");
                try p.checkbox(.{ .label = "Live updates", .checked = s.toggle, .variant = .toggle }, "toggle");
                try p.select(.{ .value = m.themes[s.select_index], .options = &m.themes, .selected_index = s.select_index, .open = s.select_open }, "select");
                try p.textInput(.{ .value = s.input.slice(), .focused = s.editing, .placeholder = "Type here" }, "input");
            },
            1 => {
                for (0..8) |i| try p.meter(.{ .value = @as(f64, @floatFromInt(i + 1)) / 8, .label = try p.fmt("Meter {d}", .{i + 1}) });
                try p.gauge(.{ .value = m.num(val(s, "cpu.total")), .label = "CPU" });
            },
            else => {
                try p.heading("Typography & Unicode");
                try p.label("日本語 中文 한국어 • café • 🚀");
                for ([_][]const u8{ "READY", "WARNING", "LIVE" }) |name| try p.badge(.{ .text = name });
                try p.button(.{ .label = "Command palette" }, "palette");
                try graph(p, val(s, "cpu.history"), "History", null);
            },
        },
        6 => switch (ctx.index) {
            0 => try p.canvas(null, h.ui.CanvasBody.with(ctx, canvas)),
            1 => try graph(p, val(s, "cpu.history"), "CPU %", null),
            2 => try graph(p, val(s, "network.downHistory"), "down", val(s, "network.upHistory")),
            else => try p.gauge(.{ .value = m.num(val(s, "cpu.total")), .label = "CPU" }),
        },
        7 => {
            if (ctx.index == 0) {
                try p.label("F2 or Left/Right to switch themes");
                for (m.themes, 0..) |name, i| try p.button(.{ .label = name }, try p.fmt("theme:{d}", .{i}));
            } else {
                try p.heading(m.themes[s.theme]);
                inline for (.{ "primary", "secondary", "accent", "success", "warning", "danger", "muted" }) |name| try p.meter(.{ .value = 0.7, .label = name, .color = @field(p.theme(), name) });
                try graph(p, val(s, "cpu.history"), "Preview", null);
            }
        },
        8 => {
            if (ctx.index == 0) {
                try p.label(try p.fmt("Last key: {s}", .{s.last_key.slice()}));
                try p.label(try p.fmt("Mouse: {s}", .{s.last_mouse.slice()}));
                try p.label("e to edit; Esc exits text input");
                try p.textInput(.{ .value = s.input.slice(), .focused = s.editing }, "input");
                const rows = try p.ctx.allocator.alloc(h.widgets.TableRow, s.key_count);
                for (rows, 0..) |*row, i| {
                    const cells = try p.ctx.allocator.alloc([]const u8, 1);
                    cells[0] = s.key_log[i][0..s.key_lens[i]];
                    row.* = .{ .cells = cells };
                }
                try p.table(.{ .rows = rows, .columns = &.{.{ .title = "Key Events" }}, .scrollbar = true }, "input.events");
            } else {
                try p.label("Renderer: native Zig");
                try p.label("Arrows scroll the focused pane");
                try p.label("Ctrl+K palette · F1 help · q quit");
            }
        },
        else => {
            try p.meter(.{ .label = "Load", .value = (@sin(m.num(val(s, "time")) + @as(f64, @floatFromInt(ctx.index))) + 1) / 2 });
            try graph(p, val(s, "cpu.history"), "", null);
        },
    }
}
fn titles(s: *State, wide: bool) []const []const u8 {
    return switch (s.screen) {
        0 => if (wide) &.{ "CPU Overview", "Processes", "Memory & Swap", "Network", "Disks", "System", "Temperatures & Sensors", "Logs" } else &.{ "CPU Overview", "Processes", "Memory & Swap", "Network" },
        1 => &.{ "Protocols", "TCP Segments", "Retransmits", "HTTP", "Remote Hosts", "SSH Authentication" },
        2 => &.{ "Active Sessions", "Login History", "SSH Authentication", "Session History" },
        3 => &.{ "Interfaces", "Connections", "Listeners", "Connection History" },
        4 => &.{ "Services", "Filesystems", "Kernel", "Journal" },
        5 => &.{ "Controls", "Meters & Gauge", "Text & Badges" },
        6 => &.{ "Braille Canvas", "CPU Plot", "Network Plot", "Gauge" },
        7 => &.{ "Built-in Themes", "Live Preview" },
        8 => &.{ "Input Inspector", "Diagnostics" },
        else => &.{ "Stress 01", "Stress 02", "Stress 03", "Stress 04", "Stress 05", "Stress 06", "Stress 07", "Stress 08", "Stress 09", "Stress 10", "Stress 11", "Stress 12" },
    };
}
const GridContext = struct { state: *State, names: []const []const u8, allocator: std.mem.Allocator };
fn gridCells(ctx: *GridContext, g: *h.Grid) anyerror!void {
    for (ctx.names, 0..) |name, i| {
        const c = try ctx.allocator.create(Context);
        c.* = .{ .state = ctx.state, .index = i };
        try g.panel(.{ .title = name }, .{}, h.Body.with(c, body));
    }
}
fn header(s: *State, r: *Container) anyerror!void {
    try r.heading("hqtui — zig");
    try r.spacer(.fill);
    try r.label(try r.fmt("{s}  {s}", .{ if (s.real) "REAL" else "SIMULATED", if (s.paused) "PAUSED" else "LIVE" }));
}
pub fn render(s: *State, ui: *Container) anyerror!void {
    try ui.row(.{ .layout = .{ .size = .{ .cells = 1 } } }, h.Body.with(s, header));
    const groups: usize = if (ui.width() < 150) 2 else 1;
    for (0..groups) |group| {
        const base = group * 5;
        const count: usize = if (groups == 2) 5 else 10;
        const tabs = try ui.ctx.allocator.alloc([]const u8, count);
        for (tabs, 0..) |*tab, i| tab.* = try ui.fmt("{d} {s}", .{ (base + i + 1) % 10, m.screens[base + i] });
        try ui.tabs(.{ .tabs = tabs, .active = if (s.screen >= base and s.screen < base + count) s.screen - base else std.math.maxInt(usize) }, try ui.fmt("tabs{d}", .{base}));
    }
    if (ui.width() < 30 or ui.height() < 12) {
        try ui.label("Terminal too small; resize to 30×12");
        try ui.spacer(.fill);
    } else {
        const names = titles(s, ui.width() >= 90 and ui.height() >= 50);
        const cols: usize = if (ui.width() < 45) 1 else if (s.screen == 9 and ui.width() >= 120) 4 else if (s.screen == 5 or s.screen == 9 or (s.screen == 1 and ui.width() >= 120) or (s.screen == 0 and ui.width() >= 160)) 3 else 2;
        const columns = try ui.ctx.allocator.alloc(h.layout.Size, cols);
        @memset(columns, .{ .fr = 1 });
        const rows = try ui.ctx.allocator.alloc(h.layout.Size, (names.len + cols - 1) / cols);
        @memset(rows, .{ .fr = 1 });
        const ctx = try ui.ctx.allocator.create(GridContext);
        ctx.* = .{ .state = s, .names = names, .allocator = ui.ctx.allocator };
        try ui.grid(.{ .columns = columns, .rows = rows, .layout = .{ .gap = 1 } }, h.GridBody.with(ctx, gridCells));
    }
    if (s.missing.len > 0) try ui.label(try ui.fmt("Unavailable: {s}", .{s.missing}));
    const right = try ui.ctx.allocator.alloc(h.widgets.StatusItem, 1);
    right[0] = .{ .label = try ui.fmt("{s} · {s}", .{ m.screens[s.screen], m.themes[s.theme] }) };
    try ui.statusBar(.{ .items = &.{.{ .label = "F1 help  F2 theme  F3 filter  ^K palette  q quit" }}, .right = right });
    if (s.filtering) ui.modal(.{ .title = "Filter Processes", .message = try ui.fmt("{s}▏\nEnter applies · Esc clears", .{s.filter.slice()}), .width = 60 });
    if (s.help) ui.modal(.{ .title = "hqtui — Help", .width = 66, .message = "1–9/0 / Tab: screen\nF2 theme · F3 filter · F6 sort\nCtrl+K palette · Space pause\nArrows / PgUp / PgDn / Home / End scroll\nMouse tabs, controls, selection and wheel\ne edits text · Esc finishes\nq / Ctrl+C quit · Any key closes help" });
    if (s.modal) ui.modal(.{ .title = "Read-only Demo", .message = "No process will be killed and no service changed.\nPress any key to close.", .width = 58 });
    if (s.palette) {
        const matches = try s.commands(ui.ctx.allocator);
        const items = try ui.ctx.allocator.alloc(h.widgets.PaletteItem, matches.len);
        for (matches, 0..) |name, i| items[i] = .{ .label = name };
        ui.commandPalette(.{ .query = s.query.slice(), .items = items, .selected = s.palette_index, .placeholder = "Search commands" });
    }
}
