//! Terminal text is a grid of columns, not a string. Getting width wrong
//! corrupts every cell to the right of the mistake, so width lives behind this
//! one module.
//!
//! One difference from the TypeScript reference is worth stating plainly: Zig
//! strings are UTF-8 bytes, so the unpaired-surrogate handling the reference
//! needs cannot arise from valid input. Everything else — the width tables, the
//! cluster rules, the unsafe-codepoint policy — is identical, and the
//! conformance suite checks it.

const std = @import("std");

/// A cell's contents: a bare codepoint, or an index into the cluster table.
pub const Cell = u32;

/// Values at or above this are indices into the cluster table, not codepoints.
pub const cluster_base: Cell = 0x11_0000;
/// Written into the cell after a double-width character. Never drawn.
pub const continuation: Cell = 0xffff_ffff;
/// What an unrepresentable codepoint is shown as: one column, cannot fuse.
pub const replacement: Cell = 0xfffd;

/// C0, DEL and C1. A cell holding one of these would be written straight back
/// out by the encoder, so untrusted text could steer the terminal instead of
/// filling a cell.
pub fn isControl(cp: u21) bool {
    return cp < 0x20 or (cp >= 0x7f and cp <= 0x9f);
}

/// Bidi overrides, embeddings and isolates: the Trojan Source set
/// (CVE-2021-42574). They emit no glyph but reorder everything around them, so
/// `user<RLO>nimda` reads as `user admin` in a log pane. Directional *marks*
/// (LRM/RLM) and real RTL script are left alone — those render honestly.
pub fn isBidiControl(cp: u21) bool {
    return (cp >= 0x202a and cp <= 0x202e) or (cp >= 0x2066 and cp <= 0x2069);
}

/// Anything that must never occupy a cell: it steers rather than draws.
///
/// This runs per cell on the write path and per codepoint on the measure path,
/// so it is one small branch ladder rather than two calls. Printable ASCII —
/// overwhelmingly the common case — exits on the second comparison.
pub fn isUnsafeCodepoint(cp: u32) bool {
    if (cp < 0x20) return true;
    if (cp < 0x7f) return false;
    if (cp <= 0x9f) return true;
    if (cp < 0x202a or cp > 0x2069) return false;
    return cp <= 0x202e or cp >= 0x2066;
}

/// Strip everything that steers the terminal rather than drawing, into `out`.
/// Returns the written slice; `out` must be at least `text.len` bytes.
pub fn stripUnsafeInto(out: []u8, text: []const u8) []u8 {
    var written: usize = 0;
    var it = std.unicode.Utf8Iterator{ .bytes = text, .i = 0 };
    while (it.nextCodepointSlice()) |slice| {
        const cp = std.unicode.utf8Decode(slice) catch continue;
        if (isUnsafeCodepoint(cp)) continue;
        @memcpy(out[written..][0..slice.len], slice);
        written += slice.len;
    }
    return out[0..written];
}

/// Allocating form, for callers that do not have a scratch buffer.
pub fn stripUnsafeAlloc(allocator: std.mem.Allocator, text: []const u8) ![]u8 {
    const buf = try allocator.alloc(u8, text.len);
    const kept = stripUnsafeInto(buf, text);
    return allocator.realloc(buf, kept.len);
}

/// A cell may hold at most this many codepoints. Real ZWJ emoji top out around
/// ten; anything longer is a byte-amplification bomb, because the cell still
/// claims one column while painting hundreds.
const max_cluster_codepoints = 16;

/// Distinct clusters are interned for the life of the process — a cell holds an
/// index into this table, so entries can never be evicted while a framebuffer
/// might still reference them. Untrusted text must therefore not be able to
/// grow it without bound.
const max_clusters = 32768;

/// A cluster's bytes are capped too, so one table entry cannot be enormous even
/// when the codepoint count is legal.
const max_cluster_bytes = 64;

