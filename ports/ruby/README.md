# HQTUI Ruby bindings (experimental)

Language-friendly widget APIs over the shared native C/C++ engine. These are
bindings, not a separately implemented renderer. The ten-screen demo runs inside
the Ruby runtime; it does not launch the C++ executable.

```sh
curl -fsSL https://hqtui.com/demo.sh | sh -s -- --mise ruby
curl -fsSL https://hqtui.com/demo.sh | sh -s -- --system ruby
```

Both update before launch. GCC/Clang and Make are required. Mise also provides
CMake and the pinned runtime. See [build prerequisites, native library setup and
API limitations](../bindings/README.md). Linux supplies live collectors; macOS
uses sample mode by default.

[Build your own CLI](examples/hello.rb) using panels, text, meters, graphs,
tables and the native terminal transport. The example renders a headless frame
by default; add `--interactive` to run it, then press q to quit.

Package metadata is provided for future distribution; this new binding has not
been published to its language package registry yet.
