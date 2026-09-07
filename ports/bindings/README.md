# Shared native bindings: Ruby, PHP, Perl

Experimental bindings, not independent renderer ports. Custom applications build
widget trees in their own language; a versioned C ABI parses a bounded batch and
uses the C++ layout/widgets plus the C11 framebuffer/diff renderer. The JSON tree
is retained and only reparsed on `set`, not on every render. No per-cell FFI calls,
JSON subprocess pipe, JavaScript runtime or child demo executable is involved.

Ruby uses Fiddle. Perl uses FFI::Platypus. PHP prefers a tiny compiled Zend adapter
to the same C ABI (so FFI need not be enabled); an FFI path is available otherwise.
The full ten-screen example calls the shared C++ demo **inside the language VM**,
including its Linux collectors, responsive layouts, input and terminal loop.
This explicit reuse is how demo fixes reach all three bindings together.

## Launch latest

```sh
curl -fsSL https://hqtui.com/demo.sh | sh -s -- --mise ruby
curl -fsSL https://hqtui.com/demo.sh | sh -s -- --mise php
curl -fsSL https://hqtui.com/demo.sh | sh -s -- --mise perl
```

Replace `--mise` with `--system` for installed runtimes/build tools. Every launch
fetches current main and prints the source revision. First builds compile native
code; later launches reuse that revision. Host GCC/Clang and Make are required.
Build scratch also lives under the demo cache, so a separate `/tmp` quota does
not break linking. Failed builds are retried; they never get a ready marker.
Mise supplies pinned CMake and runtimes; PHP uses `conda:php` prebuilt packages.
Vanilla additionally requires CMake, Ruby Fiddle, Perl cpanm (if Platypus is missing),
and PHP development headers/php-config or enabled FFI. Perl dependencies go in a
private ABI-keyed cache, never into the global Perl installation.

Linux/macOS terminals are supported; live data requires Linux, with sample mode
defaulting on macOS. Use `--sim`, `--snapshot`, `--screen traffic`, and 1–9/0/Tab.
Host permissions and available utilities determine actual live rows.

## Build locally

```sh
cmake -S ports/cpp -B ports/cpp/build-bindings \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF \
  -DHQTUI_BUILD_BINDINGS=ON
cmake --build ports/cpp/build-bindings --target hqtui_bindings --parallel 2
ruby ports/ruby/examples/hello.rb
```

For the PHP native adapter, add `-DHQTUI_PHP_CONFIG=/absolute/path/to/php-config`
matching the PHP binary, then build target `hqtui_php`. Run PHP with
`-d extension=/absolute/path/to/build-bindings/hqtui_php.so`. This flag is scoped
to the current invocation and does not edit php.ini. Without the adapter, PHP
must provide its FFI extension and permit CLI FFI calls.

The loaders find this conventional checkout build or use `HQTUI_NATIVE_LIB` to
select an explicitly installed shared library. Copying a binding package alone
does not install the engine. RubyGems/Composer/CPAN metadata is included, but these
new packages have **not** been published to those registries.

## API and tests

- [Ruby example](../ruby/examples/hello.rb), [PHP example](../php/examples/hello.php), [Perl example](../perl/examples/hello.pl).
- `Scene.set(tree)` sends a batch; `render` returns text, full ANSI or ANSI diff.
- `with_terminal` / `withTerminal` acquires/restores the terminal; `present` handles
  resize and output, `poll` returns raw key/escape bytes for application handling.
  Use structured cleanup even when application code raises an exception.
- [Protocol and limits](PROTOCOL.md), [C ABI](include/hqtui_bindings.h).

The acceptance runner `tests/check.py` uses the actual three VMs, checks 120 shared
TypeScript demo-body frames per binding, exercises independent widget builders,
UTF-8, errors, ownership, diff/resize, ten-tab PTYs, custom interactive apps and
signal cleanup. Linux additionally checks live snapshots and injected sensor,
traffic, session, HTTP and container data through the real collectors. Core memory/error-path
checks run through the native ABI under address/undefined-behavior sanitizers.

The APIs are experimental: the custom builder covers rows/columns/panels, text,
meters, graphs, gauges, tables, key/value lists, logs, dividers and spacers. It does
not yet expose every TypeScript widget or a normalized high-level input API.
Shared demo parity does not imply complete library/control parity. JSON batching
avoids per-cell crossings but still costs serialization/parsing on updates; no
zero-allocation or end-to-end speed claim is made without measurements.