/// The cluster table.
///
/// Unlike the other ports, this one cannot lean on a garbage collector or a
/// global allocator, so the storage is a fixed arena sized from the two caps
/// above: 32768 entries of at most 64 bytes. That is 2 MiB of BSS, reserved but
/// untouched until something actually interns a cluster, and it means
/// `internCluster` cannot fail and needs no allocator threaded through every
/// draw call.
const ClusterTable = struct {
    /// A spin lock rather than `std.Io.Mutex`, which in Zig 0.16 needs an `Io`
    /// handle to park a waiter — and threading one through every draw call to
    /// intern an emoji would be a poor trade. Contention here is close to nil:
    /// interning happens once per distinct cluster and holds the lock for a
    /// memcpy.
    var locked = std.atomic.Value(bool).init(false);

    fn lock() void {
        while (locked.cmpxchgWeak(false, true, .acquire, .monotonic) != null) {
            std.atomic.spinLoopHint();
        }
    }

    fn unlock() void {
        locked.store(false, .release);
    }

    var storage: [max_clusters * max_cluster_bytes]u8 = undefined;
    var offsets: [max_clusters]u32 = undefined;
    var lengths: [max_clusters]u8 = undefined;
    var used: u32 = 0;
    var count: u32 = 0;

    fn text(index: u32) []const u8 {
        if (index >= count) return " ";
        return storage[offsets[index]..][0..lengths[index]];
    }

    fn find(needle: []const u8) ?u32 {
        var i: u32 = 0;
        while (i < count) : (i += 1) {
            if (std.mem.eql(u8, text(i), needle)) return i;
        }
        return null;
    }
};

/// Intern a multi-codepoint grapheme (emoji, combining sequence) into one cell
/// value. Unsafe codepoints are stripped here as well as in `graphemes`, so no
/// caller can smuggle one into a cell.
pub fn internCluster(text: []const u8) Cell {
    var scratch: [max_cluster_bytes * 2]u8 = undefined;
    const source = if (text.len <= scratch.len) text else text[0..scratch.len];
    var safe: []const u8 = stripUnsafeInto(&scratch, source);
    if (safe.len == 0) safe = " ";
    if (safe.len > max_cluster_bytes) safe = truncateToBoundary(safe, max_cluster_bytes);

    ClusterTable.lock();
    defer ClusterTable.unlock();

    if (ClusterTable.find(safe)) |i| return cluster_base + i;

    if (ClusterTable.count >= max_clusters or
        ClusterTable.used + safe.len > ClusterTable.storage.len)
    {
        // Degrade to the base character rather than grow the table for ever.
        const first = std.unicode.utf8Decode(
            safe[0 .. std.unicode.utf8ByteSequenceLength(safe[0]) catch 1],
        ) catch 32;
        return if (charWidth(first) > 0) @as(Cell, first) else 32;
    }

    const index = ClusterTable.count;
    @memcpy(ClusterTable.storage[ClusterTable.used..][0..safe.len], safe);
    ClusterTable.offsets[index] = ClusterTable.used;
    ClusterTable.lengths[index] = @intCast(safe.len);
    ClusterTable.used += @intCast(safe.len);
    ClusterTable.count += 1;
    return cluster_base + index;
}

/// Cut to at most `limit` bytes without splitting a character in half.
fn truncateToBoundary(text: []const u8, limit: usize) []const u8 {
    var end = @min(text.len, limit);
    while (end > 0 and (text[end - 1] & 0xc0) == 0x80) end -= 1;
    return text[0..end];
}

pub fn clusterText(value: Cell) []const u8 {
    ClusterTable.lock();
    defer ClusterTable.unlock();
    return ClusterTable.text(value - cluster_base);
}

/// Render a cell value back to the text the terminal should receive.
///
/// Cluster text is borrowed from the table, which lives for the process; a bare
/// codepoint is encoded into `buf`, which the caller owns.
pub fn cellText(value: Cell, buf: *[4]u8) []const u8 {
    if (value >= cluster_base and value != continuation) return clusterText(value);
    if (value == 0 or value == continuation) return " ";
    const len = std.unicode.utf8Encode(@intCast(value), buf) catch {
        return " ";
    };
    return buf[0..len];
}

const Range = struct { lo: u32, hi: u32 };

