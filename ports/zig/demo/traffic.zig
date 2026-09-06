//! Read-only Traffic/Sessions parsers. Port labels and directions are estimates.
const std = @import("std");
const m = @import("model.zig");
const Value = m.Value;
const A = std.mem.Allocator;
fn text(s: []const u8) Value {
    return .{ .string = s };
}
fn number(n: f64) Value {
    return .{ .float = n };
}
fn object(a: A, keys: []const []const u8, values: []const Value) !Value {
    return .{ .object = try std.json.ObjectMap.init(a, keys, values) };
}
fn words(a: A, raw: []const u8) ![][]const u8 {
    var out: std.ArrayList([]const u8) = .empty;
    var iter = std.mem.tokenizeAny(u8, raw, " \t\r");
    while (iter.next()) |part| try out.append(a, part);
    return out.items;
}
fn stamp(raw: []const u8) []const u8 {
    if (raw.len < 8) return "";
    for (0..raw.len - 7) |i| {
        if (i > 0 and std.ascii.isDigit(raw[i - 1])) continue;
        const s = raw[i .. i + 8];
        if (s[2] != ':' or s[5] != ':') continue;
        var valid = true;
        for ([_]usize{ 0, 1, 3, 4, 6, 7 }) |j| {
            if (!std.ascii.isDigit(s[j])) valid = false;
        }
        if (valid) return s;
    }
    return "";
}
const ports = "20=FTP 21=FTP 22=SSH 23=Telnet 25=SMTP 53=DNS 67=DHCP 68=DHCP 80=HTTP 110=POP3 111=RPC 123=NTP 143=IMAP 161=SNMP 389=LDAP 443=HTTPS 445=SMB 465=SMTPS 514=Syslog 587=SMTP 631=IPP 636=LDAPS 993=IMAPS 995=POP3S 1194=OpenVPN 1433=MSSQL 1521=Oracle 2049=NFS 2379=etcd 3000=HTTP-dev 3306=MySQL 3389=RDP 4000=HTTP-dev 5000=HTTP-dev 5432=Postgres 5672=AMQP 5900=VNC 6379=Redis 8000=HTTP-alt 8080=HTTP-alt 8443=HTTPS-alt 9000=HTTP-alt 9090=Prometheus 9200=Elasticsearch 11211=Memcached 27017=MongoDB 41641=Tailscale 51820=WireGuard";
fn classify(a: A, port: []const u8) ![]const u8 {
    var pairs = std.mem.tokenizeScalar(u8, ports, ' ');
    while (pairs.next()) |pair| {
        const cut = std.mem.indexOfScalar(u8, pair, '=').?;
        if (m.eq(pair[0..cut], port)) return pair[cut + 1 ..];
    }
    const n = std.fmt.parseInt(u32, port, 10) catch 0;
    return if (n >= 32768) "ephemeral" else std.fmt.allocPrint(a, "port {s}", .{port});
}
const Endpoint = struct { host: []const u8, port: []const u8 };
fn endpoint(raw: []const u8) Endpoint {
    const cut = std.mem.lastIndexOfScalar(u8, raw, ':') orelse return .{ .host = raw, .port = "" };
    return .{ .host = raw[0..cut], .port = raw[cut + 1 ..] };
}
pub fn breakdown(a: A, connections: Value, listeners: Value) !Value {
    var buckets = std.json.Array.init(a);
    var remotes = std.json.Array.init(a);
    var inbound: f64 = 0;
    var outbound: f64 = 0;
    for (m.arr(connections)) |c| {
        const state = m.string(m.get(c, "state"));
        if (m.eq(state, "LISTEN") or (!m.eq(state, "ESTAB") and !std.mem.startsWith(u8, m.string(m.get(c, "proto")), "udp"))) continue;
        const local = endpoint(m.string(m.get(c, "local")));
        const remote = endpoint(m.string(m.get(c, "remote")));
        var incoming = false;
        for (m.arr(listeners)) |l| {
            if (m.eq(local.port, m.string(m.get(l, "port")))) {
                incoming = true;
                break;
            }
        }
        const protocol = try classify(a, if (incoming) local.port else remote.port);
        var found: ?usize = null;
        for (buckets.items, 0..) |b, i| {
            if (m.eq(m.string(m.get(b, "protocol")), protocol)) {
                found = i;
                break;
            }
        }
        if (found == null) {
            found = buckets.items.len;
            try buckets.append(try object(a, &.{ "protocol", "inbound", "outbound", "total" }, &.{ text(protocol), number(0), number(0), number(0) }));
        }
        const bucket = &buckets.items[found.?];
        const key = if (incoming) "inbound" else "outbound";
        m.ptr(bucket, key).* = number(m.num(m.get(bucket.*, key)) + 1);
        m.ptr(bucket, "total").* = number(m.num(m.get(bucket.*, "total")) + 1);
        if (incoming) {
            inbound += 1;
        } else {
            outbound += 1;
        }
        if (remote.host.len == 0 or m.eq(remote.host, "*") or m.eq(remote.host, "0.0.0.0")) continue;
        found = null;
        for (remotes.items, 0..) |r, i| {
            if (m.eq(m.string(m.get(r, "host")), remote.host)) {
                found = i;
                break;
            }
        }
        if (found == null) {
            found = remotes.items.len;
            try remotes.append(try object(a, &.{ "host", "connections", "protocols", "names" }, &.{ text(remote.host), number(0), text(""), .{ .array = std.json.Array.init(a) } }));
        }
        const r = &remotes.items[found.?];
        m.ptr(r, "connections").* = number(m.num(m.get(r.*, "connections")) + 1);
        var seen = false;
        for (m.arr(m.get(r.*, "names"))) |name| {
            if (m.eq(m.string(name), protocol)) seen = true;
        }
        if (!seen) try m.ptr(r, "names").array.append(text(protocol));
    }
    std.mem.sort(Value, buckets.items, @as([]const u8, "total"), countOrder);
    std.mem.sort(Value, remotes.items, @as([]const u8, "connections"), countOrder);
    remotes.shrinkRetainingCapacity(@min(12, remotes.items.len));
    for (remotes.items) |*r| {
        const names = m.arr(m.get(r.*, "names"));
        var parts: std.ArrayList([]const u8) = .empty;
        for (names[0..@min(3, names.len)]) |name| try parts.append(a, m.string(name));
        m.ptr(r, "protocols").* = text(try std.mem.join(a, ", ", parts.items));
        _ = r.object.swapRemove("names");
    }
    return object(a, &.{ "protocols", "remotes", "inboundConnections", "outboundConnections" }, &.{ .{ .array = buckets }, .{ .array = remotes }, number(inbound), number(outbound) });
}
fn countOrder(key: []const u8, l: Value, r: Value) bool {
    return m.num(m.get(l, key)) > m.num(m.get(r, key));
}
pub fn sessions(a: A, raw: []const u8) !Value {
    var out = std.json.Array.init(a);
    var lines = std.mem.splitScalar(u8, raw, '\n');
    while (lines.next()) |line| {
        const f = try words(a, line);
        if (f.len < 4) continue;
        var origin: []const u8 = "local";
        if (std.mem.indexOfScalar(u8, line, '(')) |start| {
            if (std.mem.indexOfScalar(u8, line[start + 1 ..], ')')) |end| origin = line[start + 1 .. start + 1 + end];
        }
        try out.append(try object(a, &.{ "user", "tty", "loginAt", "idle", "what", "from" }, &.{ text(f[0]), text(f[1]), text(try std.mem.join(a, " ", f[2..4])), text(if (f.len > 4) f[4] else "."), text(if (f.len > 5) f[5] else ""), text(origin) }));
        if (out.items.len == 1000) break;
    }
    return .{ .array = out };
}
pub fn logins(a: A, raw: []const u8, status: []const u8) !Value {
    var out = std.json.Array.init(a);
    var lines = std.mem.splitScalar(u8, raw, '\n');
    while (lines.next()) |line| {
        const f = try words(a, line);
        if (f.len < 4 or m.eq(f[0], "wtmp") or m.eq(f[0], "btmp") or m.eq(f[0], "reboot")) continue;
        var when = try std.mem.join(a, " ", f[f.len -| 7 .. f.len - 3]);
        if (when.len == 0) when = try std.mem.join(a, " ", f[3..@min(7, f.len)]);
        try out.append(try object(a, &.{ "user", "tty", "from", "when", "status" }, &.{ text(f[0]), text(f[1]), text(if (std.mem.indexOfAny(u8, f[2], ".:") != null) f[2] else "local"), text(when), text(if (std.mem.indexOf(u8, line, "still logged in") != null) "still" else status) }));
        if (out.items.len == 40) break;
    }
    return .{ .array = out };
}
pub fn ssh(a: A, raw: []const u8) !Value {
    var out = std.json.Array.init(a);
    var lines = std.mem.splitScalar(u8, raw, '\n');
    while (lines.next()) |line| {
        if (std.mem.indexOf(u8, line, "sshd") == null) continue;
        const f = try words(a, line);
        for (f, 0..) |word, i| {
            if ((m.eq(word, "Accepted") or m.eq(word, "Failed")) and i + 5 < f.len and m.eq(f[i + 2], "for")) {
                const invalid = i + 7 < f.len and m.eq(f[i + 3], "invalid") and m.eq(f[i + 4], "user");
                const at = i + @as(usize, if (invalid) 5 else 3);
                if (at + 2 >= f.len or !m.eq(f[at + 1], "from")) continue;
                try out.append(try object(a, &.{ "time", "action", "method", "user", "from" }, &.{ text(stamp(line)), text(if (m.eq(word, "Accepted")) "accepted" else if (invalid) "invalid" else "failed"), text(f[i + 1]), text(f[at]), text(f[at + 2]) }));
                break;
            }
            if (m.eq(word, "Disconnected") and i + 4 < f.len and m.eq(f[i + 1], "from")) {
                const at = i + @as(usize, if (m.eq(f[i + 2], "authenticating")) 3 else 2);
                if (at + 2 >= f.len or !m.eq(f[at], "user")) continue;
                try out.append(try object(a, &.{ "time", "action", "user", "from", "method" }, &.{ text(stamp(line)), text("disconnect"), text(f[at + 1]), text(f[at + 2]), text("-") }));
                break;
            }
        }
    }
    if (out.items.len > 40) {
        std.mem.copyForwards(Value, out.items[0..40], out.items[out.items.len - 40 ..]);
        out.shrinkRetainingCapacity(40);
    }
    return .{ .array = out };
}
pub const Tail = struct { raw: []const u8, size: u64, inode: std.Io.File.INode };
pub fn tail(a: A, io: std.Io, path: []const u8) ?Tail {
    const file = std.Io.Dir.cwd().openFile(io, path, .{}) catch return null;
    defer file.close(io);
    const stat = file.stat(io) catch return null;
    const start = stat.size -| 262144;
    const buffer = a.alloc(u8, @intCast(@min(stat.size, 262144))) catch return null;
    const n = file.readPositionalAll(io, buffer, start) catch return null;
    var raw: []const u8 = buffer[0..n];
    if (start > 0) {
        raw = if (std.mem.indexOfScalar(u8, raw, '\n')) |cut| raw[cut + 1 ..] else "";
    }
    return .{ .raw = raw, .size = stat.size, .inode = stat.inode };
}
pub fn httpStats(a: A, raw: []const u8, source: []const u8) !Value {
    var recent = std.json.Array.init(a);
    var counts: [4]std.json.ObjectMap = undefined;
    for (&counts) |*c| c.* = .empty;
    var upgrades: f64 = 0;
    var lines = std.mem.splitScalar(u8, raw, '\n');
    while (lines.next()) |line| {
        const first = std.mem.indexOf(u8, line, " [") orelse continue;
        const after = line[first + 2 ..];
        const second = std.mem.indexOf(u8, after, "] \"") orelse continue;
        const date = after[0..second];
        const rest = after[second + 3 ..];
        const quote = std.mem.indexOf(u8, rest, "\" ") orelse continue;
        const request = try words(a, rest[0..quote]);
        const suffix = try words(a, rest[quote + 2 ..]);
        if (request.len < 2 or suffix.len < 2 or suffix[0].len != 3) continue;
        const status = suffix[0];
        var valid = true;
        for (status) |c| {
            if (!std.ascii.isDigit(c)) valid = false;
        }
        if (!valid) continue;
        const prefix = try words(a, line[0..first]);
        if (prefix.len == 0) continue;
        const client = prefix[0];
        const cut = std.mem.indexOfScalar(u8, request[1], '?') orelse request[1].len;
        var len = @min(60, cut);
        while (len > 0 and len < cut and request[1][len] & 0xc0 == 0x80) len -= 1;
        const path = request[1][0..len];
        const keys = [_][]const u8{ try std.fmt.allocPrint(a, "{c}xx", .{status[0]}), path, client, request[0] };
        for (keys, 0..) |key, i| {
            const old = counts[i].get(key) orelse number(0);
            try counts[i].put(a, key, number(m.num(old) + 1));
        }
        if (m.eq(status, "101")) upgrades += 1;
        try recent.append(try object(a, &.{ "time", "method", "path", "status", "client", "bytes" }, &.{ text(stamp(date)), text(request[0]), text(path), text(status), text(client), number(std.fmt.parseFloat(f64, suffix[1]) catch 0) }));
    }
    const total = recent.items.len;
    std.mem.reverse(Value, recent.items);
    recent.shrinkRetainingCapacity(@min(40, recent.items.len));
    var out = try object(a, &.{ "source", "requestsPerSecond", "total", "upgrades", "recent", "history" }, &.{ text(source), number(0), number(@floatFromInt(total)), number(upgrades), .{ .array = recent }, .{ .array = std.json.Array.init(a) } });
    for ([_][]const u8{ "statusClasses", "topPaths", "topClients", "methods" }, [_][]const u8{ "class", "path", "client", "method" }, [_]usize{ 6, 10, 8, 6 }, 0..) |dest, key, limit, i| {
        var rows = std.json.Array.init(a);
        var iter = counts[i].iterator();
        while (iter.next()) |entry| try rows.append(try object(a, &.{ key, "count" }, &.{ text(entry.key_ptr.*), entry.value_ptr.* }));
        std.mem.sort(Value, rows.items, @as([]const u8, "count"), countOrder);
        rows.shrinkRetainingCapacity(@min(limit, rows.items.len));
        try out.object.put(a, dest, .{ .array = rows });
    }
    return out;
}
pub const HttpCollector = struct {
    source: ?usize = null,
    size: u64 = 0,
    inode: std.Io.File.INode = 0,
    at: f64 = 0,
    history: [240]f64 = [_]f64{0} ** 240,
    count: usize = 0,
    pub fn sample(self: *HttpCollector, a: A, io: std.Io, root: []const u8, now: f64) !Value {
        for ([_][]const u8{ "var/log/nginx/access.log", "var/log/apache2/access.log", "var/log/httpd/access_log", "var/log/caddy/access.log" }, 0..) |candidate, i| {
            const path = try std.fs.path.join(a, &.{ root, candidate });
            const result = tail(a, io, path) orelse continue;
            if (result.raw.len == 0) continue;
            var out = try httpStats(a, result.raw, path);
            var rate: f64 = 0;
            if (self.source == i and self.inode == result.inode and result.size > self.size and now > self.at) {
                const lines = std.mem.count(u8, std.mem.trim(u8, result.raw, "\r\n"), "\n") + 1;
                const average = @as(f64, @floatFromInt(result.raw.len)) / @as(f64, @floatFromInt(lines));
                rate = @as(f64, @floatFromInt(result.size - self.size)) / @max(1, average) / (now - self.at);
            }
            self.source = i;
            self.size = result.size;
            self.inode = result.inode;
            self.at = now;
            if (self.count == 240) {
                std.mem.copyForwards(f64, self.history[0..239], self.history[1..240]);
                self.count = 239;
            }
            self.history[self.count] = rate;
            self.count += 1;
            m.ptr(&out, "requestsPerSecond").* = number(rate);
            for (self.history[0..self.count]) |v| try m.ptr(&out, "history").array.append(number(v));
            return out;
        }
        self.* = .{};
        return .null;
    }
};
