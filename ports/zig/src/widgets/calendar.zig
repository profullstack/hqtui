//! A month, as a grid, with per-day styling.
//!
//! The dates are computed rather than read from a host calendar. Every language
//! this library is ported to has a different date type -- different epochs,
//! different month numbering, different opinions about time zones -- and a
//! widget whose output depends on any of that cannot be held to a fixture. So
//! the arithmetic is here, in terms every port already has: integers.

const std = @import("std");

const buffer_mod = @import("../buffer.zig");
const color_mod = @import("../color.zig");
const surface_mod = @import("../surface.zig");
const unicode = @import("../unicode.zig");

const Attrs = buffer_mod.Attrs;
const Color = color_mod.Color;
const Surface = surface_mod.Surface;

pub const MONTH_NAMES = [_][]const u8{
    "January", "February", "March",     "April",   "May",      "June",
    "July",    "August",   "September", "October", "November", "December",
};

/// Two letters each, so a week is exactly as wide as its days.
pub const WEEKDAY_NAMES = [_][]const u8{ "Su", "Mo", "Tu", "We", "Th", "Fr", "Sa" };

/// Three cells a day, minus the separator the last column does not need.
const DAY_WIDTH: usize = 3;
/// The width a calendar wants, which is the same whatever month it shows.
pub const CALENDAR_WIDTH: usize = 7 * DAY_WIDTH - 1;

/// The Gregorian leap rule in full: every four years, except centuries, except
/// every fourth century. Truncating it at "every four years" is right for
/// 1901-2099 and wrong for 1900 and 2100, which is the kind of bug that sits
/// quietly for decades.
pub fn isLeapYear(year: i64) bool {
    return @mod(year, 4) == 0 and (@mod(year, 100) != 0 or @mod(year, 400) == 0);
}

/// How many days a month has. Months are 1-12, as people write them.
pub fn daysInMonth(year: i64, month: i64) i64 {
    if (month == 2) return if (isLeapYear(year)) 29 else 28;
    // April, June, September, November.
    if (month == 4 or month == 6 or month == 9 or month == 11) return 30;
    return 31;
}

/// Day of the week, 0 = Sunday.
///
/// Sakamoto's method: a table of month offsets plus the leap-day count, which
/// is exact for any Gregorian date and needs nothing but integer arithmetic.
pub fn dayOfWeek(year: i64, month: i64, day: i64) i64 {
    const offsets = [_]i64{ 0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4 };
    // January and February belong to the previous year for leap-counting, since
    // the leap day falls after them.
    const y = if (month < 3) year - 1 else year;
    // Floor division, not truncation: the leap count rounds towards negative
    // infinity, which only differs before year 1 but differs there every time.
    const leaps = @divFloor(y, 4) - @divFloor(y, 100) + @divFloor(y, 400);
    return @mod(y + leaps + offsets[@intCast(month - 1)] + day, 7);
}

pub const CalendarMark = struct {
    /// Day of the month, 1-31.
    day: i64 = 0,
    color: ?Color = null,
    background: ?Color = null,
    bold: bool = false,
};

pub const CalendarOptions = struct {
    year: i64 = 1970,
    /// 1-12, as people write months.
    month: i64 = 1,
    /// Days worth pointing at: holidays, deadlines, days with something on.
    marks: []const CalendarMark = &.{},
    /// Drawn in the accent colour, as the day the view is about.
    selected: ?i64 = null,
    /// The month and year above the grid.
    header: bool = true,
    header_align: unicode.Align = .center,
    /// The weekday initials above the days.
    weekdays: bool = true,
    /// 0 for Sunday, 1 for Monday. Most of the world starts on Monday.
    week_start: i64 = 1,
    color: ?Color = null,
    background: ?Color = null,

    fn valid(self: CalendarOptions) bool {
        return self.month >= 1 and self.month <= 12;
    }

    fn weekStart(self: CalendarOptions) i64 {
        return if (self.week_start == 0) 0 else 1;
    }

    fn startColumn(self: CalendarOptions) i64 {
        return @mod(dayOfWeek(self.year, self.month, 1) - self.weekStart() + 7, 7);
    }
};

/// How many rows a month needs, so a caller can size the panel around it.
///
/// A month spans four, five or six week rows depending on where its first day
/// falls; guessing five leaves some months a row short and others a blank row
/// long.
pub fn calendarHeight(options: CalendarOptions) usize {
    if (!options.valid()) return 0;
    const cells = options.startColumn() + daysInMonth(options.year, options.month);
    const weeks: usize = @intCast(@divFloor(cells + 6, 7));
    return weeks + @intFromBool(options.header) + @intFromBool(options.weekdays);
}

pub fn drawCalendar(s: Surface, options: CalendarOptions) void {
    if (s.isEmpty() or !options.valid()) return;
    const theme = s.theme;
    const base = options.color orelse theme.foreground;
    const bg = options.background;
    const week_start = options.weekStart();

    var row: isize = 0;
    if (options.header) {
        var label_buf: [64]u8 = undefined;
        const label = std.fmt.bufPrint(&label_buf, "{s} {d}", .{
            MONTH_NAMES[@intCast(options.month - 1)],
            options.year,
        }) catch MONTH_NAMES[@intCast(options.month - 1)];
        const width = @min(s.width(), CALENDAR_WIDTH);
        var padded: [128]u8 = undefined;
        _ = s.text(
            0,
            row,
            unicode.fit(&padded, label, width, options.header_align),
            .{ .fg = theme.title, .bg = bg, .attrs = Attrs{ .bold = true } },
        );
        row += 1;
    }

    if (options.weekdays) {
        for (0..7) |i| {
            const name = WEEKDAY_NAMES[@intCast(@mod(@as(i64, @intCast(i)) + week_start, 7))];
            _ = s.text(@intCast(i * DAY_WIDTH), row, name, .{ .fg = theme.muted, .bg = bg });
        }
        row += 1;
    }

    const first = options.startColumn();
    const total = daysInMonth(options.year, options.month);

    var day: i64 = 1;
    while (day <= total) : (day += 1) {
        const cell = first + day - 1;
        const y = row + @as(isize, @intCast(@divFloor(cell, 7)));
        if (y >= @as(isize, @intCast(s.height()))) break;
        const x: isize = @intCast(@as(usize, @intCast(@mod(cell, 7))) * DAY_WIDTH);

        var mark: ?CalendarMark = null;
        for (options.marks) |m| {
            if (m.day == day) {
                mark = m;
                break;
            }
        }
        const selected = options.selected != null and options.selected.? == day;

        var fg = base;
        var cell_bg = bg;
        var attrs = Attrs.none;
        if (mark) |m| {
            if (m.color) |c| fg = c;
            if (m.background) |c| cell_bg = c;
            if (m.bold) attrs = Attrs{ .bold = true };
        }
        if (selected) {
            fg = theme.background;
            cell_bg = theme.accent;
            attrs = Attrs{ .bold = true };
        }

        var number: [8]u8 = undefined;
        const text = std.fmt.bufPrint(&number, "{d}", .{day}) catch "?";
        var padded_day: [16]u8 = undefined;
        // Right-aligned in two cells, so the units column lines up down the week
        // and a calendar reads as a table rather than as a paragraph of numbers.
        _ = s.text(x, y, unicode.fit(&padded_day, text, 2, .right), .{
            .fg = fg,
            .bg = cell_bg,
            .attrs = attrs,
        });
    }
}
