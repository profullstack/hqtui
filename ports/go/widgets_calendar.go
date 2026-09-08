package hqtui

import "strconv"

// A month, as a grid, with per-day styling.
//
// The dates are computed rather than read from a host calendar. Every language
// this library is ported to has a different date type — different epochs,
// different month numbering, different opinions about time zones — and a widget
// whose output depends on any of that cannot be held to a fixture. So the
// arithmetic is here, in terms every port already has: integers.

var MonthNames = [12]string{
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
}

// WeekdayNames are two letters each, so a week is exactly as wide as its days.
var WeekdayNames = [7]string{"Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"}

// Three cells a day, minus the separator the last column does not need.
const calendarDayWidth = 3

// CalendarWidth is the width a calendar wants, the same whatever month it shows.
const CalendarWidth = 7*calendarDayWidth - 1

// DaysInMonth reports how many days a month has. Months are 1-12, as people
// write them.
func DaysInMonth(year, month int) int {
	if month == 2 {
		if IsLeapYear(year) {
			return 29
		}
		return 28
	}
	// April, June, September, November.
	if month == 4 || month == 6 || month == 9 || month == 11 {
		return 30
	}
	return 31
}

// IsLeapYear is the Gregorian leap rule in full: every four years, except
// centuries, except every fourth century. Truncating it at "every four years"
// is right for 1901-2099 and wrong for 1900 and 2100, which is the kind of bug
// that sits quietly for decades.
func IsLeapYear(year int) bool {
	return year%4 == 0 && (year%100 != 0 || year%400 == 0)
}

// DayOfWeek returns the day of the week, 0 = Sunday.
//
// Sakamoto's method: a table of month offsets plus the leap-day count, which is
// exact for any Gregorian date and needs nothing but integer arithmetic.
func DayOfWeek(year, month, day int) int {
	offsets := [12]int{0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4}
	// January and February belong to the previous year for leap-counting, since
	// the leap day falls after them.
	y := year
	if month < 3 {
		y--
	}
	// floorDiv, not /: the leap count rounds towards negative infinity, and
	// Go's division truncates towards zero, which is off by one before year 1.
	leaps := floorDiv(y, 4) - floorDiv(y, 100) + floorDiv(y, 400)
	value := (y + leaps + offsets[month-1] + day) % 7
	return ((value % 7) + 7) % 7
}

type CalendarMark struct {
	// Day of the month, 1-31.
	Day        int
	Color      *Color
	Background *Color
	Bold       bool
}

type CalendarOptions struct {
	Year int
	// Month is 1-12, as people write months.
	Month int
	// Marks are days worth pointing at: holidays, deadlines, days with
	// something on.
	Marks []CalendarMark
	// Selected is drawn in the accent colour, as the day the view is about.
	Selected *int
	// NoHeader hides the month and year above the grid.
	NoHeader    bool
	HeaderAlign *Align
	// NoWeekdays hides the weekday initials above the days.
	NoWeekdays bool
	// WeekStart is 0 for Sunday, 1 for Monday. Nil means Monday, which is most
	// of the world -- a pointer because Go's zero value would otherwise decide
	// that for everyone, and decide it differently from the other ports.
	WeekStart  *int
	Color      *Color
	Background *Color
}

func (o CalendarOptions) valid() bool { return o.Month >= 1 && o.Month <= 12 }

// weekStart resolves the option: Monday unless the caller said otherwise.
func (o CalendarOptions) weekStart() int {
	if o.WeekStart != nil && *o.WeekStart == 0 {
		return 0
	}
	return 1
}

func (o CalendarOptions) startColumn() int {
	return (DayOfWeek(o.Year, o.Month, 1) - o.weekStart() + 7) % 7
}

// CalendarHeight reports how many rows a month needs, so a caller can size the
// panel around it.
//
// A month spans four, five or six week rows depending on where its first day
// falls; guessing five leaves some months a row short and others a blank row
// long.
func CalendarHeight(o CalendarOptions) int {
	if !o.valid() {
		return 0
	}
	cells := o.startColumn() + DaysInMonth(o.Year, o.Month)
	rows := (cells + 6) / 7
	if !o.NoHeader {
		rows++
	}
	if !o.NoWeekdays {
		rows++
	}
	return rows
}

func DrawCalendar(s Surface, o CalendarOptions) {
	if s.IsEmpty() || !o.valid() {
		return
	}
	theme := s.Theme
	base := theme.Foreground
	if o.Color != nil {
		base = *o.Color
	}
	bg := o.Background

	row := 0
	if !o.NoHeader {
		label := MonthNames[o.Month-1] + " " + strconv.Itoa(o.Year)
		width := s.Width()
		if width > CalendarWidth {
			width = CalendarWidth
		}
		align := AlignCenter
		if o.HeaderAlign != nil {
			align = *o.HeaderAlign
		}
		title := theme.Title
		attrs := AttrBold
		s.Text(0, row, Fit(label, width, align), TextOptions{Fg: &title, Bg: bg, Attrs: &attrs})
		row++
	}

	if !o.NoWeekdays {
		muted := theme.Muted
		for i := 0; i < 7; i++ {
			name := WeekdayNames[(i+o.weekStart())%7]
			s.Text(i*calendarDayWidth, row, name, TextOptions{Fg: &muted, Bg: bg})
		}
		row++
	}

	first := o.startColumn()
	total := DaysInMonth(o.Year, o.Month)

	for day := 1; day <= total; day++ {
		cell := first + day - 1
		y := row + cell/7
		if y >= s.Height() {
			break
		}
		x := (cell % 7) * calendarDayWidth

		var mark *CalendarMark
		for i := range o.Marks {
			if o.Marks[i].Day == day {
				mark = &o.Marks[i]
				break
			}
		}
		selected := o.Selected != nil && *o.Selected == day

		fg := base
		cellBg := bg
		attrs := AttrNone
		if mark != nil {
			if mark.Color != nil {
				fg = *mark.Color
			}
			if mark.Background != nil {
				cellBg = mark.Background
			}
			if mark.Bold {
				attrs = AttrBold
			}
		}
		if selected {
			fg = theme.Background
			accent := theme.Accent
			cellBg = &accent
			attrs = AttrBold
		}
		// Right-aligned in two cells, so the units column lines up down the week
		// and a calendar reads as a table rather than as a paragraph of numbers.
		s.Text(x, y, Fit(strconv.Itoa(day), 2, AlignRight), TextOptions{
			Fg: &fg, Bg: cellBg, Attrs: &attrs,
		})
	}
}
