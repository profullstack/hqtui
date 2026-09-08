import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToScreen } from "../src/index.ts";
import {
  calendarHeight, dayOfWeek, daysInMonth, drawCalendar, isLeapYear,
} from "../src/widgets/calendar.ts";
import type { CalendarOptions } from "../src/widgets/calendar.ts";

const rows = (options: CalendarOptions, width = 20, height = 10): string[] =>
  renderToScreen(({ ui }) => ui.calendar(options), { width, height })
    .text().split("\n").map((line) => line.trimEnd());

test("calendar: the leap rule is the whole rule, not every fourth year", () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2025), false);
  // The two cases a truncated rule gets wrong, and gets wrong for a century.
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(2100), false);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
});

test("calendar: month lengths", () => {
  assert.deepEqual(
    Array.from({ length: 12 }, (_, i) => daysInMonth(2025, i + 1)),
    [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
  );
});

test("calendar: the weekday arithmetic agrees with known dates", () => {
  // 0 is Sunday. Checked against dates anyone can verify.
  assert.equal(dayOfWeek(2000, 1, 1), 6, "1 Jan 2000 was a Saturday");
  assert.equal(dayOfWeek(1970, 1, 1), 4, "the Unix epoch was a Thursday");
  assert.equal(dayOfWeek(2026, 9, 8), 2, "8 Sep 2026 is a Tuesday");
  // A leap day, and the day after it.
  assert.equal(dayOfWeek(2024, 2, 29), 4);
  assert.equal(dayOfWeek(2024, 3, 1), 5);
});

test("calendar: the host's Date is never consulted", () => {
  // Every port has a different one, so agreement across six of them is only
  // possible if none of them asks. This checks the TS side keeps that bargain.
  const source = new URL("../src/widgets/calendar.ts", import.meta.url);
  const text = readFileSync(source, "utf8");
  assert.ok(!/\bnew Date\b|Date\.now/.test(text), "calendar.ts reached for Date");
});

test("calendar: a month starts in the right column", () => {
  // September 2026 starts on a Tuesday, so with weeks starting Monday the 1st
  // sits in the second column: two cells in.
  const out = rows({ year: 2026, month: 9 });
  assert.equal(out[0].trim(), "September 2026");
  assert.equal(out[1], "Mo Tu We Th Fr Sa Su");
  assert.equal(out[2], "    1  2  3  4  5  6");
});

test("calendar: the week can start on Sunday instead", () => {
  const out = rows({ year: 2026, month: 9, weekStart: 0 });
  assert.equal(out[1], "Su Mo Tu We Th Fr Sa");
  // The same Tuesday is now the third column.
  assert.equal(out[2], "       1  2  3  4  5");
});

test("calendar: the last day of the month is the last day drawn", () => {
  const out = rows({ year: 2026, month: 9 }).filter((line) => line.length > 0);
  const last = out[out.length - 1];
  assert.ok(last.includes("30"), `expected the 30th: ${JSON.stringify(last)}`);
  assert.ok(!last.includes("31"), "September has no 31st");
});

test("calendar: February in a leap year shows the 29th", () => {
  const out = rows({ year: 2024, month: 2 }).join("\n");
  assert.ok(out.includes("29"), out);
  const plain = rows({ year: 2025, month: 2 }).join("\n");
  assert.ok(!plain.includes("29"), plain);
});

test("calendar: height is the month's own, not a guess of five weeks", () => {
  // February 2026 starts on a Sunday and has 28 days, so with weeks starting
  // Monday it needs five rows; reserving five for every month is wrong in both
  // directions across a year.
  const heights = Array.from({ length: 12 }, (_, i) =>
    calendarHeight({ year: 2026, month: i + 1 }));
  assert.ok(new Set(heights).size > 1, `every month the same height: ${heights}`);
  for (const [i, h] of heights.entries()) {
    const drawn = rows({ year: 2026, month: i + 1 }, 20, 12).filter((l) => l.length > 0).length;
    assert.equal(h, drawn, `month ${i + 1}: reserved ${h}, drew ${drawn}`);
  }
});

test("calendar: the header and weekday rows can be turned off", () => {
  const bare = rows({ year: 2026, month: 9, header: false, weekdays: false });
  assert.equal(bare[0], "    1  2  3  4  5  6");
  assert.equal(calendarHeight({ year: 2026, month: 9, header: false, weekdays: false }), 5);
});

test("calendar: a nonsense month draws nothing rather than something wrong", () => {
  for (const month of [0, 13, -1]) {
    const out = renderToScreen(
      ({ ui }) => drawCalendar(ui.surface, { year: 2026, month }),
      { width: 20, height: 8 },
    ).text().trim();
    assert.equal(out, "", `month ${month} drew something`);
    assert.equal(calendarHeight({ year: 2026, month }), 0);
  }
});

test("calendar: marks and the selected day are styled apart from the rest", () => {
  const screen = renderToScreen(
    ({ ui, theme }) => ui.calendar({
      year: 2026,
      month: 9,
      selected: 8,
      marks: [{ day: 15, color: theme.danger }],
    }),
    { width: 20, height: 10 },
  );
  const plain = renderToScreen(({ ui }) => ui.calendar({ year: 2026, month: 9 }), {
    width: 20,
    height: 10,
  });
  // The characters are identical; only the colours differ.
  assert.equal(screen.text(), plain.text());
  assert.notEqual(screen.buffer.fg.join(","), plain.buffer.fg.join(","));
});
