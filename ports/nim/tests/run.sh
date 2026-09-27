#!/bin/sh
# The shared acceptance runner passes the source filename; execute its compiled
# counterpart directly so PTY signals target the application, not a compiler.
set -eu
port=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
name=${1##*/}
shift
exec "$port/build/${name%.nim}" "$@"
