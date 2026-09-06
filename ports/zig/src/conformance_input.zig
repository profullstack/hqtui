//! Conformance for the input parser: the same byte chunks, in the same order,
//! must decode to the same events — including the awkward cases where a
//! sequence or a bracketed-paste end marker straddles two reads.
//!
//! Events are compared as rendered strings rather than field by field. A
//! mismatch then prints both sides in full, which is the difference between
//! "event 3 differs" and seeing that `alt` was set when it should not be.

const std = @import("std");

const conformance = @import("conformance.zig");
const input = @import("input.zig");

const Json = std.json.Value;

fn describeEvent(out: *std.ArrayList(u8), alloc: std.mem.Allocator, e: input.InputEvent) !void {
    switch (e) {
        .key => |k| {
            try out.print(alloc, "key name={s} key={s} ctrl={} alt={} shift={} char=", .{
                k.name, k.key, k.ctrl, k.alt, k.shift,
            });
            if (k.char) |c| {
                try out.print(alloc, "\"{s}\"", .{c});
            } else {
                try out.appendSlice(alloc, "none");
            }
            try out.print(alloc, " raw={f}", .{quoted(k.raw)});
        },
        .mouse => |m| try out.print(
            alloc,
            "mouse action={s} button={s} x={d} y={d} scroll={d} ctrl={} alt={} shift={}",
            .{
                m.action.toString(), m.button.toString(), m.x, m.y,
                m.scroll,            m.ctrl,              m.alt, m.shift,
            },
        ),
        .paste => |text| try out.print(alloc, "paste text={f}", .{quoted(text)}),
        .focus => |focused| try out.print(alloc, "focus focused={}", .{focused}),
    }
}

fn describeFixtureEvent(out: *std.ArrayList(u8), alloc: std.mem.Allocator, v: Json) !void {
    const get = conformance.getOf;
    const str = conformance.strOf;
    const kind = str(get(v, "type"));

    if (std.mem.eql(u8, kind, "key")) {
        try out.print(alloc, "key name={s} key={s} ctrl={} alt={} shift={} char=", .{
            str(get(v, "name")),         str(get(v, "key")),
            conformance.boolOf(get(v, "ctrl")), conformance.boolOf(get(v, "alt")),
            conformance.boolOf(get(v, "shift")),
        });
        // `JSON.stringify` drops an undefined `char` entirely, so presence —
        // not emptiness — is what distinguishes a printable key.
        if (conformance.hasOf(v, "char")) {
            try out.print(alloc, "\"{s}\"", .{str(get(v, "char"))});
        } else {
            try out.appendSlice(alloc, "none");
        }
        try out.print(alloc, " raw={f}", .{quoted(str(get(v, "raw")))});
    } else if (std.mem.eql(u8, kind, "mouse")) {
        try out.print(
            alloc,
            "mouse action={s} button={s} x={d} y={d} scroll={d} ctrl={} alt={} shift={}",
            .{
                str(get(v, "action")),
                str(get(v, "button")),
                conformance.uszOf(get(v, "x")),
                conformance.uszOf(get(v, "y")),
                conformance.i64Of(get(v, "scroll")),
                conformance.boolOf(get(v, "ctrl")),
                conformance.boolOf(get(v, "alt")),
                conformance.boolOf(get(v, "shift")),
            },
        );
    } else if (std.mem.eql(u8, kind, "paste")) {
        try out.print(alloc, "paste text={f}", .{quoted(str(get(v, "text")))});
    } else if (std.mem.eql(u8, kind, "focus")) {
        try out.print(alloc, "focus focused={}", .{conformance.boolOf(get(v, "focused"))});
    } else {
        std.debug.print("unknown event type {s}\n", .{kind});
        return error.TestUnexpectedResult;
    }
}

/// `"…"` with the control characters that fill this corpus made visible.
/// Comparing raw escape bytes as-is turns a diff into a terminal reset.
const Quoted = struct {
    text: []const u8,

    pub fn format(self: Quoted, writer: *std.Io.Writer) std.Io.Writer.Error!void {
        try writer.writeByte('"');
        for (self.text) |c| switch (c) {
            '"' => try writer.writeAll("\\\""),
            '\\' => try writer.writeAll("\\\\"),
            '\n' => try writer.writeAll("\\n"),
            '\r' => try writer.writeAll("\\r"),
            '\t' => try writer.writeAll("\\t"),
            else => if (c < 0x20 or c == 0x7f)
                try writer.print("\\x{x:0>2}", .{c})
            else
                try writer.writeByte(c),
        };
        try writer.writeByte('"');
    }
};

fn quoted(text: []const u8) Quoted {
    return .{ .text = text };
}

test "input matches reference" {
    const allocator = std.testing.allocator;
    const parsed = try conformance.fixtureFor(allocator, "input");
    defer parsed.deinit();

    const cases = conformance.arrOf(parsed.value);
    try std.testing.expect(cases.len > 0);

    var events_total: usize = 0;
    for (cases) |case| {
        const name = conformance.strOf(conformance.getOf(case, "name"));

        var parser = input.InputParser.init(allocator);
        defer parser.deinit();

        // Event text is owned by the parser and only lives until its next call,
        // so each batch is rendered to a string before the next chunk is fed.
        var got: std.ArrayList([]u8) = .empty;
        defer {
            for (got.items) |line| allocator.free(line);
            got.deinit(allocator);
        }

        for (conformance.arrOf(conformance.getOf(case, "chunks"))) |chunk| {
            for (try parser.parse(conformance.strOf(chunk))) |event| {
                var line: std.ArrayList(u8) = .empty;
                errdefer line.deinit(allocator);
                try describeEvent(&line, allocator, event);
                try got.append(allocator, try line.toOwnedSlice(allocator));
            }
        }
        if (conformance.boolOf(conformance.getOf(case, "flush"))) {
            for (try parser.flush()) |event| {
                var line: std.ArrayList(u8) = .empty;
                errdefer line.deinit(allocator);
                try describeEvent(&line, allocator, event);
                try got.append(allocator, try line.toOwnedSlice(allocator));
            }
        }

        const want = conformance.arrOf(conformance.getOf(case, "events"));
        events_total += want.len;

        if (got.items.len != want.len) {
            std.debug.print("{s}: {d} events, want {d}\n", .{ name, got.items.len, want.len });
            for (got.items) |line| std.debug.print("  got  {s}\n", .{line});
            for (want) |v| {
                var line: std.ArrayList(u8) = .empty;
                defer line.deinit(allocator);
                try describeFixtureEvent(&line, allocator, v);
                std.debug.print("  want {s}\n", .{line.items});
            }
            return error.TestUnexpectedResult;
        }

        for (want, 0..) |v, k| {
            var line: std.ArrayList(u8) = .empty;
            defer line.deinit(allocator);
            try describeFixtureEvent(&line, allocator, v);
            if (!std.mem.eql(u8, got.items[k], line.items)) {
                std.debug.print("{s}: event {d}\n got {s}\nwant {s}\n", .{
                    name, k, got.items[k], line.items,
                });
                return error.TestUnexpectedResult;
            }
        }

        const pending = conformance.boolOf(conformance.getOf(case, "pending"));
        if (parser.hasPending() != pending) {
            std.debug.print("{s}: pending {}, want {}\n", .{ name, parser.hasPending(), pending });
            return error.TestUnexpectedResult;
        }
    }
    std.debug.print("\n  {d} input scenes, {d} events compared\n", .{ cases.len, events_total });
}
