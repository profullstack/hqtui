# Security Policy

## Supported versions

HQTUI is pre-1.0. Security fixes land on the latest published release.

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/profullstack/hqtui/security/advisories/new)
or by emailing security@profullstack.com. Do not open a public issue.

We aim to acknowledge reports within 72 hours.

## Threat model

HQTUI is a rendering library with a deliberately small attack surface:

- it makes **no network requests** and contains no telemetry
- it spawns **no subprocesses** and reads no files
- it has **zero runtime dependencies**

The realistic risks are therefore in what it *writes to your terminal*. Untrusted text
passed to a widget is measured and clipped, never re-emitted as control sequences — if
you find input that escapes a cell, corrupts the surrounding grid, or injects an escape
sequence into stdout, that is a security bug and we want to hear about it.

Concretely, the framebuffer is incapable of holding anything that steers a terminal
rather than drawing in it. `FrameBuffer.setCell` is the only path that writes a
character into the grid, and it rejects:

- **C0, DEL and C1** (`0x00`–`0x1f`, `0x7f`, `0x80`–`0x9f`). These are zero-width, so
  without an explicit rule they attach to the previous character like a combining mark
  and get written straight back out. `"user" + ESC + "[31m"` must not become a live SGR.
- **Bidi overrides, embeddings and isolates** (`U+202A`–`U+202E`, `U+2066`–`U+2069`),
  the Trojan Source set. They paint nothing but reorder everything around them, so
  `user<RLO>nimda` reads as `user admin` in a log pane. Directional *marks* (LRM/RLM)
  and real RTL script are left alone — those render honestly.

Two further limits keep a single cell honest about its size, because a cell that claims
one column while painting many desynchronises the cursor and corrupts the rest of the
row:

- ZWJ joins emoji and nothing else, so no input can glue arbitrary text into one cell.
- A cell holds at most 16 codepoints, and the cluster table is capped, so untrusted
  text cannot amplify bytes or grow the heap without bound.

`stripAnsi` is exported for callers who want to sanitise text themselves. It handles
8-bit C1 forms and CSI intermediate bytes, and removes anything left over, so its
output cannot steer a terminal even if a sequence form was missed.

Two consequences of these rules are worth stating plainly, because both are deliberate:

- **ZWJ outside emoji is dropped.** It legitimately requests conjunct forms in
  Devanagari, Sinhala and Arabic, and those ligatures are lost — each codepoint gets
  its own cell instead. Honouring it would mean letting a cell hold arbitrary joined
  text, which is the primitive that let one cell paint hundreds of columns. The
  previous behaviour was not correct either; it simply mis-declared the width.
- **Past 32768 distinct clusters, new ones degrade to their base character.** Cells
  hold an index into the cluster table, so entries can never be evicted while a
  framebuffer may still reference them; the alternative is unbounded heap growth
  driven by untrusted text. Combining marks are lost, the column is not.

In both cases the rule chosen is the one that keeps the grid in step with the screen.
A cell that lies about its width desynchronises the cursor and corrupts every cell
after it, which is a worse outcome than a missing ligature.

`@profullstack/hqtui-demo` does execute read-only system commands (`ps`, `df`,
`vm_stat`, PowerShell CIM queries) to collect real metrics. It never passes user input
to a shell.
