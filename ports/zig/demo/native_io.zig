//! procfs/sysfs report synthetic sizes; stream to EOF instead of trusting stat.
const std = @import("std");
pub fn read(a: std.mem.Allocator, io: std.Io, path: []const u8) []const u8 {
    const file = std.Io.Dir.cwd().openFile(io, path, .{}) catch return "";
    defer file.close(io);
    var buffer: [4096]u8 = undefined;
    var reader = file.readerStreaming(io, &buffer);
    return reader.interface.allocRemaining(a, .limited(1024 * 1024)) catch "";
}
