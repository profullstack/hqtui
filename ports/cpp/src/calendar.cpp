/// A month, as a grid, with per-day styling.
///
/// The dates are computed rather than read from a host calendar. Every language
/// this library is ported to has a different date type -- different epochs,
/// different month numbering, different opinions about time zones -- and a
/// widget whose output depends on any of that cannot be held to a fixture. So
/// the arithmetic is here, in terms every port already has: integers.
#include <hqtui/widgets.hpp>

namespace hqtui {
namespace {

/// Floor division. The leap count rounds towards negative infinity, and C++
/// integer division truncates towards zero -- which only differs before year 1,
/// but differs there every time.
long floor_div(long a, long b) {
  long q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0)))
    q--;
  return q;
}

long positive_mod(long a, long b) { return ((a % b) + b) % b; }

} // namespace

const char *const MONTH_NAMES[12] = {
    "January", "February", "March",     "April",   "May",      "June",
    "July",    "August",   "September", "October", "November", "December"};

const char *const WEEKDAY_NAMES[7] = {"Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"};

bool is_leap_year(long year) {
  return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
}

long days_in_month(long year, long month) {
  if (month == 2)
    return is_leap_year(year) ? 29 : 28;
  // April, June, September, November.
  if (month == 4 || month == 6 || month == 9 || month == 11)
    return 30;
  return 31;
}

long day_of_week(long year, long month, long day) {
  static const long offsets[12] = {0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4};
  // January and February belong to the previous year for leap-counting, since
  // the leap day falls after them.
  long y = month < 3 ? year - 1 : year;
  long leaps = floor_div(y, 4) - floor_div(y, 100) + floor_div(y, 400);
  return positive_mod(y + leaps + offsets[month - 1] + day, 7);
}

/// Three cells a day, minus the separator the last column does not need.
static constexpr int DAY_WIDTH = 3;

static bool calendar_valid(const Calendar &o) { return o.month >= 1 && o.month <= 12; }

static long calendar_week_start(const Calendar &o) { return o.week_start == 0 ? 0 : 1; }

static long calendar_start_column(const Calendar &o) {
  return positive_mod(day_of_week(o.year, o.month, 1) - calendar_week_start(o), 7);
}

int calendar_height(const Calendar &o) {
  if (!calendar_valid(o))
    return 0;
  long cells = calendar_start_column(o) + days_in_month(o.year, o.month);
  int weeks = int((cells + 6) / 7);
  return weeks + int(o.header) + int(o.weekdays);
}

void draw_calendar(Surface s, const Calendar &o) {
  int sw = s.rect().width, sh = s.rect().height;
  if (sw <= 0 || sh <= 0 || !calendar_valid(o))
    return;
  auto &t = theme(s);
  Color base = o.color ? o.color : t.foreground;
  long week_start = calendar_week_start(o);

  int row = 0;
  if (o.header) {
    std::string label = std::string(MONTH_NAMES[o.month - 1]) + " " + std::to_string(o.year);
    int lw = std::min(sw, CALENDAR_WIDTH);
    hqtui::text(s, 0, row, fit(label, lw, o.header_align), t.title, HQ_BOLD, o.background);
    row++;
  }

  if (o.weekdays) {
    for (int i = 0; i < 7; i++) {
      const char *name = WEEKDAY_NAMES[positive_mod(i + week_start, 7)];
      hqtui::text(s, i * DAY_WIDTH, row, name, t.muted, 0, o.background);
    }
    row++;
  }

  long first = calendar_start_column(o);
  long total = days_in_month(o.year, o.month);

  for (long day = 1; day <= total; day++) {
    long cell = first + day - 1;
    int y = row + int(cell / 7);
    if (y >= sh)
      break;
    int x = int(cell % 7) * DAY_WIDTH;

    const CalendarMark *mark = nullptr;
    for (auto &m : o.marks)
      if (m.day == day) {
        mark = &m;
        break;
      }
    bool selected = o.selected == day;

    Color fg = base;
    std::optional<Color> bg = o.background;
    int attrs = 0;
    if (mark) {
      if (mark->color)
        fg = mark->color;
      if (mark->background)
        bg = mark->background;
      if (mark->bold)
        attrs = HQ_BOLD;
    }
    if (selected) {
      fg = t.background;
      bg = t.accent;
      attrs = HQ_BOLD;
    }
    // Right-aligned in two cells, so the units column lines up down the week
    // and a calendar reads as a table rather than as a paragraph of numbers.
    hqtui::text(s, x, y, fit(std::to_string(day), 2, HQ_RIGHT, false), fg,
                std::uint16_t(attrs), bg);
  }
}

} // namespace hqtui
