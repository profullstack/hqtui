//! Replays the shared conformance fixtures, which are generated from the
//! TypeScript reference implementation.
//!
//! A failure here means this port and the reference disagree about something
//! observable — which is a bug in one of them, never an acceptable difference.
//!
//! Regenerate the fixtures with `bun ports/conformance/generate.ts`.

const std = @import("std");
const build_options = @import("build_options");

const ansi = @import("ansi.zig");
const buffer_mod = @import("buffer.zig");
const capabilities = @import("capabilities.zig");
const color_mod = @import("color.zig");
const diff = @import("diff.zig");
const graphics = @import("graphics.zig");
const layout = @import("layout.zig");
const surface_mod = @import("surface.zig");
const theme_mod = @import("theme.zig");
const unicode = @import("unicode.zig");

const Attrs = buffer_mod.Attrs;
const Color = color_mod.Color;
const FrameBuffer = buffer_mod.FrameBuffer;
const Style = buffer_mod.Style;

const Json = std.json.Value;

// The four accessors below are `pub` so the widget and screen suites, which live
// in their own files, can share this one JSON walker. The short names are what
// the assertions in this file read as.
const get = getOf;
const arr = arrOf;
const str = strOf;
const usz = uszOf;

/// Read and parse one golden file. The caller owns the returned tree.
///
/// Zig 0.16 routes file access through an explicit `Io` handle rather than a
/// global, so the suite makes one for the read and tears it down again.
pub fn fixtureFor(allocator: std.mem.Allocator, name: []const u8) !std.json.Parsed(Json) {
    const file_name = try std.fmt.allocPrint(allocator, "{s}.json", .{name});
    defer allocator.free(file_name);
    const path = try std.fs.path.join(allocator, &.{ build_options.fixtures, file_name });
    defer allocator.free(path);

    var threaded: std.Io.Threaded = .init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();

    const text = try std.Io.Dir.cwd().readFileAlloc(io, path, allocator, .unlimited);
    defer allocator.free(text);

    return std.json.parseFromSlice(Json, allocator, text, .{});
}

// ------------------------------------------------------------------ accessors
//
// The corpus is heterogeneous by design, so it is walked as a JSON tree rather
// than decoded into a struct per group — which would be more code than the
// assertions it serves.

pub fn getOf(v: Json, key: []const u8) Json {
    return switch (v) {
        .object => |o| o.get(key) orelse .null,
        else => .null,
    };
}

pub fn arrOf(v: Json) []Json {
    return switch (v) {
        .array => |a| a.items,
        else => &.{},
    };
}

fn num(v: Json) f64 {
    return switch (v) {
        .float => |f| f,
        .integer => |i| @floatFromInt(i),
        else => std.math.nan(f64),
    };
}

fn int(v: Json) i64 {
    return switch (v) {
        .integer => |i| i,
        .float => |f| @intFromFloat(f),
        else => 0,
    };
}

pub fn uszOf(v: Json) usize {
    return @intCast(@max(0, int(v)));
}

fn u32v(v: Json) u32 {
    return @truncate(@as(u64, @bitCast(int(v))));
}

pub fn strOf(v: Json) []const u8 {
    return switch (v) {
        .string => |s| s,
        else => "",
    };
}

pub fn i64Of(v: Json) i64 {
    return int(v);
}

pub fn boolOf(v: Json) bool {
    return boolean(v);
}

/// Whether a key is present at all — not the same as its value being falsy.
/// `JSON.stringify` drops an undefined field entirely, so the input fixtures
/// distinguish "no char" from "char is empty" only by presence.
pub fn hasOf(v: Json, key: []const u8) bool {
    return present(v, key);
}

fn boolean(v: Json) bool {
    return switch (v) {
        .bool => |b| b,
        else => false,
    };
}

fn present(v: Json, key: []const u8) bool {
    return get(v, key) != .null;
}

fn colorOf(v: Json) Color {
    return Color.fromRaw(u32v(v));
}

fn optColor(v: Json, key: []const u8) ?Color {
    return if (present(v, key)) colorOf(get(v, key)) else null;
}

