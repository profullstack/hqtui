# Package

version       = "0.10.0"
author        = "HQTUI contributors"
description   = "Terminal UI widgets and the ten-screen HQTUI dashboard for Nim, over HQTUI's shared native engine (compiled from source)"
license       = "MIT"
srcDir        = "src"

# Dependencies

requires "nim >= 2.2.4"

# Tasks

task test, "Run the API tests and replay the demo-parity conformance fixtures":
  exec "nim c -r --hints:off --nimcache:build/nimcache --out:build/core tests/core.nim"
  exec "nim c -r --hints:off --nimcache:build/nimcache --out:build/parity tests/parity.nim"
