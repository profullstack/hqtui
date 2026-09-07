# Mise language expansion

C++ is the current priority. Its native ten-screen demo is implemented over the
shared C rendering core; the C++ API remains experimental. Existing TypeScript,
Rust, Go, Python and Zig demos are retained in this monorepo.

Mise's registry is a tool catalog, not a list of HQTUI implementations. Installing
a compiler does not create a native HQTUI library. An integration is not marked
ready until it has a runnable demo, real-data behavior, terminal cleanup tests,
the shared reference-frame gate and documented update-and-run commands.

## Verified registry candidates

The following runtime/tool IDs were checked with `mise registry` on 2026-09-07:

| Language/runtime family | Mise IDs | HQTUI status |
|---|---|---|
| TypeScript / JavaScript | bun, node, deno | Existing reference implementation |
| Rust, Go, Python, Zig | rust, go, python, zig | Existing native implementations |
| C++ | cmake (host GCC/Clang compiler required) | Native demo; experimental API |
| C# / F# / .NET | dotnet | Pending implementation strategy |
| Java / Kotlin / Scala / Clojure | java, kotlin, scala, clojure | Pending |
| Ruby, PHP, Perl | ruby, php, perl | Pending |
| Lua / LuaJIT | lua, luajit | Pending |
| Swift, Crystal, Odin, V | swift, crystal, odin, v | Pending |
| Elixir / Erlang / Gleam | elixir, erlang, gleam | Pending |
| Haskell, Julia, Dart | ghc, julia, dart | Pending |

This is a checked expansion inventory, not an exhaustive claim about third-party
mise plugins, future registry additions or completed HQTUI ports.

## Decision needed after C++

The user has been asked whether the remaining languages should bind the shared
C core or each maintain a separate implementation. C-core bindings can preserve
the native renderer's performance, but must be named and documented as bindings,
not independent native ports. Do not quietly launch another language's demo or
replay reference screenshots under a different command name.