fn optUsize(v: Json, key: []const u8) ?usize {
    return if (present(v, key)) usz(get(v, key)) else null;
}

fn approx(got: f64, want: f64, what: []const u8) !void {
    if (std.math.isNan(got) and std.math.isNan(want)) return;
    if (@abs(got - want) > 1e-9) {
        std.debug.print("{s}: {d} != {d}\n", .{ what, got, want });
        return error.TestUnexpectedResult;
    }
}

fn rectOf(v: Json) layout.Rect {
    return .{
        .x = @intCast(int(get(v, "x"))),
        .y = @intCast(int(get(v, "y"))),
        .width = usz(get(v, "width")),
        .height = usz(get(v, "height")),
    };
}

// ---------------------------------------------------------------------- color

test "color matches reference" {
    const allocator = std.testing.allocator;
    const parsed = try fixtureFor(allocator, "color");
    defer parsed.deinit();
    const f = parsed.value;

    for (arr(get(f, "hex"))) |c| {
        try std.testing.expectEqual(u32v(get(c, "color")), Color.hexStr(str(get(c, "input"))).raw());
    }
    for (arr(get(f, "hexNumber"))) |c| {
        try std.testing.expectEqual(u32v(get(c, "color")), Color.hex(u32v(get(c, "input"))).raw());
    }
    for (arr(get(f, "rgb"))) |c| {
        // The reference masks components with `& 255`; the port takes u8, so
        // the fixture's out-of-range values are masked here the same way.
        const r: u8 = @truncate(@as(u64, @bitCast(int(get(c, "r")))));
        const g: u8 = @truncate(@as(u64, @bitCast(int(get(c, "g")))));
        const b: u8 = @truncate(@as(u64, @bitCast(int(get(c, "b")))));
        try std.testing.expectEqual(u32v(get(c, "color")), Color.rgb(r, g, b).raw());
    }
    for (arr(get(f, "ansi256"))) |c| {
        const i: u8 = @intCast(int(get(c, "index")));
        try std.testing.expectEqual(u32v(get(c, "color")), Color.ansi256(i).raw());
    }
    try std.testing.expectEqual(u32v(get(f, "defaultColor")), Color.default.raw());

    for ([_]Json{ get(f, "mix"), get(f, "mixDefault") }) |group| {
        for (arr(group)) |c| {
            const got = colorOf(get(c, "a")).mix(colorOf(get(c, "b")), num(get(c, "t")));
            try std.testing.expectEqual(u32v(get(c, "out")), got.raw());
        }
    }
    for (arr(get(f, "alpha"))) |c| {
        const got = colorOf(get(c, "fg")).alpha(colorOf(get(c, "bg")), num(get(c, "a")));
        try std.testing.expectEqual(u32v(get(c, "out")), got.raw());
    }
    for (arr(get(f, "lighten"))) |c| {
        const got = colorOf(get(c, "c")).lighten(num(get(c, "amount")));
        try std.testing.expectEqual(u32v(get(c, "out")), got.raw());
    }
    for (arr(get(f, "darken"))) |c| {
        const got = colorOf(get(c, "c")).darken(num(get(c, "amount")));
        try std.testing.expectEqual(u32v(get(c, "out")), got.raw());
    }
    for (arr(get(f, "luminance"))) |c| {
        try approx(colorOf(get(c, "c")).luminance(), num(get(c, "out")), "luminance");
    }
    for (arr(get(f, "contrast"))) |c| {
        const got = colorOf(get(c, "a")).contrast(colorOf(get(c, "b")));
        try approx(got, num(get(c, "out")), "contrast");
    }
    for (arr(get(f, "grayscale"))) |c| {
        try std.testing.expectEqual(u32v(get(c, "out")), colorOf(get(c, "c")).grayscale().raw());
    }
    try std.testing.expectEqual(
        u32v(get(f, "grayscaleDefault")),
        Color.default.grayscale().raw(),
    );

    for (arr(get(f, "to256"))) |c| {
        try std.testing.expectEqual(
            @as(u8, @intCast(int(get(c, "out")))),
            colorOf(get(c, "c")).to256(),
        );
    }
    for (arr(get(f, "to16"))) |c| {
        try std.testing.expectEqual(
            @as(u8, @intCast(int(get(c, "out")))),
            colorOf(get(c, "c")).to16(),
        );
    }
    for (arr(get(f, "from256"))) |c| {
        const i: u8 = @intCast(int(get(c, "index")));
        try std.testing.expectEqual(u32v(get(c, "out")), color_mod.from256(i).raw());
    }

    const g = get(f, "gradient");
    const stop_values = arr(get(g, "stops"));
    const stops = try allocator.alloc(Color, stop_values.len);
    defer allocator.free(stops);
    for (stop_values, 0..) |s, i| stops[i] = colorOf(s);

    const gradient = color_mod.Gradient.init(stops);
    for (arr(get(g, "samples"))) |s| {
        try std.testing.expectEqual(u32v(get(s, "out")), gradient.sample(num(get(s, "t"))).raw());
    }
    const want_steps = arr(get(g, "steps"));
    const steps = try allocator.alloc(Color, want_steps.len);
    defer allocator.free(steps);
    gradient.steps(steps);
    for (want_steps, 0..) |want, i| {
        try std.testing.expectEqual(u32v(want), steps[i].raw());
    }

    const one = [_]Color{Color.hex(0xff0000)};
    try std.testing.expectEqual(
        u32v(get(g, "single")),
        color_mod.Gradient.init(&one).sample(0.5).raw(),
    );
    try std.testing.expectEqual(
        u32v(get(g, "empty")),
        color_mod.Gradient.init(&.{}).sample(0.5).raw(),
    );
}

