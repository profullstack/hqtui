import std/[strutils, unittest]
import ../src/hqtui

suite "Nim binding":
  test "widgets, UTF-8, diff, rejected updates, resize and ownership":
    var scene = newScene(40, 8)
    let ui = newUI()
    ui.panel("Custom", proc(p: UI) =
      p.text("Nim → 世界")
      p.meter(0.72, %*{"label": "CPU"})
      p.table(%*["A", "B"], %*[["one", "two"]])
    )
    scene.set(ui)
    let original = scene.render()
    check "Nim → 世界" in original
    check scene.render("diff") == ""
    expect HqtuiError: scene.set(%*{"type": "missing"})
    check scene.render() == original
    expect HqtuiError: scene.resize(-1, 20)
    expect HqtuiError: discard scene.render("bad-format")
    expect HqtuiError: discard scene.render("text\0bad")
    scene.resize(20, 4)
    check scene.render().count('\n') == 4
    check "Nim → 世界" in original
    scene.close()
    scene.close()
    expect HqtuiError: discard scene.render()
    expect HqtuiError: discard newScene(theme = "unknown")
    expect HqtuiError: discard newScene(high(int), 20)
  test "options and exported trees are independent":
    let options = %*{"color": "primary"}
    let ui = newUI()
    ui.text("original", options)
    options["color"] = %"danger"
    let snapshot = ui.toJson()
    snapshot["children"][0]["text"] = %"changed"
    check ui.toJson()["children"][0]["text"].getStr == "original"
    check ui.toJson()["children"][0]["color"].getStr == "primary"
  test "move releases ownership once":
    var first = newScene()
    var second = move(first)
    expect HqtuiError: discard first.render()
    second.close()
