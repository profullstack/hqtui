import std/os
import ../src/hqtui

let ui = newUI()
ui.panel("Nim + HQTUI", proc(p: UI) =
  p.text("A real Nim widget tree", %*{"color": "primary"})
  p.meter(0.72, %*{"label": "CPU", "color": "success"})
  p.table(%*["Service", "Status"], %*[["worker", "running"], ["queue", "ready"]])
)
var scene = newScene(60, 12)
try:
  scene.set(ui)
  if "--interactive" in commandLineParams():
    scene.withTerminal:
      while not interrupted():
        scene.present()
        if 'q' in scene.poll(): break
  else:
    stdout.write scene.render()
finally:
  scene.close()
