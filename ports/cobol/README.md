# COBOL

COBOL drives HQTUI without linking against it.

Every other port binds the library: the native ports are the library, and Ruby,
PHP and Perl reach a C ABI through FFI. COBOL does neither. It does the thing
COBOL has always been good at, which is writing fixed-width records, and an
adapter on the other side of the pipe reads them and draws the screen.

```
cobc -x -free examples/widgets.cbl -o build/widgets
./build/widgets | bun adapter/render.ts
```

or, for the same records rendered by the Rust port instead:

```
./build/widgets | cargo run --example cobol-bridge --manifest-path ../rust/Cargo.toml
```

Both produce byte-identical output, which is the point. The interface is a
record layout, not an API, so it belongs to no language and no runtime.

## The record

80 columns. Not nostalgia: it is the widest record that survives every COBOL
that has ever existed, mainframe included.

```cobol
01  SCENE-RECORD.
    05  SR-VERB   PIC X(9).   *> the instruction
    05  SR-KEY    PIC X(20).  *> a label, a level, an alignment
    05  SR-TEXT   PIC X(44).  *> content; "|" separates repeated fields
    05  SR-NUM    PIC X(7).   *> a number as text, so no locale can eat it
```

`WIDGET` starts a scene and names it. Everything after it belongs to that
scene until the next `WIDGET`.

| verb       | key              | text                            | num       |
| ---------- | ---------------- | ------------------------------- | --------- |
| `WIDGET`   | widget id        |                                 |           |
| `TEXT`     | `LEFT`/`CENTER`/`RIGHT` | the line                 |           |
| `LABEL`    |                  | the line                        |           |
| `HEADING`  |                  | the line                        |           |
| `DIVIDER`  |                  | optional label                  |           |
| `KEYVALUE` | label            | value                           |           |
| `COLUMN`   | alignment        | column title                    |           |
| `ROW`      |                  | cells joined by `\|`            |           |
| `SELECT`   |                  |                                 | row index |
| `LOG`      | level            | `time\|message\|meta`           |           |
| `METER`    | label            |                                 | 0-1 ratio |
| `GRAPHPT`  |                  |                                 | one point |
| `GAUGE`    |                  | label                           | 0-1 ratio |
| `LABEL`    |                  | the line, in the muted colour   |           |
| `HEADING`  |                  | the line, in the title colour   |           |
| `HISTBAR`  |                  |                                 | one column |
| `METERS`   |                  |                                 | grid columns |
| `MITEM`    | label            |                                 | 0-1 ratio |
| `DROPDOWN` | `OPEN`/`CLOSED`  | the current value               | box width |
| `OPTION`   |                  | one choice                      |           |
| `MODAL`    | title            |                                 | box width |
| `MTEXT`    |                  | one line of the message         |           |
| `MBUTTON`  | variant          | label                           | 1 if focused |
| `PALETTE`  | query            |                                 | selected row |
| `PITEM`    | hint             | label                           |           |
| `TOOLTIP`  | anchor `col\|row` | the text                       |           |

An unknown verb is an error rather than a silently skipped line, because a
batch job that quietly drops a record is how you end up trusting a wrong
screen.

`MODAL`, `PALETTE` and `TOOLTIP` are overlays: they draw over everything the
scene already put down, whatever order the records arrive in. `MBUTTON` uses
`1` for the focused button and `MITEM` a `0-1` ratio, because a fixed-width
record has no booleans and no floats — only text you agree how to read.

All twenty-eight widgets are reachable this way. Nothing here is a subset of
the library; it is the whole of it, described by a record.

## Why this is not a toy

A nightly COBOL job already produces exactly this shape: fixed records, one per
thing that happened. Pointing it at a terminal dashboard costs a `DISPLAY`
statement and no new dependency on the mainframe side. The adapter is the only
part that has to know what a Braille cell is.

## Coverage

Eight widgets: `text`, `divider`, `keyValues`, `table`, `log`, `meter`, `graph`
and `gauge`. The limit is the record layout, not the library. Adding
`sparkline` is a verb and four lines in each adapter.