// Zero-width: combining marks, variation selectors, ZWJ, most format controls.
const zero_width = [_]Range{
    .{ .lo = 0x0300, .hi = 0x036f }, .{ .lo = 0x0483, .hi = 0x0489 },
    .{ .lo = 0x0591, .hi = 0x05bd }, .{ .lo = 0x0610, .hi = 0x061a },
    .{ .lo = 0x064b, .hi = 0x065f }, .{ .lo = 0x0670, .hi = 0x0670 },
    .{ .lo = 0x06d6, .hi = 0x06dc }, .{ .lo = 0x0730, .hi = 0x074a },
    .{ .lo = 0x07a6, .hi = 0x07b0 }, .{ .lo = 0x0816, .hi = 0x0819 },
    .{ .lo = 0x08e3, .hi = 0x0903 }, .{ .lo = 0x093a, .hi = 0x093c },
    .{ .lo = 0x0951, .hi = 0x0957 }, .{ .lo = 0x0e31, .hi = 0x0e31 },
    .{ .lo = 0x0e34, .hi = 0x0e3a }, .{ .lo = 0x0eb1, .hi = 0x0eb1 },
    .{ .lo = 0x1ab0, .hi = 0x1aff }, .{ .lo = 0x1dc0, .hi = 0x1dff },
    .{ .lo = 0x200b, .hi = 0x200f }, .{ .lo = 0x2028, .hi = 0x202e },
    .{ .lo = 0x2060, .hi = 0x2064 }, .{ .lo = 0x2066, .hi = 0x2069 },
    .{ .lo = 0x20d0, .hi = 0x20f0 }, .{ .lo = 0xfe00, .hi = 0xfe0f },
    .{ .lo = 0xfe20, .hi = 0xfe2f },
    .{ .lo = 0xfeff, .hi = 0xfeff }, .{ .lo = 0xe0100, .hi = 0xe01ef },
};

// Double-width: East Asian Wide/Fullwidth plus the emoji blocks terminals widen.
const wide = [_]Range{
    .{ .lo = 0x1100, .hi = 0x115f },   .{ .lo = 0x2e80, .hi = 0x303e },
    .{ .lo = 0x3041, .hi = 0x33ff },   .{ .lo = 0x3400, .hi = 0x4dbf },
    .{ .lo = 0x4e00, .hi = 0x9fff },   .{ .lo = 0xa000, .hi = 0xa4cf },
    .{ .lo = 0xa960, .hi = 0xa97f },   .{ .lo = 0xac00, .hi = 0xd7a3 },
    .{ .lo = 0xf900, .hi = 0xfaff },   .{ .lo = 0xfe10, .hi = 0xfe19 },
    .{ .lo = 0xfe30, .hi = 0xfe6f },   .{ .lo = 0xff00, .hi = 0xff60 },
    .{ .lo = 0xffe0, .hi = 0xffe6 },   .{ .lo = 0x1f004, .hi = 0x1f004 },
    .{ .lo = 0x1f0cf, .hi = 0x1f0cf }, .{ .lo = 0x1f18e, .hi = 0x1f18e },
    .{ .lo = 0x1f191, .hi = 0x1f19a }, .{ .lo = 0x1f200, .hi = 0x1f320 },
    .{ .lo = 0x1f32d, .hi = 0x1f335 }, .{ .lo = 0x1f337, .hi = 0x1f37c },
    .{ .lo = 0x1f37e, .hi = 0x1f393 }, .{ .lo = 0x1f3a0, .hi = 0x1f3ca },
    .{ .lo = 0x1f3cf, .hi = 0x1f3d3 }, .{ .lo = 0x1f3e0, .hi = 0x1f3f0 },
    .{ .lo = 0x1f3f4, .hi = 0x1f3f4 }, .{ .lo = 0x1f3f8, .hi = 0x1f43e },
    .{ .lo = 0x1f440, .hi = 0x1f440 }, .{ .lo = 0x1f442, .hi = 0x1f4fc },
    .{ .lo = 0x1f4ff, .hi = 0x1f53d }, .{ .lo = 0x1f54b, .hi = 0x1f54e },
    .{ .lo = 0x1f550, .hi = 0x1f567 }, .{ .lo = 0x1f57a, .hi = 0x1f57a },
    .{ .lo = 0x1f595, .hi = 0x1f596 }, .{ .lo = 0x1f5a4, .hi = 0x1f5a4 },
    .{ .lo = 0x1f5fb, .hi = 0x1f64f }, .{ .lo = 0x1f680, .hi = 0x1f6c5 },
    .{ .lo = 0x1f6cc, .hi = 0x1f6cc }, .{ .lo = 0x1f6d0, .hi = 0x1f6d2 },
    .{ .lo = 0x1f6eb, .hi = 0x1f6ec }, .{ .lo = 0x1f910, .hi = 0x1f9ff },
    .{ .lo = 0x20000, .hi = 0x2fffd }, .{ .lo = 0x30000, .hi = 0x3fffd },
};

