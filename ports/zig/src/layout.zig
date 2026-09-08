//! Sizes are resolved once per frame with a single pass. No manual coordinate
//! arithmetic should ever appear in application code.
//!
//! ```
//! Size.cells(12)     12 columns/rows
//! Size.percent(40)   40% of the container
//! Size.fr(2)         two shares of whatever is left over
//! Size.auto          whatever the widget says it needs
//! Size.fill          same as fr(1)
//! ```
//!
//! The reference spells these as numbers and strings ("2fr", "40%"). Both work
//! here: `Size.cells(12)`, or `Size.parse("2fr")`.

const std = @import("std");

const roundHalfUp = @import("color.zig").roundHalfUp;

/// How much space an item wants along the main axis.
pub const Size = union(enum) {
    cells: i64,
    percent: f64,
    fr: f64,
    auto,
    fill,

    /// Parse the string spelling the reference API uses. Anything
    /// unrecognisable becomes zero cells, matching `Number.parseFloat`'s NaN
    /// fallback there.
    pub fn parse(spec: []const u8) Size {
        const s = std.mem.trim(u8, spec, " \t\r\n");
        if (std.mem.eql(u8, s, "auto")) return .auto;
        if (std.mem.eql(u8, s, "fill")) return .fill;
        if (s.len > 0 and s[s.len - 1] == '%') {
            return .{ .percent = leadingFloat(s[0 .. s.len - 1]) };
        }
        if (s.len > 2 and std.mem.endsWith(u8, s, "fr")) {
            const n = leadingFloat(s[0 .. s.len - 2]);
            return .{ .fr = if (n > 0) n else 1 };
        }
        return .{ .cells = @intFromFloat(leadingFloat(s)) };
    }
};

/// `Number.parseFloat`: read as much of a leading number as parses.
fn leadingFloat(text: []const u8) f64 {
    const s = std.mem.trim(u8, text, " \t\r\n");
    var end: usize = 0;
    var seen_digit = false;
    var seen_dot = false;
    while (end < s.len) : (end += 1) {
        const c = s[end];
        if ((c == '+' or c == '-') and end == 0) continue;
        if (c >= '0' and c <= '9') {
            seen_digit = true;
            continue;
        }
        if (c == '.' and !seen_dot) {
            seen_dot = true;
            continue;
        }
        break;
    }
    if (!seen_digit) return 0;
    return std.fmt.parseFloat(f64, s[0..end]) catch 0;
}

/// What one item contributes to a layout solve.
pub const Constraint = struct {
    size: ?Size = null,
    min: ?usize = null,
    max: ?usize = null,
    /// Natural size, used by `auto` and as the floor for flexible items.
    intrinsic: ?usize = null,

    pub fn sized(s: Size) Constraint {
        return .{ .size = s };
    }

    /// The reference's `minmax(min, max)` helper.
    pub fn minMax(lo: usize, hi: usize) Constraint {
        return .{ .size = .fill, .min = lo, .max = hi };
    }
};

/// A rectangle in absolute buffer coordinates.
pub const Rect = struct {
    x: isize = 0,
    y: isize = 0,
    width: usize = 0,
    height: usize = 0,

    pub fn isEmpty(self: Rect) bool {
        return self.width == 0 or self.height == 0;
    }

    pub fn contains(self: Rect, x: isize, y: isize) bool {
        return x >= self.x and y >= self.y and
            x < self.x + @as(isize, @intCast(self.width)) and
            y < self.y + @as(isize, @intCast(self.height));
    }

    /// Shrink by padding, never past zero.
    pub fn inset(self: Rect, padding: Padding) Rect {
        return .{
            .x = self.x + @as(isize, @intCast(padding.left)),
            .y = self.y + @as(isize, @intCast(padding.top)),
            .width = self.width -| padding.left -| padding.right,
            .height = self.height -| padding.top -| padding.bottom,
        };
    }

    pub fn intersect(self: Rect, other: Rect) Rect {
        const x = @max(self.x, other.x);
        const y = @max(self.y, other.y);
        const x2 = @min(
            self.x + @as(isize, @intCast(self.width)),
            other.x + @as(isize, @intCast(other.width)),
        );
        const y2 = @min(
            self.y + @as(isize, @intCast(self.height)),
            other.y + @as(isize, @intCast(other.height)),
        );
        return .{
            .x = x,
            .y = y,
            .width = @intCast(@max(0, x2 - x)),
            .height = @intCast(@max(0, y2 - y)),
        };
    }
};

