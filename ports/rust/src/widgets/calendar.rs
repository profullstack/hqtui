//! A month, as a grid, with per-day styling.
//!
//! The dates are computed rather than read from a host calendar. Every language
//! this library is ported to has a different date type -- different epochs,
//! different month numbering, different opinions about time zones -- and a
//! widget whose output depends on any of that cannot be held to a fixture. So
//! the arithmetic is here, in terms every port already has: integers.

use crate::buffer::{Attrs, Style};
use crate::color::Color;
use crate::surface::{Surface, TextOptions};
use crate::unicode::{fit, Align};

pub const MONTH_NAMES: [&str; 12] = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December",
];

/// Two letters each, so a week is exactly as wide as its days.
pub const WEEKDAY_NAMES: [&str; 7] = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/// Three cells a day, minus the separator the last column does not need.
const DAY_WIDTH: usize = 3;
/// The width a calendar wants, which is the same whatever month it shows.
pub const CALENDAR_WIDTH: usize = 7 * DAY_WIDTH - 1;

/// How many days a month has. Months are 1-12, as people write them.
pub fn days_in_month(year: i64, month: i64) -> i64 {
    if month == 2 {
        return if is_leap_year(year) { 29 } else { 28 };
    }
    // April, June, September, November.
    if month == 4 || month == 6 || month == 9 || month == 11 {
        return 30;
    }
    31
}

/// The Gregorian leap rule in full: every four years, except centuries, except
/// every fourth century. Truncating it at "every four years" is right for
/// 1901-2099 and wrong for 1900 and 2100, which is the kind of bug that sits
/// quietly for decades.
pub fn is_leap_year(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

/// Day of the week, 0 = Sunday.
///
/// Sakamoto's method: a table of month offsets plus the leap-day count, which
/// is exact for any Gregorian date and needs nothing but integer arithmetic.
pub fn day_of_week(year: i64, month: i64, day: i64) -> i64 {
    const OFFSETS: [i64; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    // January and February belong to the previous year for leap-counting, since
    // the leap day falls after them.
    let y = if month < 3 { year - 1 } else { year };
    let leaps = y.div_euclid(4) - y.div_euclid(100) + y.div_euclid(400);
    let value = (y + leaps + OFFSETS[(month - 1) as usize] + day) % 7;
    ((value % 7) + 7) % 7
}

#[derive(Clone, Copy, Debug, Default)]
pub struct CalendarMark {
    /// Day of the month, 1-31.
    pub day: i64,
    pub color: Option<Color>,
    pub background: Option<Color>,
    pub bold: bool,
}

#[derive(Clone, Debug)]
pub struct CalendarOptions {
    pub year: i64,
    /// 1-12, as people write months.
    pub month: i64,
    /// Days worth pointing at: holidays, deadlines, days with something on.
    pub marks: Vec<CalendarMark>,
    /// Drawn in the accent colour, as the day the view is about.
    pub selected: Option<i64>,
    /// The month and year above the grid.
    pub header: bool,
    pub header_align: Option<Align>,
    /// The weekday initials above the days.
    pub weekdays: bool,
    /// 0 for Sunday, 1 for Monday. Most of the world starts on Monday.
    pub week_start: i64,
    pub color: Option<Color>,
    pub background: Option<Color>,
}

impl Default for CalendarOptions {
    fn default() -> CalendarOptions {
        CalendarOptions {
            year: 1970,
            month: 1,
            marks: Vec::new(),
            selected: None,
            header: true,
            header_align: None,
            weekdays: true,
            week_start: 1,
            color: None,
            background: None,
        }
    }
}

impl CalendarOptions {
    pub fn new(year: i64, month: i64) -> CalendarOptions {
        CalendarOptions { year, month, ..Default::default() }
    }

    fn valid(&self) -> bool {
        (1..=12).contains(&self.month)
    }

    fn start_column(&self) -> i64 {
        let week_start = if self.week_start == 0 { 0 } else { 1 };
        (day_of_week(self.year, self.month, 1) - week_start + 7) % 7
    }
}

/// How many rows a month needs, so a caller can size the panel around it.
///
/// A month spans four, five or six week rows depending on where its first day
/// falls; guessing five leaves some months a row short and others a blank row
/// long.
pub fn calendar_height(options: &CalendarOptions) -> usize {
    if !options.valid() {
        return 0;
    }
    let cells = options.start_column() + days_in_month(options.year, options.month);
    let weeks = (cells + 6) / 7;
    (weeks as usize) + usize::from(options.header) + usize::from(options.weekdays)
}

pub fn draw_calendar(surface: &Surface, options: &CalendarOptions) {
    if surface.is_empty() || !options.valid() {
        return;
    }
    let theme = surface.theme.clone();
    let base = options.color.unwrap_or(theme.foreground);
    let bg = options.background;
    let week_start = if options.week_start == 0 { 0 } else { 1 };

    let mut row = 0isize;
    if options.header {
        let label = format!("{} {}", MONTH_NAMES[(options.month - 1) as usize], options.year);
        let width = surface.width().min(CALENDAR_WIDTH);
        surface.text(
            0,
            row,
            &fit(&label, width, options.header_align.unwrap_or(Align::Center)),
            &TextOptions::from(Style {
                fg: Some(theme.title),
                bg,
                attrs: Some(Attrs::BOLD),
            }),
        );
        row += 1;
    }

    if options.weekdays {
        for i in 0..7i64 {
            let name = WEEKDAY_NAMES[((i + week_start) % 7) as usize];
            surface.text(
                (i as usize * DAY_WIDTH) as isize,
                row,
                name,
                &TextOptions::from(Style { fg: Some(theme.muted), bg, attrs: None }),
            );
        }
        row += 1;
    }

    let first = options.start_column();
    let total = days_in_month(options.year, options.month);

    for day in 1..=total {
        let cell = first + day - 1;
        let y = row + (cell / 7) as isize;
        if y >= surface.height() as isize {
            break;
        }
        let x = ((cell % 7) as usize * DAY_WIDTH) as isize;

        let mark = options.marks.iter().find(|m| m.day == day);
        let selected = options.selected == Some(day);
        let style = Style {
            fg: Some(if selected {
                theme.background
            } else {
                mark.and_then(|m| m.color).unwrap_or(base)
            }),
            bg: if selected { Some(theme.accent) } else { mark.and_then(|m| m.background).or(bg) },
            attrs: Some(if selected || mark.is_some_and(|m| m.bold) {
                Attrs::BOLD
            } else {
                Attrs::default()
            }),
        };
        // Right-aligned in two cells, so the units column lines up down the week
        // and a calendar reads as a table rather than as a paragraph of numbers.
        surface.text(x, y, &fit(&day.to_string(), 2, Align::Right), &TextOptions::from(style));
    }
}
