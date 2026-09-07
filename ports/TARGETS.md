# Which language gets a port next

A port is a real commitment — it has to track the reference implementation
forever, or it rots and becomes a liability. So the decision is made on two
axes and written down, rather than on whoever shouted loudest.

**Speed** is what a language can do with the render loop. HQTUI's hot path is
narrow and boring: integer loops over four parallel arrays, a diff pass, and
string building. It does not allocate per cell and it does not touch the
network. So the axis is really "how much does the runtime cost me per frame at
200x50 cells, thirty times a second, on a laptop that is also doing something
else". Garbage collection matters more than raw throughput here, because a
100ms pause is a visible stutter in a dashboard and a dropped keystroke in an
editor.

**Community** is how many people would actually pick this up. The best single
signal is not language popularity — it is whether a *good TUI library already
exists* and has users. Competition is demand: ratatui and bubbletea and textual
all being large is the evidence that people want to build these things in Rust,
Go and Python. A language with no TUI library is either an open field or a
place nobody builds terminal UIs, and telling those apart is the judgement
call.

## Scoring

Speed, 1-5, for a 30fps loop:

| Tier | What it means | Languages |
|---|---|---|
| 5 | Native, no GC. Frame cost is the work itself. | Rust, Zig, C, C++, Odin, D |
| 4 | Native with GC or refcounting. Pauses are sub-frame in practice. | Go, Swift, Nim, Crystal, C# (NativeAOT) |
| 3 | JIT. Fast once warm; startup is the tax. | TypeScript (Bun/Node), C# (CoreCLR), Java, Kotlin, LuaJIT |
| 2 | Interpreted, but fast enough at these grid sizes. | Python, Ruby, Lua (PUC), PHP |
| 1 | Interpreted and slow enough that 30fps is a fight. | Bash, POSIX sh, Tcl |

Community, 1-5, weighted toward *terminal* work rather than language size:

| Score | Meaning |
|---|---|
| 5 | A dominant TUI library with a large user base, and a steady stream of new CLI tools. |
| 4 | A real TUI library with users, or a very large CLI community without one. |
| 3 | A TUI library exists but is niche; or a big language whose CLI story is thin. |
| 2 | Small community, some terminal interest. |
| 1 | Nobody is building terminal UIs here. |

## The table

| Language | Speed | Community | Existing TUI libraries | Status |
|---|---|---|---|---|
| Rust | 5 | 5 | ratatui, crossterm, cursive | **ported** |
| Go | 4 | 5 | bubbletea + lipgloss, tview, termui | **ported** |
| Python | 2 | 5 | textual, rich, urwid, blessed | **ported** |
| TypeScript | 3 | 5 | ink, blessed, hqtui | reference |
| Zig | 5 | 2 | libvaxis, and not much else | **ported** |
| C | 5 | 4 | ncurses, notcurses, termbox2 | **core in development** |
| C++ | 5 | 4 | btop, FTXUI, ncurses | **ten-screen demo available; library API experimental** |
| C# / .NET | 4 | 4 | Spectre.Console, Terminal.Gui | candidate |
| Swift | 4 | 3 | almost nothing serious | candidate |
| Lua | 2 | 3 | via neovim, not standalone | candidate |
| Ruby | 2 | 3 | tty-toolkit, curses | candidate |
| Nim | 4 | 2 | illwill | unlikely |
| Crystal | 4 | 2 | term-* shards | unlikely |
| Kotlin / Java | 3 | 3 | JLine, Lanterna | unlikely |
| PHP | 2 | 3 | symfony/console (not a TUI) | unlikely |
| Elixir | 3 | 2 | Ratatouille | unlikely |
| Haskell / OCaml | 4 | 2 | brick, notty | unlikely |
| Odin / V / D | 5 | 1 | none | no |

## Why C is next, ahead of larger communities

C scores 4 on community on its own merits, below C#. It is still the right next
port, because it is the only one whose score understates it: **a C port is the
FFI floor for every language that can call C**, which is nearly all of them.
Ruby, PHP, Lua, Perl, R, Julia, Swift, Crystal and Nim all have a C FFI and no
serious TUI library. One C port with a stable ABI makes all of them reachable
with a few hundred lines of binding each, instead of a few thousand lines of
port each.

That is a different kind of win from a native port, and worse in one specific
way — a binding is not idiomatic, and idiomatic is most of why anyone picks a
library. So C is the base for the long tail, not a replacement for the native
ports of languages people actually write CLIs in.

## On Rust being where everything is going

It is not wrong. The list of terminal tools that displaced a predecessor in the
last few years is close to all Rust: ripgrep over grep, fd over find, bat over
cat, eza over ls, zoxide over cd, starship over the shell prompt, atuin over
history, difftastic over diff, and — the one that says the most — uv and ruff
displacing Python's own tooling from underneath it, in Rust. Bun's rewrite is
the same current.

That is why Rust is the flagship port here and gets the most care. But it is
worth being precise about what the trend is: it is a trend in *tools shipped as
binaries*, not in *all terminal code*. The person writing a 200-line internal
dashboard for their team is still overwhelmingly writing it in Python or Go or
TypeScript, and will be for a long time, because the tool only has to start and
be correct — it does not have to be faster than grep. Both of those audiences
are real, and they want different things from a library. The ports are ordered
for the first group and sized for the second.

## Reading this as a plugin author

If you are deciding where to write something on top of HQTUI:

- **Reach for Rust** if the thing ships as a binary to people who are not you,
  and its speed is part of why they would switch to it.
- **Reach for Go** if you want the Rust answer without the Rust learning curve,
  and a single static binary is what you actually needed.
- **Reach for Python** if the thing exists to be read and edited by the team
  that runs it, and 30fps is a nice-to-have rather than the point.
- **Reach for Zig** if you are already writing Zig. It is the fastest of the
  four to start and has no runtime at all, but the ecosystem around it is
  small enough that you will be writing more of the supporting code yourself.
- **Reach for TypeScript** if you want the largest API surface and the most
  documentation, because it is the reference and everything lands there first.