// Extended_Pictographic, approximated to the ranges terminals actually join.
// ZWJ only glues emoji together; joining it to arbitrary text is how one cell
// ends up painting hundreds of columns.
const pictographic = [_]Range{
    .{ .lo = 0x00a9, .hi = 0x00a9 },   .{ .lo = 0x00ae, .hi = 0x00ae },
    .{ .lo = 0x203c, .hi = 0x203c },   .{ .lo = 0x2049, .hi = 0x2049 },
    .{ .lo = 0x2122, .hi = 0x2122 },   .{ .lo = 0x2139, .hi = 0x2139 },
    .{ .lo = 0x2194, .hi = 0x21aa },   .{ .lo = 0x231a, .hi = 0x23fa },
    .{ .lo = 0x24c2, .hi = 0x24c2 },   .{ .lo = 0x25aa, .hi = 0x25fe },
    .{ .lo = 0x2600, .hi = 0x27bf },   .{ .lo = 0x2934, .hi = 0x2935 },
    .{ .lo = 0x2b00, .hi = 0x2bff },   .{ .lo = 0x3030, .hi = 0x3030 },
    .{ .lo = 0x303d, .hi = 0x303d },   .{ .lo = 0x3297, .hi = 0x3299 },
    .{ .lo = 0x1f000, .hi = 0x1faff }, .{ .lo = 0x1fc00, .hi = 0x1fffd },
};

fn inRanges(cp: u32, ranges: []const Range) bool {
    var lo: usize = 0;
    var hi: usize = ranges.len;
    while (lo < hi) {
        const mid = lo + (hi - lo) / 2;
        if (cp < ranges[mid].lo) {
            hi = mid;
        } else if (cp > ranges[mid].hi) {
            lo = mid + 1;
        } else {
            return true;
        }
    }
    return false;
}

/// Columns a single codepoint occupies: 0, 1, or 2.
pub fn charWidth(cp: u32) usize {
    if (cp == 0) return 0;
    if (cp < 32 or (cp >= 0x7f and cp < 0xa0)) return 0;
    if (cp < 0x300) return 1;
    if (inRanges(cp, &zero_width)) return 0;
    if (inRanges(cp, &wide)) return 2;
    return 1;
}

/// Columns a cell value occupies, handling interned clusters.
pub fn cellWidth(value: Cell) usize {
    if (value == continuation) return 0;
    if (value >= cluster_base) {
        const text = clusterText(value);
        if (text.len == 0) return 1;
        const len = std.unicode.utf8ByteSequenceLength(text[0]) catch return 1;
        const first = std.unicode.utf8Decode(text[0..len]) catch return 1;
        return if (charWidth(first) == 2) 2 else 1;
    }
    return charWidth(value);
}

const zwj: u21 = 0x200d;

/// One terminal cell's worth of text.
pub const Grapheme = struct {
    /// A bare codepoint, or an interned cluster id.
    value: Cell,
    width: usize,
};

