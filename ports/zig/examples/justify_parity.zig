//! Print the justify distribution for a matrix of inputs, so the ports can be
//! diffed against the TypeScript reference rather than assumed to agree.
const std = @import("std");
const hqtui = @import("hqtui");

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const stdout = std.Io.File.stdout();

    var text: std.ArrayListUnmanaged(u8) = .empty;
    defer text.deinit(allocator);

    const names = [_][]const u8{ "start", "end", "center", "space-between", "space-around", "space-evenly" };
    for (names) |name| {
        const j = hqtui.layout.Justify.parse(name);
        var count: usize = 1;
        while (count <= 5) : (count += 1) {
            var slack: usize = 0;
            while (slack <= 12) : (slack += 1) {
                const spread = try hqtui.layout.distribute(allocator, slack, count, j);
                defer allocator.free(spread.seams);

                var seams: std.ArrayListUnmanaged(u8) = .empty;
                defer seams.deinit(allocator);
                for (spread.seams, 0..) |s, i| {
                    if (i > 0) try seams.appendSlice(allocator, ",");
                    const one = try std.fmt.allocPrint(allocator, "{d}", .{s});
                    defer allocator.free(one);
                    try seams.appendSlice(allocator, one);
                }

                const line = try std.fmt.allocPrint(
                    allocator,
                    "{s} {d} {d} {d} {s}\n",
                    .{ name, count, slack, spread.lead, seams.items },
                );
                defer allocator.free(line);
                try text.appendSlice(allocator, line);
            }
        }
    }
    try stdout.writeStreamingAll(init.io, text.items);
}
