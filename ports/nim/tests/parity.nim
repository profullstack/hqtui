## Replays ports/conformance/fixtures/demo-parity.json, the TypeScript reference
## frames for all ten demo screens at several sizes, themes and border modes.
## ports/bindings/tests/check.py replays the same group across every binding;
## this is the copy `nimble test` runs on its own.
import std/[json, os, strformat, unittest]
import ../src/hqtui

const fixtures = currentSourcePath().parentDir / ".." / ".." / "conformance" / "fixtures" / "demo-parity.json"

suite "conformance: demo-parity":
  test "every reference frame matches, cell hash for cell hash":
    let cases = parseFile(fixtures)
    check cases.len > 0
    var failures: seq[string]
    for c in cases:
      var scene = newScene(c["width"].getInt, c["height"].getInt, c["theme"].getStr)
      try:
        if c.hasKey("collapsed"): scene.collapse(c["collapsed"].getBool)
        let actual = parseJson(scene.demoFrame(c["screen"].getStr, "hashes"))
        if actual != c["hashes"]:
          failures.add &"""{c["screen"].getStr} {c["width"].getInt}x{c["height"].getInt} {c["theme"].getStr} collapsed={c.getOrDefault("collapsed")}"""
      finally:
        scene.close()
    for failure in failures: checkpoint failure
    check failures.len == 0
    echo &"    {cases.len - failures.len} of {cases.len} reference frames match"
