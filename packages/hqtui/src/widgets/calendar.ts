/**
 * A month, as a grid, with per-day styling.
 *
 * The dates are computed rather than read from a host calendar. `Date` is a
 * different object in every language this library is ported to -- different
 * epochs, different month numbering, different opinions about time zones -- and
 * a widget whose output depends on any of that cannot be held to a fixture. So
 * the arithmetic is here, in terms every port already has: integers.
 */
import type { Surface, Align } from "../surface.ts";
import type { Style } from "../buffer.ts";
import { Attr } from "../buffer.ts";
import type { Color } from "../color.ts";
import { fit } from "../unicode.ts";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** Two letters each, so a week is exactly as wide as its days. */
export const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

/** How many days a month has. Months are 1-12, as people write them. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  // April, June, September, November.
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/**
 * The Gregorian leap rule in full: every four years, except centuries, except
 * every fourth century. Truncating it at "every four years" is right for
 * 1901-2099 and wrong for 1900 and 2100, which is the kind of bug that sits
 * quietly for decades.
 */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Day of the week, 0 = Sunday.
 *
 * Sakamoto's method: a table of month offsets plus the leap-day count, which
 * is exact for any Gregorian date and needs nothing but integer arithmetic.
 */
export function dayOfWeek(year: number, month: number, day: number): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  // January and February belong to the previous year for leap-counting, since
  // the leap day falls after them.
  const y = month < 3 ? year - 1 : year;
  const leaps = Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
  const value = (y + leaps + offsets[month - 1] + day) % 7;
  return ((value % 7) + 7) % 7;
}

export interface CalendarMark {
  /** Day of the month, 1-31. */
  day: number;
  color?: Color;
  background?: Color;
  bold?: boolean;
}

export interface CalendarOptions {
  year: number;
  /** 1-12, as people write months rather than as `Date` numbers them. */
  month: number;
  /** Days worth pointing at: holidays, deadlines, days with something on. */
  marks?: CalendarMark[];
  /** Drawn in the accent colour, as the day the view is about. */
  selected?: number;
  /** The month and year above the grid. Default true. */
  header?: boolean;
  headerAlign?: Align;
  /** The weekday initials above the days. Default true. */
  weekdays?: boolean;
  /** 0 for Sunday, 1 for Monday. Default 1, which is most of the world. */
  weekStart?: 0 | 1;
  color?: Color;
  background?: Color;
}

/** Three cells a day, minus the separator the last column does not need. */
const DAY_WIDTH = 3;
const GRID_WIDTH = 7 * DAY_WIDTH - 1;

export function drawCalendar(surface: Surface, options: CalendarOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const { year, month } = options;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return;

  const base = options.color ?? theme.foreground;
  const bg = options.background;
  const weekStart = options.weekStart === 0 ? 0 : 1;
  const marks = new Map<number, CalendarMark>();
  for (const mark of options.marks ?? []) marks.set(mark.day, mark);

  let row = 0;
  if (options.header !== false) {
    const label = `${MONTH_NAMES[month - 1]} ${year}`;
    const width = Math.min(surface.width, GRID_WIDTH);
    surface.text(0, row, fit(label, width, options.headerAlign ?? "center"), {
      fg: theme.title,
      bg,
      attrs: Attr.Bold,
    });
    row++;
  }

  if (options.weekdays !== false) {
    let x = 0;
    for (let i = 0; i < 7; i++) {
      const name = WEEKDAY_NAMES[(i + weekStart) % 7];
      surface.text(x, row, name, { fg: theme.muted, bg });
      x += DAY_WIDTH;
    }
    row++;
  }

  // Which column the 1st falls in, once the week has been rotated to start
  // where the caller asked.
  const first = (dayOfWeek(year, month, 1) - weekStart + 7) % 7;
  const total = daysInMonth(year, month);

  for (let day = 1; day <= total; day++) {
    const cell = first + day - 1;
    const y = row + Math.floor(cell / 7);
    if (y >= surface.height) break;
    const x = (cell % 7) * DAY_WIDTH;

    const mark = marks.get(day);
    const selected = options.selected === day;
    const style: Style = {
      fg: selected ? theme.background : mark?.color ?? base,
      bg: selected ? theme.accent : mark?.background ?? bg,
      attrs: selected || mark?.bold ? Attr.Bold : 0,
    };
    // Right-aligned in two cells, so the units column lines up down the week
    // and a calendar reads as a table rather than as a paragraph of numbers.
    surface.text(x, y, fit(String(day), 2, "right"), style);
  }
}

/**
 * How many rows a month needs, so a caller can size the panel around it.
 *
 * A month spans four, five or six week rows depending on where its first day
 * falls; guessing five leaves February 2026 a row short in some years and a
 * blank row long in others.
 */
export function calendarHeight(options: CalendarOptions): number {
  const { year, month } = options;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 0;
  const weekStart = options.weekStart === 0 ? 0 : 1;
  const first = (dayOfWeek(year, month, 1) - weekStart + 7) % 7;
  const weeks = Math.ceil((first + daysInMonth(year, month)) / 7);
  return weeks + (options.header === false ? 0 : 1) + (options.weekdays === false ? 0 : 1);
}

/** The width a calendar wants, which is the same whatever month it shows. */
export const CALENDAR_WIDTH = GRID_WIDTH;