/// Splits text into terminal cells.
///
/// The other ports return a list; Zig would have to allocate for that, and this
/// runs on every write. An iterator keeps the hot path allocation-free.
pub const GraphemeIterator = struct {
    text: []const u8,
    i: usize = 0,

    pub fn next(self: *GraphemeIterator) ?Grapheme {
        while (self.i < self.text.len) {
            const first_len = std.unicode.utf8ByteSequenceLength(self.text[self.i]) catch {
                self.i += 1;
                continue;
            };
            if (self.i + first_len > self.text.len) {
                self.i = self.text.len;
                return null;
            }
            const cp = std.unicode.utf8Decode(self.text[self.i..][0..first_len]) catch {
                self.i += first_len;
                continue;
            };
            var size: usize = first_len;
            const width = charWidth(cp);

            // An unsafe codepoint never reaches a cell: it would otherwise be
            // absorbed into the previous grapheme exactly like a combining mark
            // and re-emitted verbatim — escape injection. Every unsafe codepoint
            // is zero-width, so testing the width first means printable text
            // never pays for this check.
            if (width == 0 and isUnsafeCodepoint(cp)) {
                self.i += size;
                continue;
            }

            // A cell paints one column but may hold several codepoints; cap how
            // many, so no input makes a single cell emit an unbounded run.
            var cluster_end: ?usize = null;
            var parts: usize = 1;
            while (parts < max_cluster_codepoints) {
                const rest = self.text[self.i + size ..];
                if (rest.len == 0) break;
                const next_len = std.unicode.utf8ByteSequenceLength(rest[0]) catch break;
                if (next_len > rest.len) break;
                const nxt = std.unicode.utf8Decode(rest[0..next_len]) catch break;

                if (nxt == zwj) {
                    const after_rest = rest[next_len..];
                    if (after_rest.len == 0) break;
                    const after_len =
                        std.unicode.utf8ByteSequenceLength(after_rest[0]) catch break;
                    if (after_len > after_rest.len) break;
                    const after = std.unicode.utf8Decode(after_rest[0..after_len]) catch break;
                    // ZWJ joins emoji, and nothing else. Joining it to arbitrary
                    // text lets one cell claim a single column while painting
                    // hundreds of them.
                    if (!inRanges(cp, &pictographic) or !inRanges(after, &pictographic)) break;
                    size += next_len + after_len;
                    cluster_end = self.i + size;
                    parts += 2;
                    continue;
                }
                if (charWidth(nxt) != 0) break;
                // Leave anything unsafe to the outer loop, which drops it.
                if (isUnsafeCodepoint(nxt)) break;
                size += next_len;
                cluster_end = self.i + size;
                parts += 1;
            }

            const start = self.i;
            self.i += size;

            if (width == 0) {
                // A zero-width base: a combining mark with nothing to combine
                // with, or a stray ZWJ. It paints no column, so handing it one
                // would walk the cursor ahead of the screen. Drop it.
                continue;
            }
            if (cluster_end) |end| {
                return .{ .value = internCluster(self.text[start..end]), .width = width };
            }
            return .{ .value = @as(Cell, cp), .width = width };
        }
        return null;
    }
};

pub fn graphemes(text: []const u8) GraphemeIterator {
    return .{ .text = text };
}

/// Display width of a string in terminal columns.
pub fn stringWidth(text: []const u8) usize {
    var it = graphemes(text);
    var w: usize = 0;
    while (it.next()) |g| w += g.width;
    return w;
}

/// Horizontal placement within a fixed width.
pub const Align = enum {
    left,
    center,
    right,

    pub fn parse(name: []const u8) Align {
        if (std.mem.eql(u8, name, "right")) return .right;
        if (std.mem.eql(u8, name, "center")) return .center;
        return .left;
    }
};

/// Truncate to `max` columns into `out`, appending `ellipsis` when it does not
/// fit. Returns the written slice.
pub fn truncateInto(out: []u8, text: []const u8, max: usize, ellipsis: []const u8) []u8 {
    if (max == 0) return out[0..0];
    if (stringWidth(text) <= max) {
        const n = @min(out.len, text.len);
        @memcpy(out[0..n], text[0..n]);
        return out[0..n];
    }
    const limit = max -| stringWidth(ellipsis);
    var written: usize = 0;
    var w: usize = 0;
    var it = graphemes(text);
    while (it.next()) |g| {
        if (w + g.width > limit) break;
        var buf: [4]u8 = undefined;
        const slice = cellText(g.value, &buf);
        if (written + slice.len > out.len) break;
        @memcpy(out[written..][0..slice.len], slice);
        written += slice.len;
        w += g.width;
    }
    const room = @min(ellipsis.len, out.len - written);
    @memcpy(out[written..][0..room], ellipsis[0..room]);
    return out[0 .. written + room];
}