// -------------------------------------------------------------------- unicode

test "unicode matches reference" {
    const allocator = std.testing.allocator;
    const parsed = try fixtureFor(allocator, "unicode");
    defer parsed.deinit();
    const f = parsed.value;

    for (arr(get(f, "charWidth"))) |c| {
        const cp: u32 = @intCast(int(get(c, "cp")));
        try std.testing.expectEqual(usz(get(c, "width")), unicode.charWidth(cp));
    }
    for (arr(get(f, "stringWidth"))) |c| {
        try std.testing.expectEqual(usz(get(c, "width")), unicode.stringWidth(str(get(c, "s"))));
    }
    for (arr(get(f, "truncate"))) |c| {
        var buf: [512]u8 = undefined;
        const got = unicode.truncate(&buf, str(get(c, "s")), usz(get(c, "max")));
        try std.testing.expectEqualStrings(str(get(c, "out")), got);
    }
    for (arr(get(f, "truncateCustomEllipsis"))) |c| {
        var buf: [512]u8 = undefined;
        const got = unicode.truncateInto(
            &buf,
            str(get(c, "s")),
            usz(get(c, "max")),
            str(get(c, "ellipsis")),
        );
        try std.testing.expectEqualStrings(str(get(c, "out")), got);
    }
    for (arr(get(f, "fit"))) |c| {
        var buf: [512]u8 = undefined;
        const got = unicode.fit(
            &buf,
            str(get(c, "s")),
            usz(get(c, "w")),
            unicode.Align.parse(str(get(c, "align"))),
        );
        try std.testing.expectEqualStrings(str(get(c, "out")), got);
    }
    for (arr(get(f, "wrap"))) |c| {
        const lines = try unicode.wrap(allocator, str(get(c, "s")), usz(get(c, "width")));
        defer unicode.freeWrapped(allocator, lines);
        const want = arr(get(c, "out"));
        try std.testing.expectEqual(want.len, lines.len);
        for (want, 0..) |wanted, i| {
            try std.testing.expectEqualStrings(str(wanted), lines[i]);
        }
        try std.testing.expectEqual(
            want.len,
            unicode.wrapCount(str(get(c, "s")), usz(get(c, "width"))),
        );
    }
    for (arr(get(f, "stripUnsafe"))) |c| {
        const got = try unicode.stripUnsafeAlloc(allocator, str(get(c, "s")));
        defer allocator.free(got);
        try std.testing.expectEqualStrings(str(get(c, "out")), got);
    }
    for (arr(get(f, "graphemes"))) |c| {
        var it = unicode.graphemes(str(get(c, "s")));
        const want = arr(get(c, "cells"));
        var i: usize = 0;
        while (it.next()) |cell| : (i += 1) {
            try std.testing.expect(i < want.len);
            try std.testing.expectEqual(usz(get(want[i], "width")), cell.width);
            try std.testing.expectEqual(
                boolean(get(want[i], "cluster")),
                cell.value >= unicode.cluster_base,
            );
            var buf: [4]u8 = undefined;
            try std.testing.expectEqualStrings(
                str(get(want[i], "text")),
                unicode.cellText(cell.value, &buf),
            );
        }
        try std.testing.expectEqual(want.len, i);
    }

    const constants = get(f, "constants");
    try std.testing.expectEqual(u32v(get(constants, "clusterBase")), unicode.cluster_base);
    try std.testing.expectEqual(u32v(get(constants, "continuation")), unicode.continuation);
}

