#!/bin/sh
# Copy the shared native engine into the Nim package, so `nimble install hqtui`
# compiles it from source into the program and needs no CMake, shared library
# or HQTUI_NATIVE_LIB.
#
# src/hqtui/engine is generated. Edit ports/c, ports/cpp and ports/bindings,
# then run this script. CI runs it and fails on any difference, so a stale copy
# cannot ship.
set -eu
port=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ports=$(dirname -- "$port")
out="$port/src/hqtui/engine"

rm -rf "$out"
mkdir -p "$out/c/include" "$out/c/src" "$out/cpp/include/hqtui" "$out/cpp/src" \
    "$out/cpp/demo/generated" "$out/bindings/include" "$out/bindings/src"

cp "$ports"/c/include/*.h "$out/c/include/"
cp "$ports"/c/src/*.c "$ports"/c/src/*.h "$out/c/src/"
cp "$ports"/cpp/include/*.hpp "$out/cpp/include/"
cp "$ports"/cpp/include/hqtui/*.hpp "$out/cpp/include/hqtui/"
cp "$ports"/cpp/src/*.cpp "$out/cpp/src/"
cp "$ports"/cpp/demo/*.cpp "$ports"/cpp/demo/*.hpp "$out/cpp/demo/"
cp "$ports"/bindings/include/*.h "$out/bindings/include/"
cp "$ports"/bindings/src/*.cpp "$out/bindings/src/"

# What CMake's configure_file does with demo/sample.hpp.in: splice the sample
# document into the raw string literal in place of @HQTUI_DEMO_SAMPLE@.
template="$ports/cpp/demo/sample.hpp.in"
sample="$ports/rust/demo/src/sample.json"
{
    sed -n '/@HQTUI_DEMO_SAMPLE@/!p; /@HQTUI_DEMO_SAMPLE@/q' "$template"
    sed -n 's/@HQTUI_DEMO_SAMPLE@.*//p' "$template" | tr -d '\n'
    cat "$sample"
    sed -n 's/.*@HQTUI_DEMO_SAMPLE@//p' "$template"
} > "$out/cpp/demo/generated/sample.hpp"

# The engine is versioned with the C++ port; the demo prints it for --version.
sed -n 's/^project(hqtui_cpp VERSION \([0-9.]*\).*/\1/p' "$ports/cpp/CMakeLists.txt" \
    > "$out/VERSION"

cat > "$out/README.md" <<'EOF'
# Generated: do not edit

A copy of `ports/c`, `ports/cpp` and `ports/bindings`, made by
`ports/nim/tools/vendor.sh` so the Nim package builds the engine from source.
Change the originals and rerun the script.
EOF