/// `text` with its first `columns` display columns removed, written into `out`.
///
/// For scrolling a line sideways. Slicing by bytes would cut inside a grapheme
/// and corrupt it, and a scroll that lands in the middle of a wide character
/// cannot draw half of it -- what is left of that character is a space, which
/// is what a terminal shows when a double-width cell is clipped.
pub fn dropColumns(out: []u8, text: []const u8, columns: usize) []u8 {
    if (columns == 0) {
        const n = @min(out.len, text.len);
        @memcpy(out[0..n], text[0..n]);
        return out[0..n];
    }
    var written: usize = 0;
    var skipped: usize = 0;
    var it = graphemes(text);
    while (it.next()) |g| {
        if (skipped >= columns) {
            var buf: [4]u8 = undefined;
            const bytes = cellText(g.value, &buf);
            if (written + bytes.len > out.len) break;
            @memcpy(out[written..][0..bytes.len], bytes);
            written += bytes.len;
            continue;
        }
        skipped += g.width;
        // A wide character straddling the cut leaves its trailing half behind.
        if (skipped > columns) {
            const pad = skipped - columns;
            if (written + pad > out.len) break;
            @memset(out[written..][0..pad], ' ');
            written += pad;
        }
    }
    return out[0..written];
}

pub fn truncate(out: []u8, text: []const u8, max: usize) []u8 {
    return truncateInto(out, text, max, "…");
}

/// Pad or truncate to exactly `width` columns into `out`.
///
/// `out` needs room for the padding as well as the text: `width * 4` bytes is
/// always enough, since no cell holds more than one four-byte character worth
/// of padding.
pub fn fit(out: []u8, text: []const u8, width: usize, alignment: Align) []u8 {
    var scratch: [1024]u8 = undefined;
    const source = if (text.len <= scratch.len) text else text[0..scratch.len];
    const truncated = truncate(&scratch, source, width);
    const pad = width -| stringWidth(truncated);
    if (pad == 0) {
        const n = @min(out.len, truncated.len);
        @memcpy(out[0..n], truncated[0..n]);
        return out[0..n];
    }

    var written: usize = 0;
    const left: usize = switch (alignment) {
        .right => pad,
        .center => pad / 2,
        .left => 0,
    };
    const right = pad - left;

    var i: usize = 0;
    while (i < left and written < out.len) : (i += 1) {
        out[written] = ' ';
        written += 1;
    }
    const n = @min(out.len - written, truncated.len);
    @memcpy(out[written..][0..n], truncated[0..n]);
    written += n;
    i = 0;
    while (i < right and written < out.len) : (i += 1) {
        out[written] = ' ';
        written += 1;
    }
    return out[0..written];
}

/// JavaScript's `\s`, which is not quite Zig's whitespace: it excludes U+0085
/// and includes U+FEFF.
fn isJsSpace(cp: u32) bool {
    return switch (cp) {
        0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0,
        0x1680,
        0x2000...0x200a,
        0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
        => true,
        else => false,
    };
}

fn trimEnd(text: []const u8) []const u8 {
    var end = text.len;
    while (end > 0) {
        var start = end - 1;
        while (start > 0 and (text[start] & 0xc0) == 0x80) start -= 1;
        const len = std.unicode.utf8ByteSequenceLength(text[start]) catch break;
        const cp = std.unicode.utf8Decode(text[start..][0..len]) catch break;
        if (!isJsSpace(cp)) break;
        end = start;
    }
    return text[0..end];
}

fn allSpace(text: []const u8) bool {
    if (text.len == 0) return false;
    var it = std.unicode.Utf8Iterator{ .bytes = text, .i = 0 };
    while (it.nextCodepoint()) |cp| {
        if (!isJsSpace(cp)) return false;
    }
    return true;
}