// ----------------------------------------------------------------------- ansi

test "ansi matches reference" {
    const allocator = std.testing.allocator;
    const parsed = try fixtureFor(allocator, "ansi");
    defer parsed.deinit();
    const f = parsed.value;

    for (arr(get(f, "stripAnsi"))) |c| {
        const got = try ansi.stripAnsi(allocator, str(get(c, "s")));
        defer allocator.free(got);
        try std.testing.expectEqualStrings(str(get(c, "out")), got);
    }
    for (arr(get(f, "moveTo"))) |c| {
        var out: std.ArrayList(u8) = .empty;
        defer out.deinit(allocator);
        try ansi.moveTo(&out, allocator, usz(get(c, "x")), usz(get(c, "y")));
        try std.testing.expectEqualStrings(str(get(c, "out")), out.items);
    }
    for (arr(get(f, "setTitle"))) |c| {
        const got = try ansi.setTitle(allocator, str(get(c, "title")));
        defer allocator.free(got);
        try std.testing.expectEqualStrings(str(get(c, "out")), got);
    }
}

// --------------------------------------------------------------------- layout

fn constraintOf(v: Json) layout.Constraint {
    const size: ?layout.Size = switch (get(v, "size")) {
        .integer => |i| .{ .cells = i },
        .float => |x| .{ .cells = @intFromFloat(x) },
        .string => |s| layout.Size.parse(s),
        else => null,
    };
    return .{
        .size = size,
        .min = optUsize(v, "min"),
        .max = optUsize(v, "max"),
        .intrinsic = optUsize(v, "intrinsic"),
    };
}

test "layout matches reference" {
    const allocator = std.testing.allocator;
    const parsed = try fixtureFor(allocator, "layout");
    defer parsed.deinit();
    const f = parsed.value;

    for (arr(get(f, "solve"))) |c| {
        const items = arr(get(c, "items"));
        const constraints = try allocator.alloc(layout.Constraint, items.len);
        defer allocator.free(constraints);
        for (items, 0..) |item, i| constraints[i] = constraintOf(item);

        const got = try layout.solve(allocator, usz(get(c, "total")), constraints, usz(get(c, "gap")));
        defer allocator.free(got);
        const want = arr(get(c, "out"));
        try std.testing.expectEqual(want.len, got.len);
        for (want, 0..) |wanted, i| {
            try std.testing.expectEqual(usz(wanted), got[i]);
        }
    }

    for (arr(get(f, "stack"))) |c| {
        const items = arr(get(c, "items"));
        const constraints = try allocator.alloc(layout.Constraint, items.len);
        defer allocator.free(constraints);
        for (items, 0..) |item, i| constraints[i] = constraintOf(item);

        const direction: layout.Direction =
            if (std.mem.eql(u8, str(get(c, "direction")), "row")) .row else .column;
        const got = try layout.stack(
            allocator,
            rectOf(get(c, "rect")),
            constraints,
            direction,
            usz(get(c, "gap")),
        );
        defer allocator.free(got);
        for (arr(get(c, "out")), 0..) |wanted, i| {
            try std.testing.expectEqual(rectOf(wanted), got[i]);
        }
    }

    for (arr(get(f, "inset"))) |c| {
        const raw = get(c, "padding");
        const padding: layout.Padding = switch (raw) {
            .integer, .float => layout.Padding.all(usz(raw)),
            .array => |a| if (a.items.len == 2)
                layout.Padding.axes(usz(a.items[0]), usz(a.items[1]))
            else
                .{
                    .top = usz(a.items[0]),
                    .right = usz(a.items[1]),
                    .bottom = usz(a.items[2]),
                    .left = usz(a.items[3]),
                },
            else => unreachable,
        };
        try std.testing.expectEqual(
            rectOf(get(c, "out")),
            rectOf(get(c, "rect")).inset(padding),
        );
    }

    for (arr(get(f, "intersect"))) |c| {
        try std.testing.expectEqual(
            rectOf(get(c, "out")),
            rectOf(get(c, "a")).intersect(rectOf(get(c, "b"))),
        );
    }
}

