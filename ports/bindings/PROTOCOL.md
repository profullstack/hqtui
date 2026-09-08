# Scene batch protocol (experimental ABI 1)

`hqb_set(scene, utf8_json, byte_length)` accepts one root widget object. No eval,
file paths, external commands, or language callbacks are interpreted. Input is
limited to 1 MiB, 4096 widget nodes and 32 widget nesting levels. The underlying
JSON parser also rejects duplicate keys and non-finite numbers.

Scene dimensions: 1–500 columns × 1–200 rows. Themes are the existing nine HQTUI
themes. Returned text is borrowed; each binding copies it into a runtime string.
Scenes are single-thread-owned. Only one native terminal/demo may be acquired per
process. Explicit close plus language cleanup releases it; SIGKILL cannot restore
a terminal. Do not serialize, clone or transfer native handles between threads.

| Widget `type` | Fields |
|---|---|
| `row`, `col` | `children` (array), `gap` (0–100) |
| `panel` | `title`, `subtitle`, `children` |
| `text` | `text`, `color`, `align` (0 left / 1 center / 2 right), `attrs` (C ABI bitmask) |
| `meter`, `gauge` | `value` (0–1), `label`; meter also accepts `color` |
| `graph` | `values` (number array), `min`, `max`, `color` |
| `table` | `columns` (string array), `rows` (arrays of values), `selected`, `offset` |
| `keys` | `rows` (label/value pairs), `color` |
| `log` | `entries` (`time`, `level`, `message`, `meta`), `offset` |
| `divider` | `text` |
| `spacer` | `size` |
| `label`, `heading` | `text`, `color`, `align`, `attrs`; default to the theme's muted and title colors |
| `badge` | `text`, `color`, `variant` (0 filled / 1 outline / 2 dot), `align` |
| `progress` | `value`, `max`, `label`, `count` (show the readout) |
| `sparkline` | `values`, `label`, `text`, `color`, `min`, `max` |
| `heatbar` | `value`, `color` |
| `columns` | `values`, `color`, `max` |
| `donut` | `segments` (`value`, `label`, `color`) |
| `meters` | `items` (`label`, `value`, `max`, `color`, `text`), `columns` (1–16), `labelWidth`, `valueWidth`, `style` (0 smooth / 1 segmented / 2 ascii), `gap` |
| `list` | `items`, `selected`, `bullet`, `offset`, `id` |
| `tree` | `nodes` (`label`, `children`), `selected`, `offset`, `id` |
| `button` | `label`, `variant` (0 primary / 1 success / 2 warning / 3 danger / 4 ghost), `focused`, `disabled` |
| `checkbox` | `label`, `checked`, `focused`, `variant` (0 box / 1 switch / 2 radio) |
| `select` | `value`, `options` (string array), `selected`, `open`, `focused` |
| `input` | `value`, `placeholder`, `label`, `focused`, `password` |
| `tabs` | `tabs`, `active` |
| `statusbar` | `items` (`key`, `label`), `right` |
| `modal` | `title`, `message`, `width`, `height`, `backdrop`, `align`, `buttons` (`label`, `variant`, `focused`) |
| `commandpalette` | `query`, `placeholder`, `items` (`label`, `hint`), `selected`, `width`, `height` |
| `tooltip` | `text`, `x`, `y`, `color` |

`modal`, `commandpalette` and `tooltip` are overlays. They are collected while
the tree is walked and drawn over the finished frame, so one declared inside a
narrow panel still lands on the screen rather than inside that panel. Their
content is data — a title, a message, buttons — because a scene crosses the ABI
as JSON; a dialog whose body is an arbitrary container of other widgets needs a
native port.

`size` is an optional fixed extent in the parent's layout direction. Otherwise
containers/graphs/tables/logs share remaining space. Text and meters normally
occupy one row. Key/value lists size to their row count. Colors accept `#rrggbb`
or `primary`, `secondary`, `accent`, `muted`, `success`, `warning`, `danger`,
`foreground`. Unsupported widget types and invalid rendered options raise a
language exception. The previous scene tree survives a rejected update.

`render('text')` returns UTF-8 rows with newlines; `ansi` emits a full frame and
`diff` emits changes against the last rendered frame. Do not interleave snapshot
rendering with terminal presentation without forcing a fresh full frame. `hashes`
is an inspection/testing format, not a persistent application protocol.

`demo_frame(screen, format)` renders the shared deterministic sample body, useful
for acceptance tests. `demo(arguments)` synchronously runs the shared interactive
or snapshot demo inside the calling runtime. It is not a general callback-driven
application API; build custom applications with Scene and the language builder.