/// Greedy word wrap at `width` columns.
///
/// The caller owns the returned lines and the arena backing them; free with
/// `freeWrapped`.
pub fn wrap(allocator: std.mem.Allocator, text: []const u8, width: usize) ![][]u8 {
    var lines: std.ArrayList([]u8) = .empty;
    errdefer {
        for (lines.items) |line| allocator.free(line);
        lines.deinit(allocator);
    }
    if (width == 0) return lines.toOwnedSlice(allocator);

    var paragraphs = std.mem.splitScalar(u8, text, '\n');
    while (paragraphs.next()) |paragraph| {
        var line: std.ArrayList(u8) = .empty;
        defer line.deinit(allocator);
        var line_w: usize = 0;

        var words = splitKeepingWhitespace(paragraph);
        while (words.next()) |word| {
            if (word.len == 0) continue;
            const w = stringWidth(word);
            if (line_w + w > width and line_w > 0) {
                try lines.append(allocator, try allocator.dupe(u8, trimEnd(line.items)));
                line.clearRetainingCapacity();
                line_w = 0;
                if (allSpace(word)) continue;
            }
            if (w > width) {
                // A single word longer than the line: hard-split it.
                var it = graphemes(word);
                while (it.next()) |g| {
                    if (line_w + g.width > width) {
                        try lines.append(allocator, try allocator.dupe(u8, line.items));
                        line.clearRetainingCapacity();
                        line_w = 0;
                    }
                    var buf: [4]u8 = undefined;
                    try line.appendSlice(allocator, cellText(g.value, &buf));
                    line_w += g.width;
                }
                continue;
            }
            try line.appendSlice(allocator, word);
            line_w += w;
        }
        try lines.append(allocator, try allocator.dupe(u8, trimEnd(line.items)));
    }
    return lines.toOwnedSlice(allocator);
}

pub fn freeWrapped(allocator: std.mem.Allocator, lines: [][]u8) void {
    for (lines) |line| allocator.free(line);
    allocator.free(lines);
}

/// How many lines `wrap` would produce, without allocating any of them. The
/// layout pass only needs the count.
pub fn wrapCount(text: []const u8, width: usize) usize {
    if (width == 0) return 0;
    var count: usize = 0;
    var paragraphs = std.mem.splitScalar(u8, text, '\n');
    while (paragraphs.next()) |paragraph| {
        var line_w: usize = 0;
        var words = splitKeepingWhitespace(paragraph);
        while (words.next()) |word| {
            if (word.len == 0) continue;
            const w = stringWidth(word);
            if (line_w + w > width and line_w > 0) {
                count += 1;
                line_w = 0;
                if (allSpace(word)) continue;
            }
            if (w > width) {
                var it = graphemes(word);
                while (it.next()) |g| {
                    if (line_w + g.width > width) {
                        count += 1;
                        line_w = 0;
                    }
                    line_w += g.width;
                }
                continue;
            }
            line_w += w;
        }
        count += 1;
    }
    return count;
}

/// `split(/(\s+)/)`: separators are kept as their own entries, which is what
/// makes the wrap above preserve interior spacing.
const WhitespaceSplitter = struct {
    text: []const u8,
    i: usize = 0,
    done: bool = false,

    fn next(self: *WhitespaceSplitter) ?[]const u8 {
        if (self.done) return null;
        if (self.i >= self.text.len) {
            self.done = true;
            return self.text[self.text.len..];
        }
        const start = self.i;
        const in_space = isJsSpace(self.text[self.i]);
        while (self.i < self.text.len) {
            const len = std.unicode.utf8ByteSequenceLength(self.text[self.i]) catch 1;
            const cp = std.unicode.utf8Decode(
                self.text[self.i..][0..@min(len, self.text.len - self.i)],
            ) catch self.text[self.i];
            if (isJsSpace(cp) != in_space) break;
            self.i += len;
        }
        return self.text[start..self.i];
    }
};

fn splitKeepingWhitespace(text: []const u8) WhitespaceSplitter {
    return .{ .text = text };
}

/// Count UTF-16 code units, which is what the reference's `String.length` means.
/// It only matters in one place — whether a key name is long enough to carry a
/// shift modifier — but matching it exactly costs nothing.
pub fn utf16Length(text: []const u8) usize {
    var it = std.unicode.Utf8Iterator{ .bytes = text, .i = 0 };
    var n: usize = 0;
    while (it.nextCodepoint()) |cp| n += if (cp > 0xffff) @as(usize, 2) else 1;
    return n;
}