// --------------------------------------------------------------------- buffer

fn styleOf(op: Json) Style {
    return .{
        .fg = optColor(op, "fg"),
        .bg = optColor(op, "bg"),
        .attrs = if (present(op, "attrs"))
            Attrs.fromBits(@intCast(int(get(op, "attrs"))))
        else
            null,
    };
}

fn applyOps(fb: *FrameBuffer, ops: []Json) void {
    for (ops) |op| {
        const style = styleOf(op);
        const kind = str(get(op, "op"));
        const x: isize = @intCast(int(get(op, "x")));
        const y: isize = @intCast(int(get(op, "y")));
        if (std.mem.eql(u8, kind, "write")) {
            const max = optUsize(op, "maxWidth") orelse std.math.maxInt(usize);
            _ = fb.writeCapped(x, y, str(get(op, "text")), style, max);
        } else if (std.mem.eql(u8, kind, "setCell")) {
            _ = fb.setCell(x, y, u32v(get(op, "value")), style);
        } else if (std.mem.eql(u8, kind, "fillRect")) {
            fb.fillRect(x, y, usz(get(op, "w")), usz(get(op, "h")), u32v(get(op, "ch")), style);
        } else if (std.mem.eql(u8, kind, "styleRect")) {
            fb.styleRect(x, y, usz(get(op, "w")), usz(get(op, "h")), style);
        } else if (std.mem.eql(u8, kind, "clear")) {
            fb.clear(optColor(op, "bg") orelse .default, optColor(op, "fg") orelse .default);
        }
    }
}

/// Expand a run-length encoded plane, `[[count, value], …]`.
fn decodeRle(allocator: std.mem.Allocator, plane: Json) ![]u32 {
    var out: std.ArrayList(u32) = .empty;
    errdefer out.deinit(allocator);
    for (arr(plane)) |run| {
        const pair = arr(run);
        const count = usz(pair[0]);
        const value = u32v(pair[1]);
        try out.appendNTimes(allocator, value, count);
    }
    return out.toOwnedSlice(allocator);
}