/// Padding, clockwise from the top.
pub const Padding = struct {
    top: usize = 0,
    right: usize = 0,
    bottom: usize = 0,
    left: usize = 0,

    pub const none: Padding = .{};

    pub fn all(v: usize) Padding {
        return .{ .top = v, .right = v, .bottom = v, .left = v };
    }

    pub fn axes(vertical: usize, horizontal: usize) Padding {
        return .{ .top = vertical, .right = horizontal, .bottom = vertical, .left = horizontal };
    }
};

/// Which way a container lays its children out.
pub const Direction = enum { row, column };

const Resolved = struct {
    value: f64,
    fr: f64,
    min: f64,
    max: f64,
};

fn parseConstraint(c: Constraint, total: usize) Resolved {
    const lo: f64 = if (c.min) |v| @floatFromInt(v) else 0;
    const hi: f64 = if (c.max) |v| @floatFromInt(v) else std.math.inf(f64);
    const size = c.size orelse .auto;
    return switch (size) {
        .cells => |n| .{ .value = @floatFromInt(n), .fr = 0, .min = lo, .max = hi },
        .auto => .{
            .value = if (c.intrinsic) |v| @floatFromInt(v) else 0,
            .fr = 0,
            .min = lo,
            .max = hi,
        },
        .fill => .{ .value = 0, .fr = 1, .min = lo, .max = hi },
        .percent => |p| blk: {
            var pct = p / 100;
            if (!std.math.isFinite(pct)) pct = 0;
            break :blk .{
                .value = roundHalfUp(@as(f64, @floatFromInt(total)) * pct),
                .fr = 0,
                .min = lo,
                .max = hi,
            };
        },
        .fr => |n| .{
            .value = 0,
            .fr = if (std.math.isFinite(n) and n > 0) n else 1,
            .min = lo,
            .max = hi,
        },
    };
}

fn clampF(v: f64, lo: f64, hi: f64) f64 {
    return @max(lo, @min(hi, v));
}

/// Distribute `total` across `items`, honouring gaps, fractions and min/max.
/// Always returns non-negative sizes that sum to at most `total`. The caller
/// owns the returned slice.
pub fn solve(
    allocator: std.mem.Allocator,
    total: usize,
    items: []const Constraint,
    gap: usize,
) ![]usize {
    const seams = try allocator.alloc(isize, items.len -| 1);
    defer allocator.free(seams);
    @memset(seams, @intCast(gap));
    return solveWithGaps(allocator, total, items, seams);
}

