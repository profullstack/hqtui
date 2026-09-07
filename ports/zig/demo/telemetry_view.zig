//! Native Traffic/Sessions/Network/Services reference layouts and formatting.
const r = @import("reference.zig");
const h = r.h;
const m = r.m;
const std = r.std;
const C = r.C;
const P = r.P;
pub fn render(s: *m.State, p: *P) !void {
    const c = try r.root(s, p);
    switch (s.screen) {
        1 => try traffic(c, p),
        2 => try sessions(c, p),
        3 => try network(c, p),
        4 => try services(c, p),
        else => {},
    }
}
fn rate(p: *P, v: f64) ![]const u8 {
    if (v >= 1e6) return p.fmt("{d:.1}M/s", .{v / 1e6});
    if (v >= 1000) return p.fmt("{d:.1}K/s", .{v / 1000});
    return p.fmt("{d:.0}/s", .{v});
}
fn commas(p: *P, v: f64) ![]const u8 {
    const text = try p.fmt("{d:.0}", .{v});
    var out: std.ArrayList(u8) = .empty;
    for (text, 0..) |ch, i| {
        if (i > 0 and (text.len - i) % 3 == 0) try out.append(p.ctx.allocator, ',');
        try out.append(p.ctx.allocator, ch);
    }
    return out.toOwnedSlice(p.ctx.allocator);
}
fn traffic(c: *C, p: *P) !void {
    if (c.s.real) try p.label("Protocol/direction: port-based estimates; HTTP rate: estimated from log growth");
    try c.row(p, .{ .cells = 13 }, 1, trafficTop);
    try c.row(p, .{ .fr = 1 }, 1, trafficMiddle);
    if (m.arr(c.at("telemetry.http.recent")).len > 0) try c.panel(p, .{ .title = "Recent Requests", .layout = .{ .size = .{ .cells = 10 } }, .border_color = p.theme().primary }, requests);
}
fn trafficTop(c: *C, p: *P) !void {
    const t = p.theme().*;
    try c.panel(p, .{ .title = "Protocols", .subtitle = try p.fmt("{d:.0} in / {d:.0} out", .{ c.n("telemetry.inboundConnections"), c.n("telemetry.outboundConnections") }), .border_color = t.accent }, protocols);
    try c.panel(p, .{ .title = "TCP", .layout = .{ .size = .{ .fr = 0.9 } }, .border_color = t.primary }, tcp);
    try c.panel(p, .{ .title = "Retransmits", .layout = .{ .size = .{ .fr = 0.7 } }, .border_color = if (c.n("telemetry.net.retransRatio") > 0.02) t.danger else t.success }, retrans);
}
fn protocols(c: *C, p: *P) !void {
    const data = m.arr(c.at("telemetry.protocols"));
    if (data.len == 0) {
        try p.label("No sockets visible.");
        return;
    }
    var maximum: f64 = 1;
    for (data) |v| maximum = @max(maximum, m.num(m.get(v, "total")));
    const items = try p.ctx.allocator.alloc(h.widgets.MeterItem, @min(9, data.len));
    for (items, data[0..items.len], 0..) |*item, v, i| item.* = .{ .label = m.string(m.get(v, "protocol")), .value = m.num(m.get(v, "total")) / maximum, .text = try r.scalar(p, m.get(v, "total")), .color = h.theme.seriesColor(p.theme().*, @intCast(i)) };
    try p.meters(.{ .items = items, .label_width = 13, .value_width = 5 });
}
fn tcpRates(c: *C, p: *P) !void {
    const t = p.theme().*;
    try r.tx(p, try p.fmt("↓ {s} seg", .{try rate(p, c.n("telemetry.net.rates.inSegs"))}), t.primary);
    try p.text(try p.fmt("↑ {s} seg", .{try rate(p, c.n("telemetry.net.rates.outSegs"))}), .{ .fg = t.secondary, .alignment = .right });
}
fn tcp(c: *C, p: *P) !void {
    const t = p.theme().*;
    try c.row(p, .{ .cells = 1 }, 0, tcpRates);
    try r.multi(p, c.at("telemetry.netInHistory"), c.at("telemetry.netOutHistory"), t.primary, t.secondary);
    try p.divider(.{});
    try r.keys(p, &.{ r.kv("Established", try r.scalar(p, c.at("telemetry.net.tcpEstablished")), t.success), r.kv("Opens in/out", try p.fmt("{s} / {s}", .{ try rate(p, c.n("telemetry.net.rates.passiveOpens")), try rate(p, c.n("telemetry.net.rates.activeOpens")) }), t.accent), r.kv("Resets sent", try commas(p, c.n("telemetry.net.tcpOutRsts")), t.muted) }, true);
}
fn retrans(c: *C, p: *P) !void {
    const t = p.theme().*;
    try p.text(try p.fmt("{d:.2}%", .{std.math.clamp(c.n("telemetry.net.retransRatio"), 0, 1) * 100}), .{ .fg = if (c.n("telemetry.net.retransRatio") > 0.02) t.danger else t.success, .bold = true });
    try p.label("of outbound segments");
    try r.plot(p, c.at("telemetry.retransHistory"), t.danger, null, false);
    try r.keys(p, &.{ r.kv("UDP in/out", try p.fmt("{s} / {s}", .{ try rate(p, c.n("telemetry.net.rates.udpIn")), try rate(p, c.n("telemetry.net.rates.udpOut")) }), t.muted), r.kv("ICMP", try p.fmt("{d:.0} / {d:.0}", .{ c.n("telemetry.net.icmpInMsgs"), c.n("telemetry.net.icmpOutMsgs") }), t.muted) }, true);
}
fn trafficMiddle(c: *C, p: *P) !void {
    try c.col(p, .fill, 1, httpColumn);
    try c.col(p, .{ .fr = 0.85 }, 1, sshColumn);
}
fn httpColumn(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "HTTP", .subtitle = if (c.at("telemetry.http") == .null) "no access log" else try p.fmt("{d:.1} req/s", .{c.n("telemetry.http.requestsPerSecond")}), .border_color = p.theme().success }, httpBody);
}
fn httpSource(c: *C, p: *P) !void {
    const t = p.theme().*;
    try r.tx(p, c.str("telemetry.http.source"), t.muted);
    try p.text(try p.fmt("{d:.0} upgrades (ws)", .{c.n("telemetry.http.upgrades")}), .{ .fg = t.secondary, .alignment = .right });
}
fn httpGraph(c: *C, p: *P) !void {
    try r.plot(p, c.at("telemetry.http.history"), p.theme().success, null, false);
}
fn httpBody(c: *C, p: *P) !void {
    const t = p.theme().*;
    if (c.at("telemetry.http") == .null) {
        try p.label("No readable HTTP access log.");
        try p.label("nginx, apache, httpd and caddy logs are");
        try p.label("root/adm readable — run with sudo to track requests.");
        return;
    }
    try c.row(p, .{ .cells = 1 }, 0, httpSource);
    try p.sized(.{ .cells = 6 }, h.Body.with(c, httpGraph));
    try p.divider(.{ .label = "status" });
    const data = m.arr(c.at("telemetry.http.statusClasses"));
    var maximum: f64 = 1;
    for (data) |v| maximum = @max(maximum, m.num(m.get(v, "count")));
    const items = try p.ctx.allocator.alloc(h.widgets.MeterItem, data.len);
    for (data, 0..) |v, i| items[i] = .{ .label = m.string(m.get(v, "class")), .value = m.num(m.get(v, "count")) / maximum, .text = try r.scalar(p, m.get(v, "count")), .color = r.statusColor(t, m.string(m.get(v, "class"))) };
    try p.meters(.{ .items = items, .label_width = 5, .value_width = 7 });
    try p.divider(.{ .label = "top paths" });
    try r.table(c, p, 0, m.arr(c.at("telemetry.http.topPaths")), &.{ r.dc("path", "Path", 0, 20, t.primary, false), r.dc("count", "Hits", 7, 0, t.accent, true) }, false, false, true);
}
fn sshColumn(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "SSH Activity", .subtitle = try p.fmt("{d}", .{m.arr(c.at("telemetry.ssh")).len}), .border_color = p.theme().warning }, ssh);
    try c.panel(p, .{ .title = "Top Remote Hosts", .layout = .{ .size = .{ .cells = 10 } }, .border_color = p.theme().secondary }, remotes);
}
fn ssh(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = try p.ctx.allocator.dupe(m.Value, m.arr(c.at("telemetry.ssh")));
    if (data.len == 0) {
        try p.label("No sshd events in the journal.");
        return;
    }
    std.mem.reverse(m.Value, data);
    var cols = [_]r.DC{ r.dc("time", "Time", 9, 0, t.muted, false), r.dc("action", "Action", 11, 0, null, false), r.dc("user", "User", 12, 0, t.primary, false), r.dc("from", "From", 0, 14, t.accent, false), r.dc("method", "Method", 10, 0, t.muted, false) };
    cols[1].tint = .ssh;
    try r.table(c, p, 1, data, &cols, true, true, true);
}
fn remotes(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = m.arr(c.at("telemetry.remotes"));
    if (data.len == 0) {
        try p.label("No remote peers.");
        return;
    }
    try r.table(c, p, 2, data, &.{ r.dc("host", "Host", 0, 16, t.accent, false), r.dc("connections", "Conns", 6, 0, t.success, true), r.dc("protocols", "Protocols", 0, 12, t.muted, false) }, true, true, true);
}
fn requests(c: *C, p: *P) !void {
    const t = p.theme().*;
    var cols = [_]r.DC{ r.dc("time", "Time", 9, 0, t.muted, false), r.dc("method", "Method", 7, 0, t.secondary, false), r.dc("path", "Path", 0, 24, t.primary, false), r.dc("status", "Status", 7, 0, null, true), r.dc("client", "Client", 16, 0, t.accent, false), r.dc("bytes", "Bytes", 9, 0, t.muted, true) };
    cols[3].tint = .status;
    try r.table(c, p, 3, m.arr(c.at("telemetry.http.recent")), &cols, true, true, true);
}
fn sessions(c: *C, p: *P) !void {
    try c.row(p, .{ .cells = 9 }, 1, sessionsTop);
    try c.row(p, .{ .fr = 1 }, 1, sessionsBottom);
}
fn sessionsTop(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Active Sessions", .subtitle = try p.fmt("{d}", .{m.arr(c.at("telemetry.sessions")).len}), .border_color = p.theme().success }, activeSessions);
    try c.panel(p, .{ .title = "Process States", .layout = .{ .size = .{ .cells = 34 } }, .border_color = p.theme().primary }, processStates);
}
fn activeSessions(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = m.arr(c.at("telemetry.sessions"));
    if (data.len == 0) {
        try p.label("No interactive sessions.");
        try p.label("(`who` reports nothing on this host)");
        return;
    }
    try r.table(c, p, 0, data, &.{ r.dc("user", "User", 12, 0, t.primary, false), r.dc("tty", "TTY", 10, 0, null, false), r.dc("from", "From", 0, 12, t.accent, false), r.dc("loginAt", "Login", 14, 0, t.muted, false), r.dc("idle", "Idle", 8, 0, null, true) }, false, true, true);
}
fn processStates(c: *C, p: *P) !void {
    const t = p.theme().*;
    inline for (.{ "running", "sleeping", "stopped", "zombie" }, .{ "run ", "slp ", "stop", "zomb" }, 0..) |key, label, i| try p.meter(.{ .label = label, .value = c.n("telemetry.states." ++ key) / @max(1, c.n("telemetry.states.total")), .text = try r.scalar(p, c.at("telemetry.states." ++ key)), .heat = false, .color = ([_]r.Color{ t.success, t.primary, t.warning, t.danger })[i] });
    try p.spacer(.{ .cells = 1 });
    try r.keys(p, &.{r.kv("Total", try r.scalar(p, c.at("telemetry.states.total")), t.accent)}, true);
}
fn sessionsBottom(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Recent Logins", .subtitle = try p.fmt("{d} from wtmp", .{m.arr(c.at("telemetry.logins")).len}), .border_color = p.theme().accent }, logins);
    try c.col(p, .{ .fr = 0.8 }, 1, failedColumn);
}
fn logins(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = m.arr(c.at("telemetry.logins"));
    if (data.len == 0) {
        try p.label("No login history available.");
        return;
    }
    var cols = [_]r.DC{ r.dc("user", "User", 12, 0, t.primary, false), r.dc("tty", "TTY", 12, 0, t.muted, false), r.dc("from", "From", 0, 14, t.accent, false), r.dc("when", "When", 0, 16, t.muted, false), r.dc("status", "Status", 8, 0, null, false) };
    cols[4].tint = .login;
    try r.table(c, p, 1, data, &cols, true, true, true);
}
fn failedColumn(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Failed Logins", .border_color = p.theme().danger }, failed);
    try c.panel(p, .{ .title = "Session History", .layout = .{ .size = .{ .cells = 8 } }, .border_color = p.theme().secondary }, sessionHistory);
}
fn failed(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = m.arr(c.at("telemetry.failedLogins"));
    if (data.len == 0) {
        try p.label("None recorded.");
        try p.label("(btmp is usually root-only)");
        return;
    }
    try r.table(c, p, 2, data, &.{ r.dc("user", "User", 12, 0, t.danger, false), r.dc("from", "From", 0, 12, null, false), r.dc("when", "When", 0, 14, t.muted, false) }, false, true, true);
}
fn sessionHistory(c: *C, p: *P) !void {
    try p.label("concurrent sessions");
    try r.plot(p, c.at("telemetry.sessionHistory"), p.theme().success, null, false);
}
fn network(c: *C, p: *P) !void {
    try c.row(p, .{ .cells = 13 }, 1, interfaces);
    try c.row(p, .{ .fr = 1 }, 1, networkBottom);
}
fn interfaces(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = m.arr(c.at("telemetry.interfaces"));
    var active: std.ArrayList(m.Value) = .empty;
    for (data) |v| {
        if (m.num(m.get(v, "rxTotal")) > 0 or m.eq(m.string(m.get(v, "state")), "up")) try active.append(p.ctx.allocator, v);
    }
    const shown = if (active.items.len > 0) active.items else data;
    if (shown.len == 0) {
        try c.panel(p, .{ .title = "Interfaces" }, noInterfaces);
        return;
    }
    for (shown[0..@min(3, shown.len)], 0..) |v, i| {
        const d = try c.sub(p, v, i);
        try d.panel(p, .{ .title = try p.fmt("{s} ({s})", .{ d.str("name"), d.str("state") }), .subtitle = d.str("ip"), .border_color = ([_]r.Color{ t.primary, t.success, t.secondary })[i] }, interfaceBody);
    }
}
fn noInterfaces(_: *C, p: *P) !void {
    try p.label("No interfaces reported.");
}
fn interfaceRates(c: *C, p: *P) !void {
    try r.tx(p, try p.fmt("↓ {s}", .{try r.byteRate(p, c.n("rxRate"))}), p.theme().primary);
    try p.text(try p.fmt("↑ {s}", .{try r.byteRate(p, c.n("txRate"))}), .{ .fg = p.theme().secondary, .alignment = .right });
}
fn interfaceBody(c: *C, p: *P) !void {
    const t = p.theme().*;
    try c.row(p, .{ .cells = 1 }, 0, interfaceRates);
    try r.multi(p, c.at("rxHistory"), c.at("txHistory"), t.primary, t.secondary);
    try p.divider(.{});
    try r.keys(p, &.{ r.kv("RX total", try r.bytes(p, c.n("rxTotal"), 2), t.primary), r.kv("TX total", try r.bytes(p, c.n("txTotal"), 2), t.secondary), r.kv("MAC", c.str("mac"), t.muted), r.kv("MTU / err / drop", try p.fmt("{d:.0} / {d:.0} / {d:.0}", .{ c.n("mtu"), c.n("errors"), c.n("drops") }), t.muted) }, true);
}
fn networkBottom(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Connections", .subtitle = try p.fmt("{d} open", .{m.arr(c.at("telemetry.connections")).len}), .border_color = p.theme().accent }, connections);
    try c.col(p, .{ .fr = 0.7 }, 1, listenersColumn);
}
fn connections(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = m.arr(c.at("telemetry.connections"));
    if (data.len == 0) {
        try p.label("No connections visible (`ss` unavailable).");
        return;
    }
    try r.table(c, p, 0, data, &.{ r.dc("proto", "Proto", 6, 0, t.muted, false), r.dc("local", "Local", 0, 18, null, false), r.dc("remote", "Remote", 0, 18, t.accent, false), r.dc("state", "State", 10, 0, t.success, false), r.dc("process", "Process", 0, 12, t.primary, false) }, true, true, true);
}
fn listenersColumn(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Listening Ports", .subtitle = try p.fmt("{d}", .{m.arr(c.at("telemetry.listeners")).len}), .border_color = p.theme().warning }, listeners);
    try c.panel(p, .{ .title = "Open Connections", .layout = .{ .size = .{ .cells = 6 } }, .border_color = p.theme().secondary }, connectionHistory);
}
fn listeners(c: *C, p: *P) !void {
    const t = p.theme().*;
    try r.table(c, p, 1, m.arr(c.at("telemetry.listeners")), &.{ r.dc("proto", "Proto", 6, 0, t.muted, false), r.dc("port", "Port", 7, 0, t.warning, true), r.dc("address", "Address", 0, 10, t.muted, false), r.dc("process", "Process", 0, 10, t.primary, false) }, true, true, true);
}
fn connectionHistory(c: *C, p: *P) !void {
    try r.plot(p, c.at("telemetry.connectionHistory"), p.theme().accent, null, false);
}
fn services(c: *C, p: *P) !void {
    try c.row(p, .{ .fr = 1 }, 1, servicesTop);
    try c.panel(p, .{ .title = "Filesystems", .layout = .{ .size = .{ .cells = 10 } }, .border_color = p.theme().secondary }, filesystems);
}
fn servicesTop(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = m.arr(c.at("telemetry.services"));
    var count: usize = 0;
    for (data) |v| {
        if (m.eq(m.string(m.get(v, "active")), "failed")) count += 1;
    }
    try c.panel(p, .{ .title = "Services", .subtitle = if (count > 0) try p.fmt("{d} failed", .{count}) else try p.fmt("{d} units", .{data.len}), .subtitle_color = if (count > 0) t.danger else t.muted, .border_color = if (count > 0) t.danger else t.success }, units);
    try c.col(p, .{ .fr = 0.85 }, 1, hardwareColumn);
}
fn units(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = m.arr(c.at("telemetry.services"));
    if (data.len == 0) {
        try p.label("systemd not available on this host.");
        return;
    }
    var cols = [_]r.DC{ r.dc("name", "Unit", 0, 18, t.primary, false), r.dc("active", "Active", 10, 0, null, false), r.dc("sub", "Sub", 10, 0, t.muted, false), r.dc("description", "Description", 0, 16, t.muted, false) };
    cols[1].tint = .service;
    try r.table(c, p, 0, data, &cols, true, true, true);
}
fn hardwareColumn(c: *C, p: *P) !void {
    const t = p.theme().*;
    try c.panel(p, .{ .title = "Kernel", .layout = .{ .size = .{ .cells = 11 } }, .border_color = t.accent }, kernel);
    try c.panel(p, .{ .title = "Containers", .layout = .{ .size = .{ .cells = 9 } }, .border_color = t.primary }, containers);
    try c.panel(p, .{ .title = "Hardware", .border_color = t.warning }, hardware);
}
fn krate(p: *P, v: f64) ![]const u8 {
    return if (v >= 1000) p.fmt("{d:.1}K/s", .{v / 1000}) else p.fmt("{d:.0}/s", .{v});
}
fn kernel(c: *C, p: *P) !void {
    const t = p.theme().*;
    try r.keys(p, &.{ r.kv("Context switches", try krate(p, c.n("telemetry.kernel.contextSwitchRate")), t.accent), r.kv("Interrupts", try krate(p, c.n("telemetry.kernel.interruptRate")), t.accent), r.kv("Forks", try krate(p, c.n("telemetry.kernel.forkRate")), t.accent), r.kv("Procs running", try r.scalar(p, c.at("telemetry.kernel.procsRunning")), t.success), r.kv("Procs blocked", try r.scalar(p, c.at("telemetry.kernel.procsBlocked")), if (c.n("telemetry.kernel.procsBlocked") != 0) t.warning else t.muted), r.kv("Open file descriptors", try commas(p, c.n("telemetry.kernel.openFiles")), t.primary), r.kv("Entropy available", try r.scalar(p, c.at("telemetry.kernel.entropy")), if (c.n("telemetry.kernel.entropy") < 200) t.warning else t.success), r.kv("Page in / out", try p.fmt("{d:.0}K / {d:.0}K", .{ c.n("telemetry.kernel.pageIn") / 1000, c.n("telemetry.kernel.pageOut") / 1000 }), t.muted) }, true);
}
fn containers(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = m.arr(c.at("telemetry.containers"));
    if (data.len == 0) {
        try p.label("No running containers.");
        try p.label("(docker not installed or not reachable)");
        return;
    }
    try r.table(c, p, 1, data, &.{ r.dc("name", "Name", 0, 12, t.primary, false), r.dc("image", "Image", 0, 14, t.muted, false), r.dc("status", "Status", 0, 12, t.success, false) }, true, true, true);
}
fn hardware(c: *C, p: *P) !void {
    const t = p.theme().*;
    var rows: std.ArrayList(h.widgets.KeyValueRow) = .empty;
    const a = p.ctx.allocator;
    if (c.at("telemetry.power") != .null) {
        try rows.appendSlice(a, &.{ r.kv("Battery", try p.fmt("{s}% ({s})", .{ try r.scalar(p, c.at("telemetry.power.battery")), c.str("telemetry.power.timeRemaining") }), t.success), r.kv("AC", if (c.at("telemetry.power.acConnected") == .bool and c.at("telemetry.power.acConnected").bool) "connected" else "on battery", t.muted), r.kv("Draw", if (c.at("telemetry.power.powerDraw") == .null) "—" else try p.fmt("{d:.1} W", .{c.n("telemetry.power.powerDraw")}), t.warning) });
    }
    for (m.arr(c.at("telemetry.gpus"))) |v| {
        try rows.appendSlice(a, &.{ r.kv(m.string(m.get(v, "name")), try p.fmt("{s} · {s}°C", .{ if (m.get(v, "utilization") == .null) "—" else try r.pct(p, m.num(m.get(v, "utilization"))), try r.scalar(p, m.get(v, "temperature")) }), t.accent), r.kv("GPU memory", try p.fmt("{s} / {s}", .{ try r.bytes(p, m.num(m.get(v, "memoryUsed")), 2), try r.bytes(p, m.num(m.get(v, "memoryTotal")), 2) }), t.muted) });
    }
    if (rows.items.len == 0) {
        try p.label("No battery or GPU telemetry on this host.");
        return;
    }
    try r.keys(p, rows.items, true);
}
fn filesystems(c: *C, p: *P) !void {
    const t = p.theme().*;
    const data = m.arr(c.at("telemetry.filesystems"));
    if (data.len == 0) {
        try p.label("No filesystems reported.");
        return;
    }
    var cols = [_]r.DC{ r.dc("mount", "Mount", 0, 14, t.primary, false), r.dc("device", "Device", 0, 12, t.muted, false), r.dc("type", "Type", 8, 0, t.muted, false), r.dc("size", "Size", 10, 0, null, true), r.dc("used", "Used", 10, 0, null, true), r.dc("pct", "Use%", 6, 0, null, true), r.dc("inodes", "Inodes", 16, 0, t.muted, true) };
    cols[3].format = .bytes0;
    cols[4].format = .bytes0;
    cols[5].format = .pct;
    cols[5].tint = .usage;
    cols[6].format = .inodes;
    try r.table(c, p, 2, data, &cols, true, true, true);
}