/// Compare a rendered buffer against a fixture's run-length encoded planes.
pub fn assertBuffer(
    allocator: std.mem.Allocator,
    fb: *const FrameBuffer,
    want: Json,
    what: []const u8,
) !void {
    try std.testing.expectEqual(usz(get(want, "width")), fb.width);
    try std.testing.expectEqual(usz(get(want, "height")), fb.height);

    const n = fb.width * fb.height;
    const chars = try decodeRle(allocator, get(want, "chars"));
    defer allocator.free(chars);
    const fg = try decodeRle(allocator, get(want, "fg"));
    defer allocator.free(fg);
    const bg = try decodeRle(allocator, get(want, "bg"));
    defer allocator.free(bg);
    const attrs = try decodeRle(allocator, get(want, "attrs"));
    defer allocator.free(attrs);
    try std.testing.expectEqual(n, chars.len);

    // Text first: when a port drifts, the row text says *what* is wrong in one
    // line, where a cell index only says where.
    const want_text = arr(get(want, "text"));
    for (0..fb.height) |y| {
        const row = try fb.rowTextAlloc(allocator, y);
        defer allocator.free(row);
        if (!std.mem.eql(u8, row, str(want_text[y]))) {
            std.debug.print("{s}: row {d}\n got  {s}\n want {s}\n", .{
                what, y, row, str(want_text[y]),
            });
            return error.TestUnexpectedResult;
        }
    }

    // A cluster's cell value indexes the interning process's own table, so the
    // fixture renumbers them by first appearance. Rebuild the same numbering
    // here, and check the cluster texts line up too.
    var local: std.ArrayList(u32) = .empty;
    defer local.deinit(allocator);

    for (0..n) |i| {
        var value = fb.chars[i];
        if (value >= unicode.cluster_base and value != unicode.continuation) {
            const found = std.mem.indexOfScalar(u32, local.items, value) orelse blk: {
                try local.append(allocator, value);
                break :blk local.items.len - 1;
            };
            value = unicode.cluster_base + @as(u32, @intCast(found));
        }
        if (value != chars[i] or
            fb.fg[i].raw() != fg[i] or
            fb.bg[i].raw() != bg[i] or
            @as(u32, fb.attrs[i].bits()) != attrs[i])
        {
            std.debug.print("{s}: cell at {d},{d}: char {d}/{d} fg {d}/{d} bg {d}/{d} attrs {d}/{d}\n", .{
                what,        i % fb.width, i / fb.width,
                value,       chars[i],     fb.fg[i].raw(),
                fg[i],       fb.bg[i].raw(), bg[i],
                fb.attrs[i].bits(), attrs[i],
            });
            return error.TestUnexpectedResult;
        }
    }

    const want_clusters = arr(get(want, "clusters"));
    try std.testing.expectEqual(want_clusters.len, local.items.len);
    for (local.items, 0..) |value, i| {
        var buf: [4]u8 = undefined;
        try std.testing.expectEqualStrings(
            str(want_clusters[i]),
            unicode.cellText(value, &buf),
        );
    }
}

test "buffer matches reference" {
    const allocator = std.testing.allocator;
    const parsed = try fixtureFor(allocator, "buffer");
    defer parsed.deinit();

    for (arr(parsed.value)) |case| {
        var fb = try FrameBuffer.init(allocator, usz(get(case, "width")), usz(get(case, "height")));
        defer fb.deinit();
        applyOps(&fb, arr(get(case, "ops")));
        try assertBuffer(allocator, &fb, get(case, "result"), str(get(case, "name")));
    }
}

// ----------------------------------------------------------------------- diff

test "diff matches reference" {
    const allocator = std.testing.allocator;
    const parsed = try fixtureFor(allocator, "diff");
    defer parsed.deinit();

    for (arr(parsed.value)) |case| {
        const name = str(get(case, "name"));
        const w = usz(get(case, "width"));
        const h = usz(get(case, "height"));

        var prev = try FrameBuffer.init(allocator, w, h);
        defer prev.deinit();
        var next = try FrameBuffer.init(allocator, w, h);
        defer next.deinit();
        applyOps(&prev, arr(get(case, "before")));
        applyOps(&next, arr(get(case, "after")));

        var encoder = diff.Encoder.init(allocator, .{
            .colors = capabilities.ColorDepth.parse(str(get(case, "colors"))) orelse .truecolor,
            .monochrome = boolean(get(case, "monochrome")),
        });
        defer encoder.deinit();

        const got = try encoder.encode(&prev, &next, boolean(get(case, "full")));
        const want = get(case, "result");

        if (!std.mem.eql(u8, got.output, str(get(want, "output")))) {
            std.debug.print("{s}: output\n got  {s}\n want {s}\n", .{
                name, got.output, str(get(want, "output")),
            });
            return error.TestUnexpectedResult;
        }
        try std.testing.expectEqual(usz(get(want, "changedCells")), got.changed_cells);
        try std.testing.expectEqual(usz(get(want, "dirtyRows")), got.dirty_rows);
    }
}

// ---------------------------------------------------------------------- theme