/// As `solve`, but with a gap per seam, which may be negative.
///
/// A negative seam is how collapsed borders work: two panels overlap by the
/// column their borders share, so the pair occupies one column less than the
/// sum of their widths.
pub fn solveWithGaps(
    allocator: std.mem.Allocator,
    total: usize,
    items: []const Constraint,
    gaps: []const isize,
) ![]usize {
    const n = items.len;
    if (n == 0) return allocator.alloc(usize, 0);

    var gap_total: isize = 0;
    for (gaps[0..@min(gaps.len, n - 1)]) |g| gap_total += g;
    const signed_available = @as(isize, @intCast(total)) - gap_total;
    const available: usize = if (signed_available > 0) @intCast(signed_available) else 0;
    const parsed = try allocator.alloc(Resolved, n);
    defer allocator.free(parsed);
    for (items, 0..) |c, i| parsed[i] = parseConstraint(c, available);

    // -1 marks an item resolved in the flexible pass below.
    const out = try allocator.alloc(i64, n);
    defer allocator.free(out);
    @memset(out, -1);

    var used: i64 = 0;
    var fr_total: f64 = 0;
    for (0..n) |i| {
        const p = parsed[i];
        if (p.fr > 0) {
            fr_total += p.fr;
        } else {
            const v = clampF(
                roundHalfUp(p.value),
                p.min,
                @min(p.max, @as(f64, @floatFromInt(available))),
            );
            out[i] = @intFromFloat(v);
            used += out[i];
        }
    }

    const free = @max(0.0, @as(f64, @floatFromInt(@as(i64, @intCast(available)) - used)));
    if (fr_total > 0) {
        // Two passes: clamped items give their surplus back to the rest.
        var remaining_fr = fr_total;
        var pool = free;
        var pending = try std.ArrayList(usize).initCapacity(allocator, n);
        defer pending.deinit(allocator);
        for (0..n) |i| {
            if (out[i] == -1) pending.appendAssumeCapacity(i);
        }

        var changed = true;
        while (changed and pending.items.len > 0) {
            changed = false;
            var idx: usize = 0;
            while (idx < pending.items.len) {
                const i = pending.items[idx];
                const p = parsed[i];
                const share = if (remaining_fr > 0) pool * p.fr / remaining_fr else 0;
                const clamped = clampF(share, p.min, p.max);
                if (clamped != share) {
                    out[i] = @intFromFloat(roundHalfUp(clamped));
                    pool -= @floatFromInt(out[i]);
                    remaining_fr -= p.fr;
                    _ = pending.orderedRemove(idx);
                    changed = true;
                } else {
                    idx += 1;
                }
            }
        }

        // Distribute what is left, giving the rounding remainder to the last.
        var assigned: i64 = 0;
        for (pending.items, 0..) |i, k| {
            const p = parsed[i];
            const exact = if (remaining_fr > 0) pool * p.fr / remaining_fr else 0;
            const v: i64 = if (k == pending.items.len - 1)
                @max(0, @as(i64, @intFromFloat(pool)) - assigned)
            else
                @intFromFloat(@floor(exact));
            out[i] = v;
            assigned += v;
        }
    }

    // Overflow: shrink from the end until it fits rather than drawing outside.
    var sum: i64 = 0;
    for (out) |v| sum += v;
    const avail: i64 = @intCast(available);
    if (sum > avail) {
        var i: usize = n;
        while (i > 0 and sum > avail) {
            i -= 1;
            const shrink = @min(out[i] - @as(i64, @intFromFloat(parsed[i].min)), sum - avail);
            if (shrink > 0) {
                out[i] -= shrink;
                sum -= shrink;
            }
        }
        i = n;
        while (i > 0 and sum > avail) {
            i -= 1;
            const shrink = @min(out[i], sum - avail);
            out[i] -= shrink;
            sum -= shrink;
        }
    }

    const result = try allocator.alloc(usize, n);
    for (out, 0..) |v, i| result[i] = @intCast(@max(0, v));
    return result;
}

/// Lay children out along one axis inside `rect`. The caller owns the slice.
/// Where leftover space goes.
///
/// It only ever applies when there is slack, and a container holding any `fr`
/// or `fill` child has none -- that child has already absorbed it. So this is
/// inert exactly where it would otherwise fight with the constraints.
pub const Justify = enum {
    start,
    end,
    center,
    space_between,
    space_around,
    space_evenly,

    /// The spelling the reference API uses. Anything else is `start`, which is
    /// what every layout did before this existed.
    pub fn parse(name: []const u8) Justify {
        if (std.mem.eql(u8, name, "end")) return .end;
        if (std.mem.eql(u8, name, "center")) return .center;
        if (std.mem.eql(u8, name, "space-between")) return .space_between;
        if (std.mem.eql(u8, name, "space-around")) return .space_around;
        if (std.mem.eql(u8, name, "space-evenly")) return .space_evenly;
        return .start;
    }
};

/// How much slack sits before item `i`, as an exact fraction. Every mode is a
/// different answer to that one question, which is why they share the rounding
/// below rather than each growing their own off-by-one.
fn before(i: usize, slack: f64, count: usize, justify: Justify) f64 {
    const fi: f64 = @floatFromInt(i);
    const fc: f64 = @floatFromInt(count);
    return switch (justify) {
        .start => 0,
        .end => slack,
        // Floor, so an odd cell falls after the content rather than before it.
        .center => @floor(slack / 2),
        .space_between => if (count > 1) fi * slack / (fc - 1) else 0,
        .space_evenly => (fi + 1) * slack / (fc + 1),
        .space_around => (fi + 0.5) * slack / fc,
    };
}

