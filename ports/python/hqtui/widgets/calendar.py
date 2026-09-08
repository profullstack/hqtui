"""A month, as a grid, with per-day styling.

The dates are computed rather than read from a host calendar. Every language
this library is ported to has a different date type — different epochs,
different month numbering, different opinions about time zones — and a widget
whose output depends on any of that cannot be held to a fixture. So the
arithmetic is here, in terms every port already has: integers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from ..buffer import Attrs
from ..color import Color
from ..surface import Align, Surface, TextOptions
from ..unicode import fit

__all__ = [
    "CALENDAR_WIDTH",
    "CalendarMark",
    "CalendarOptions",
    "MONTH_NAMES",
    "WEEKDAY_NAMES",
    "calendar_height",
    "day_of_week",
    "days_in_month",
    "draw_calendar",
    "is_leap_year",
]

MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

#: Two letters each, so a week is exactly as wide as its days.
WEEKDAY_NAMES = ("Su", "Mo", "Tu", "We", "Th", "Fr", "Sa")

#: Three cells a day, minus the separator the last column does not need.
_DAY_WIDTH = 3
#: The width a calendar wants, which is the same whatever month it shows.
CALENDAR_WIDTH = 7 * _DAY_WIDTH - 1


def is_leap_year(year: int) -> bool:
    """The Gregorian leap rule in full: every four years, except centuries,
    except every fourth century.

    Truncating it at "every four years" is right for 1901-2099 and wrong for
    1900 and 2100, which is the kind of bug that sits quietly for decades.
    """
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def days_in_month(year: int, month: int) -> int:
    """How many days a month has. Months are 1-12, as people write them."""
    if month == 2:
        return 29 if is_leap_year(year) else 28
    # April, June, September, November.
    if month in (4, 6, 9, 11):
        return 30
    return 31


def day_of_week(year: int, month: int, day: int) -> int:
    """Day of the week, 0 = Sunday.

    Sakamoto's method: a table of month offsets plus the leap-day count, which
    is exact for any Gregorian date and needs nothing but integer arithmetic.
    """
    offsets = (0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4)
    # January and February belong to the previous year for leap-counting, since
    # the leap day falls after them.
    y = year - 1 if month < 3 else year
    leaps = y // 4 - y // 100 + y // 400
    return (y + leaps + offsets[month - 1] + day) % 7


@dataclass(frozen=True, slots=True)
class CalendarMark:
    #: Day of the month, 1-31.
    day: int = 0
    color: Color | None = None
    background: Color | None = None
    bold: bool = False


@dataclass(frozen=True, slots=True)
class CalendarOptions:
    year: int = 1970
    #: 1-12, as people write months.
    month: int = 1
    #: Days worth pointing at: holidays, deadlines, days with something on.
    marks: Sequence[CalendarMark] = ()
    #: Drawn in the accent colour, as the day the view is about.
    selected: int | None = None
    #: The month and year above the grid.
    header: bool = True
    header_align: Align = "center"
    #: The weekday initials above the days.
    weekdays: bool = True
    #: 0 for Sunday, 1 for Monday. Most of the world starts on Monday.
    week_start: int = 1
    color: Color | None = None
    background: Color | None = None

    @property
    def valid(self) -> bool:
        return 1 <= self.month <= 12

    @property
    def _week_start(self) -> int:
        return 0 if self.week_start == 0 else 1

    @property
    def start_column(self) -> int:
        return (day_of_week(self.year, self.month, 1) - self._week_start + 7) % 7


def calendar_height(options: CalendarOptions) -> int:
    """How many rows a month needs, so a caller can size the panel around it.

    A month spans four, five or six week rows depending on where its first day
    falls; guessing five leaves some months a row short and others a blank row
    long.
    """
    if not options.valid:
        return 0
    cells = options.start_column + days_in_month(options.year, options.month)
    weeks = -(-cells // 7)
    return weeks + int(options.header) + int(options.weekdays)


def draw_calendar(surface: Surface, options: CalendarOptions) -> None:
    if surface.empty or not options.valid:
        return
    theme = surface.theme
    base = options.color if options.color is not None else theme.foreground
    bg = options.background
    week_start = options._week_start

    row = 0
    if options.header:
        label = f"{MONTH_NAMES[options.month - 1]} {options.year}"
        width = min(surface.width, CALENDAR_WIDTH)
        surface.text(
            0, row, fit(label, width, options.header_align),
            TextOptions(fg=theme.title, bg=bg, attrs=Attrs.BOLD),
        )
        row += 1

    if options.weekdays:
        for i in range(7):
            name = WEEKDAY_NAMES[(i + week_start) % 7]
            surface.text(i * _DAY_WIDTH, row, name, TextOptions(fg=theme.muted, bg=bg))
        row += 1

    first = options.start_column
    total = days_in_month(options.year, options.month)
    marks = {mark.day: mark for mark in options.marks}

    for day in range(1, total + 1):
        cell = first + day - 1
        y = row + cell // 7
        if y >= surface.height:
            break
        x = (cell % 7) * _DAY_WIDTH

        mark = marks.get(day)
        if options.selected == day:
            style = TextOptions(fg=theme.background, bg=theme.accent, attrs=Attrs.BOLD)
        else:
            style = TextOptions(
                fg=mark.color if mark is not None and mark.color is not None else base,
                bg=mark.background if mark is not None and mark.background is not None else bg,
                attrs=Attrs.BOLD if mark is not None and mark.bold else Attrs.NONE,
            )
        # Right-aligned in two cells, so the units column lines up down the week
        # and a calendar reads as a table rather than as a paragraph of numbers.
        surface.text(x, y, fit(str(day), 2, "right"), style)