test "theme matches reference" {
    const allocator = std.testing.allocator;
    const parsed = try fixtureFor(allocator, "theme");
    defer parsed.deinit();
    const f = parsed.value;

    for (arr(get(f, "themes"))) |entry| {
        const key = str(get(entry, "key"));
        const want = get(entry, "theme");
        const t = theme_mod.resolve(key);

        try std.testing.expectEqualStrings(str(get(want, "name")), t.name);
        try std.testing.expectEqual(boolean(get(want, "dark")), t.dark);

        const fields = [_]struct { name: []const u8, value: Color }{
            .{ .name = "background", .value = t.background },
            .{ .name = "surface", .value = t.surface },
            .{ .name = "foreground", .value = t.foreground },
            .{ .name = "muted", .value = t.muted },
            .{ .name = "primary", .value = t.primary },
            .{ .name = "secondary", .value = t.secondary },
            .{ .name = "accent", .value = t.accent },
            .{ .name = "success", .value = t.success },
            .{ .name = "warning", .value = t.warning },
            .{ .name = "danger", .value = t.danger },
            .{ .name = "info", .value = t.info },
            .{ .name = "border", .value = t.border },
            .{ .name = "borderFocused", .value = t.border_focused },
            .{ .name = "title", .value = t.title },
            .{ .name = "selection", .value = t.selection },
            .{ .name = "selectionText", .value = t.selection_text },
            .{ .name = "cursor", .value = t.cursor },
        };
        for (fields) |field| {
            try std.testing.expectEqual(u32v(get(want, field.name)), field.value.raw());
        }
        for (arr(get(want, "graph")), 0..) |c, i| {
            try std.testing.expectEqual(u32v(c), t.graph[i].raw());
        }
        for (arr(get(want, "heat")), 0..) |c, i| {
            try std.testing.expectEqual(u32v(c), t.heat[i].raw());
        }
    }

    for (arr(get(f, "resolve"))) |c| {
        try std.testing.expectEqualStrings(
            str(get(c, "resolved")),
            theme_mod.resolve(str(get(c, "name"))).name,
        );
    }
    for (arr(get(f, "elevate"))) |c| {
        const t = theme_mod.resolve(str(get(c, "theme")));
        try std.testing.expectEqual(
            u32v(get(c, "out")),
            theme_mod.elevate(t, num(get(c, "amount"))).raw(),
        );
    }
    for (arr(get(f, "heatColor"))) |c| {
        const t = theme_mod.resolve(str(get(c, "theme")));
        try std.testing.expectEqual(
            u32v(get(c, "out")),
            theme_mod.heatColor(t, num(get(c, "ratio"))).raw(),
        );
    }
    for (arr(get(f, "seriesColor"))) |c| {
        const t = theme_mod.resolve(str(get(c, "theme")));
        try std.testing.expectEqual(
            u32v(get(c, "out")),
            theme_mod.seriesColor(t, int(get(c, "index"))).raw(),
        );
    }
}

// -------------------------------------------------------------------- surface

test "surface box matches reference" {
    const allocator = std.testing.allocator;
    const parsed = try fixtureFor(allocator, "surface");
    defer parsed.deinit();

    for (arr(parsed.value)) |case| {
        const name = str(get(case, "name"));
        const t = theme_mod.resolve(str(get(case, "theme")));
        var fb = try FrameBuffer.init(allocator, usz(get(case, "width")), usz(get(case, "height")));
        defer fb.deinit();
        fb.clear(t.background, t.foreground);

        const s = surface_mod.Surface.root(&fb, &t);
        const spec = get(case, "box");
        const inner = s.box(.{
            .title = str(get(spec, "title")),
            .subtitle = str(get(spec, "subtitle")),
            .footer = str(get(spec, "footer")),
            .border = if (present(spec, "border"))
                surface_mod.BorderStyle.parse(str(get(spec, "border")))
            else
                .rounded,
            .title_align = if (present(spec, "titleAlign"))
                unicode.Align.parse(str(get(spec, "titleAlign")))
            else
                .left,
        });

        try std.testing.expectEqual(rectOf(get(case, "innerRect")), inner.rect);
        try assertBuffer(allocator, &fb, get(case, "result"), name);
    }
}

// ------------------------------------------------------------------- graphics

