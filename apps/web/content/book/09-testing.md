---
title: Testing a terminal UI
order: 9
summary: Rendering headlessly, asserting on cells rather than screenshots, and the traps.
---

A terminal UI is unusually easy to test, because the output is a grid of
characters and the renderer is a pure function of your state. There is no
browser, no pseudo-terminal, and no waiting.

## Render to a string

```ts
import { renderToText } from "@profullstack/hqtui";

const screen = renderToText(({ ui }) => dashboard(ui, state), { width: 80, height: 24 });
expect(screen).toContain("postgres");
```

That is the whole setup. `renderToText` runs the same code path the real
application does, so a layout bug shows up here exactly as it would on screen.

For anything beyond substring matching, take the screen object:

```ts
import { renderToScreen } from "@profullstack/hqtui";

const screen = renderToScreen(view, { width: 80, height: 24 });

screen.text();          // the whole grid, trailing spaces trimmed
screen.line(3);         // one row
screen.find("CPU");     // { x, y } or null
screen.cell(4, 3);      // { char, fg, bg, attrs }
screen.regions;         // the mouse regions widgets registered
screen.click(x, y);     // press there, exactly as the app would deliver it
screen.click(x, y, { clicks: 2 });   // a double-click
screen.scroll(x, y, 1); // turn the wheel over a cell
```

## Assert on meaning, not on pixels

The temptation is to snapshot the whole screen. Resist it for anything but the
smallest components. A full-screen snapshot fails when someone changes a
padding, so it gets regenerated without being read, and then it is not a test.

Prefer assertions that say what you meant:

```ts
// The selected row is highlighted, wherever it ended up.
const found = screen.find("postgres")!;
expect(screen.cell(0, found.y).bg).not.toBe(screen.cell(0, found.y + 1).bg);

// The value is right-aligned in its column.
expect(screen.line(2).endsWith("4.2 KB")).toBe(true);

// The wheel can actually reach the table.
expect(screen.regions.some((r) => r.id === "procs")).toBe(true);
```

That last one is worth calling out. A scroll handler that is never registered
because the widget was drawn in a zero-height region is invisible in a text
snapshot and obvious in `regions`.

`click` goes one step further and runs the same hit-test the app runs, so a
test can prove that the cell showing `F2 Theme` is the cell that changes the
theme, and that a click on a dialog's backdrop closes it without also
selecting the row it was drawn over:

```ts
const at = screen.find("Theme")!;
expect(screen.click(at.x, at.y)).toBe(true);
expect(state.themeIndex).toBe(1);
```

## Colour and attributes

`cell()` gives you the resolved colour, so you can assert that a value went
red without asserting on escape sequences:

```ts
const cell = screen.cell(screen.find("98%")!.x, screen.find("98%")!.y);
expect(cell.fg).toBe(theme.danger);
```

Compare against the theme's colour rather than a literal. A test containing
`0xff5555` is a test that fails when the palette is adjusted, for no reason.

## Animation and frames

```ts
import { renderFrames } from "@profullstack/hqtui";

const frames = renderFrames(view, 10, { width: 40, height: 8 });
expect(frames[0].text()).not.toBe(frames[9].text());
```

The frame number is passed to your view, so anything driven by it is
reproducible: frame 7 is always the same picture. Do not test animation by
sleeping.

## Degraded terminals

Force the capabilities rather than hoping:

```ts
const ascii = renderToText(view, {
  width: 80, height: 24,
  capabilities: { unicode: false, braille: false, colors: "16" },
});
expect(ascii).not.toMatch(/[⠀-⣿]/);   // no Braille survived
```

One test like this per project catches the whole class of "it is mojibake over
SSH from the build box".

## The traps

**Height matters more than you think.** A widget in a region of zero rows draws
nothing and throws nothing. If an assertion fails because the text is not
there, print `screen.text()` before assuming the widget is broken; nine times
out of ten the layout gave it no room.

**Trailing spaces are trimmed by `text()` and not by `line()`.** Comparing a
whole screen against a template literal fails on invisible whitespace forever.
Use `toContain`, or trim both sides deliberately.

**A wide character is two cells.** `screen.cell(x, y)` on the second half of a
CJK glyph or an emoji returns an empty `char`, not the character. That is
correct, and it means indexing by character offset into a line with emoji in it
will drift.

**The theme is resolved per render.** If you pass `theme: "light"` to one call
and compare colours against the dark theme's constants, everything fails in a
confusing way. Resolve the theme once in the test and use that object.
