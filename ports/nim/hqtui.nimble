version = "0.1.0"
author = "HQTUI contributors"
description = "HQTUI widgets and terminal applications over the shared native engine"
license = "MIT"
srcDir = "src"
requires "nim >= 2.2.4"

task test, "Run binding API tests (requires native engine)":
  exec "nim c -r --hints:off tests/core.nim"