test "braille matches reference" {
    const allocator = std.testing.allocator;
    const parsed = try fixtureFor(allocator, "braille");
    defer parsed.deinit();

    for (arr(parsed.value)) |case| {
        const name = str(get(case, "name"));
        var canvas = try graphics.BrailleCanvas.init(
            allocator,
            usz(get(case, "cols")),
            usz(get(case, "rows")),
        );
        defer canvas.deinit();

        for (arr(get(case, "ops"))) |op| {
            const kind = str(get(op, "op"));
            const raw_points = arr(get(op, "points"));
            const points = try allocator.alloc(graphics.Point, raw_points.len);
            defer allocator.free(points);
            for (raw_points, 0..) |pt, i| {
                const pair = arr(pt);
                points[i] = .{ .x = num(pair[0]), .y = num(pair[1]) };
            }

            if (std.mem.eql(u8, kind, "pixel")) {
                canvas.pixel(num(get(op, "x")), num(get(op, "y")));
            } else if (std.mem.eql(u8, kind, "unset")) {
                canvas.unset(num(get(op, "x")), num(get(op, "y")));
            } else if (std.mem.eql(u8, kind, "line")) {
                canvas.line(num(get(op, "x0")), num(get(op, "y0")), num(get(op, "x1")), num(get(op, "y1")));
            } else if (std.mem.eql(u8, kind, "hline")) {
                canvas.hline(num(get(op, "y")), num(get(op, "x0")), num(get(op, "x1")));
            } else if (std.mem.eql(u8, kind, "vline")) {
                canvas.vline(num(get(op, "x")), num(get(op, "y0")), num(get(op, "y1")));
            } else if (std.mem.eql(u8, kind, "rect")) {
                canvas.rect(num(get(op, "x0")), num(get(op, "y0")), num(get(op, "x1")), num(get(op, "y1")));
            } else if (std.mem.eql(u8, kind, "fillRect")) {
                canvas.fillRect(num(get(op, "x0")), num(get(op, "y0")), num(get(op, "x1")), num(get(op, "y1")));
            } else if (std.mem.eql(u8, kind, "circle")) {
                canvas.circle(num(get(op, "cx")), num(get(op, "cy")), num(get(op, "r")));
            } else if (std.mem.eql(u8, kind, "polyline")) {
                canvas.polyline(points);
            } else if (std.mem.eql(u8, kind, "fillUnder")) {
                canvas.fillUnder(points, num(get(op, "baseline")));
            } else {
                std.debug.print("unknown braille op {s}\n", .{kind});
                return error.TestUnexpectedResult;
            }
        }

        const want_cells = arr(get(case, "cells"));
        var k: usize = 0;
        for (0..canvas.rows) |row| {
            for (0..canvas.cols) |col| {
                if (canvas.cell(col, row) != u32v(want_cells[k])) {
                    std.debug.print("{s}: cell {d},{d} = {d}, want {d}\n", .{
                        name, col, row, canvas.cell(col, row), u32v(want_cells[k]),
                    });
                    return error.TestUnexpectedResult;
                }
                k += 1;
            }
        }
        try std.testing.expectEqual(want_cells.len, k);

        const lines = try canvas.toLines(allocator);
        defer graphics.BrailleCanvas.freeLines(allocator, lines);
        for (arr(get(case, "lines")), 0..) |want, i| {
            try std.testing.expectEqualStrings(str(want), lines[i]);
        }
    }
}

test "blocks match reference" {
    const allocator = std.testing.allocator;
    const parsed = try fixtureFor(allocator, "blocks");
    defer parsed.deinit();
    const f = parsed.value;

    for (arr(get(f, "verticalGlyph"))) |c| {
        try std.testing.expectEqualStrings(
            str(get(c, "out")),
            graphics.verticalGlyph(num(get(c, "ratio")), graphics.FillMode.parse(str(get(c, "mode")))),
        );
    }
    for (arr(get(f, "horizontalGlyph"))) |c| {
        try std.testing.expectEqualStrings(
            str(get(c, "out")),
            graphics.horizontalGlyph(num(get(c, "ratio")), graphics.FillMode.parse(str(get(c, "mode")))),
        );
    }
    for (arr(get(f, "shadeGlyph"))) |c| {
        try std.testing.expectEqualStrings(
            str(get(c, "out")),
            graphics.shadeGlyph(num(get(c, "ratio")), boolean(get(c, "unicode"))),
        );
    }
}
