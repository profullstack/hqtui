#!/bin/sh
set -eu
port=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$port/build"
for source in examples/dashboard examples/hello examples/widgets tests/core tests/render; do
    nim c -d:release --hints:off --nimcache:"$port/build/nimcache" --out:"$port/build/${source##*/}" "$port/$source.nim"
done