/// The offset before the first child, and the extra added at each seam. The
/// caller owns the returned slice.
///
/// Cells are whole, and rounding each gap on its own loses one here and gains
/// one there. Rounding the cumulative offset and taking differences means the
/// parts always add up to exactly the slack.
pub fn distribute(
    allocator: std.mem.Allocator,
    slack: usize,
    count: usize,
    justify: Justify,
) !struct { lead: usize, seams: []usize } {
    const seams = try allocator.alloc(usize, count -| 1);
    @memset(seams, 0);
    if (slack == 0 or count == 0 or justify == .start) return .{ .lead = 0, .seams = seams };

    const at = struct {
        fn f(i: usize, sl: usize, c: usize, j: Justify) usize {
            const v = before(i, @floatFromInt(sl), c, j);
            return @intFromFloat(@floor(v + 0.5));
        }
    }.f;

    var i: usize = 0;
    while (i + 1 < count) : (i += 1) {
        seams[i] = at(i + 1, slack, count, justify) -| at(i, slack, count, justify);
    }
    return .{ .lead = at(0, slack, count, justify), .seams = seams };
}

pub fn stack(
    allocator: std.mem.Allocator,
    rect: Rect,
    items: []const Constraint,
    direction: Direction,
    gap: usize,
) ![]Rect {
    const seams = try allocator.alloc(isize, items.len -| 1);
    defer allocator.free(seams);
    @memset(seams, @intCast(gap));
    return stackWithGaps(allocator, rect, items, direction, seams);
}

/// As `stack`, with a policy for whatever the children leave over.
pub fn stackJustified(
    allocator: std.mem.Allocator,
    rect: Rect,
    items: []const Constraint,
    direction: Direction,
    gap: usize,
    justify: Justify,
) ![]Rect {
    const seams = try allocator.alloc(isize, items.len -| 1);
    defer allocator.free(seams);
    @memset(seams, @intCast(gap));
    return stackWithGapsJustified(allocator, rect, items, direction, seams, justify);
}

/// As `stack`, but with a gap per seam, which may be negative.
pub fn stackWithGaps(
    allocator: std.mem.Allocator,
    rect: Rect,
    items: []const Constraint,
    direction: Direction,
    gaps: []const isize,
) ![]Rect {
    return stackWithGapsJustified(allocator, rect, items, direction, gaps, .start);
}

/// The full form: a gap per seam, and a policy for whatever is left over.
pub fn stackWithGapsJustified(
    allocator: std.mem.Allocator,
    rect: Rect,
    items: []const Constraint,
    direction: Direction,
    gaps: []const isize,
    justify: Justify,
) ![]Rect {
    const horizontal = direction == .row;
    const axis = if (horizontal) rect.width else rect.height;
    const sizes = try solveWithGaps(allocator, axis, items, gaps);
    defer allocator.free(sizes);

    var gap_total: isize = 0;
    var g: usize = 0;
    while (g + 1 < sizes.len) : (g += 1) {
        if (g < gaps.len) gap_total += gaps[g];
    }
    var used: isize = gap_total;
    for (sizes) |size| used += @intCast(size);
    const slack: usize = @intCast(@max(0, @as(isize, @intCast(axis)) - used));

    const spread = try distribute(allocator, slack, sizes.len, justify);
    defer allocator.free(spread.seams);

    const out = try allocator.alloc(Rect, sizes.len);
    var offset: isize = (if (horizontal) rect.x else rect.y) + @as(isize, @intCast(spread.lead));
    for (sizes, 0..) |size, i| {
        out[i] = if (horizontal)
            .{ .x = offset, .y = rect.y, .width = size, .height = rect.height }
        else
            .{ .x = rect.x, .y = offset, .width = rect.width, .height = size };
        const seam = (if (i < gaps.len) gaps[i] else 0) +
            @as(isize, @intCast(if (i < spread.seams.len) spread.seams[i] else 0));
        offset += @as(isize, @intCast(size)) + seam;
    }
    return out;
}
