//! Prints what the country lookup answers for a fixed set of points.
//!
//! The same probe exists for every port, so "the ports agree about the world" is
//! a diff rather than a hope.
const std = @import("std");
const hqtui = @import("hqtui");

const world = hqtui.graphics.world;
const widgets = hqtui.widgets;

pub fn main(init: std.process.Init) !void {
    const stdout = std.Io.File.stdout();
    // A line at a time straight out: this prints a few dozen lines once, so a
    // buffer of its own would be ceremony.
    var line: [256]u8 = undefined;

    const places = [_]struct { name: []const u8, lon: f64, lat: f64 }{
        .{ .name = "Paris", .lon = 2.35, .lat = 48.86 },
        .{ .name = "Tokyo", .lon = 139.7, .lat = 35.7 },
        .{ .name = "Cairo", .lon = 31.2, .lat = 30.0 },
        .{ .name = "Brasilia", .lon = -47.9, .lat = -15.8 },
        .{ .name = "Canberra", .lon = 149.1, .lat = -35.3 },
        .{ .name = "Denver", .lon = -105.0, .lat = 39.7 },
        .{ .name = "Moscow", .lon = 37.6, .lat = 55.75 },
        .{ .name = "Delhi", .lon = 77.2, .lat = 28.6 },
        .{ .name = "Nairobi", .lon = 36.8, .lat = -1.3 },
        .{ .name = "Pacific", .lon = -140.0, .lat = 0.0 },
        .{ .name = "Atlantic", .lon = -30.0, .lat = 0.0 },
        .{ .name = "SouthernOcean", .lon = 80.0, .lat = -40.0 },
        .{ .name = "NorthPacific", .lon = -150.0, .lat = 40.0 },
    };
    for (places) |place| {
        const found = world.countryAt(place.lon, place.lat);
        const text = try std.fmt.bufPrint(&line, "{s} {s}\n", .{
            place.name,
            if (found) |c| c.name else "-",
        });
        try stdout.writeStreamingAll(init.io, text);
    }

    // The cell path, which has to agree with what the canvas drew.
    const cells = [_][2]usize{ .{ 173, 28 }, .{ 74, 2 }, .{ 20, 25 }, .{ 88, 7 } };
    for (cells) |cell| {
        const found = widgets.countryAtCell(cell[0], cell[1], 200, 50, .{});
        const text = try std.fmt.bufPrint(&line, "cell:{d},{d} {s}\n", .{
            cell[0],
            cell[1],
            if (found) |c| c.name else "-",
        });
        try stdout.writeStreamingAll(init.io, text);
    }

    // And the projection itself, so a drift shows up as a number rather than as
    // a country that happens to still be right.
    const probes = [_][2]usize{ .{ 0, 0 }, .{ 99, 25 }, .{ 50, 13 } };
    for (probes) |cell| {
        const at = world.degreesAt(cell[0], cell[1], 100, 26, world.WORLD_X, world.WORLD_Y).?;
        const text = try std.fmt.bufPrint(&line, "degrees:{d},{d} {d:.4} {d:.4}\n", .{
            cell[0],
            cell[1],
            at.lon,
            at.lat,
        });
        try stdout.writeStreamingAll(init.io, text);
    }
}
