## Nim API over HQTUI's shared native rendering engine (ABI 1).
## Scenes own their handles, cannot be copied, and restore terminals on destruction.
import std/[json, os]
export json

const version* = "0.1.0"
const checkoutLibrary = currentSourcePath().parentDir / "../../cpp/build-bindings" /
  (when defined(macosx): "libhqtui_bindings.dylib" else: "libhqtui_bindings.so")
proc libraryPath(): string = getEnv("HQTUI_NATIVE_LIB", checkoutLibrary)

{.push cdecl, dynlib: libraryPath(), importc.}
proc hqb_abi_version(): cint
proc hqb_error(): cstring
proc hqb_create(width, height: cint, theme: cstring): pointer
proc hqb_destroy(scene: pointer)
proc hqb_set(scene: pointer, data: cstring, length: csize_t): cint
proc hqb_resize(scene: pointer, width, height: cint): cint
proc hqb_collapse(scene: pointer, enabled: cint): cint
proc hqb_render(scene: pointer, format: cstring): cstring
proc hqb_demo_frame(scene: pointer, screen, format: cstring): cstring
proc hqb_open(scene: pointer): cint
proc hqb_present(scene: pointer): cint
proc hqb_poll(scene: pointer, timeout: cint): cstring
proc hqb_interrupted(): cint
proc hqb_close(scene: pointer)
proc hqb_demo(arguments: cstring, length: csize_t): cint
{.pop.}

type
  HqtuiError* = object of CatchableError
  Scene* = object
    handle: pointer
  UI* = ref object
    node: JsonNode

proc `=destroy`*(scene: Scene) =
  if scene.handle != nil: hqb_destroy(scene.handle)
proc `=copy`*(dest: var Scene, source: Scene) {.error: "Scenes cannot be copied; pass by reference or move them".}

proc fail() {.noreturn.} = raise newException(HqtuiError, $hqb_error())
proc check(status: cint) =
  if status == 0: fail()
proc copied(value: cstring): string =
  if value == nil: fail()
  result = $value
proc live(scene: Scene): pointer =
  if scene.handle == nil: raise newException(HqtuiError, "Scene is closed")
  scene.handle
proc validateCString(value: string) =
  if '\0' in value: raise newException(HqtuiError, "Embedded NUL in native string")
proc checkAbi() =
  if hqb_abi_version() != 1: raise newException(HqtuiError, "Unsupported native ABI")
proc dimensions(width, height: int) =
  if width notin 1..500 or height notin 1..200:
    raise newException(HqtuiError, "Scene dimensions must be 1–500 by 1–200")

proc newScene*(width = 80, height = 24, theme = "dark"): Scene =
  checkAbi()
  dimensions(width, height)
  validateCString(theme)
  result.handle = hqb_create(cint(width), cint(height), theme.cstring)
  if result.handle == nil: fail()
proc close*(scene: var Scene) =
  if scene.handle != nil:
    hqb_destroy(scene.handle)
    scene.handle = nil
proc set*(scene: Scene, tree: JsonNode) =
  let encoded = $tree
  check hqb_set(scene.live, encoded.cstring, csize_t(encoded.len))
proc collapse*(scene: Scene, enabled = true) = check hqb_collapse(scene.live, cint(enabled))
proc resize*(scene: Scene, width, height: int) =
  dimensions(width, height)
  check hqb_resize(scene.live, cint(width), cint(height))
proc render*(scene: Scene, format = "text"): string =
  validateCString(format)
  copied(hqb_render(scene.live, format.cstring))
proc demoFrame*(scene: Scene, screen: string, format = "text"): string =
  validateCString(screen)
  validateCString(format)
  copied(hqb_demo_frame(scene.live, screen.cstring, format.cstring))
proc openTerminal*(scene: Scene) = check hqb_open(scene.live)
proc closeTerminal*(scene: Scene) =
  if scene.handle != nil: hqb_close(scene.handle)
proc present*(scene: Scene) = check hqb_present(scene.live)
proc poll*(scene: Scene, timeoutMs = 33): string =
  if timeoutMs < 0 or timeoutMs > int(high(cint)):
    raise newException(HqtuiError, "Invalid poll timeout")
  copied(hqb_poll(scene.live, cint(timeoutMs)))
proc interrupted*(): bool = hqb_interrupted() != 0

template withTerminal*(scene: Scene, body: untyped) =
  scene.openTerminal()
  try: body
  finally: scene.closeTerminal()

proc demo*(arguments: seq[string] = commandLineParams()): int =
  checkAbi()
  let encoded = $(%arguments)
  result = int(hqb_demo(encoded.cstring, csize_t(encoded.len)))
  if result < 0: fail()

proc widget(kind: string, options: JsonNode): JsonNode =
  result = newJObject()
  if options != nil:
    if options.kind != JObject: raise newException(HqtuiError, "Widget options must be an object")
    for key, value in options: result[key] = value.copy()
  result["type"] = %kind
proc newUI*(kind = "col", options: JsonNode = nil): UI =
  UI(node: widget(kind, options))
proc toJson*(ui: UI): JsonNode = ui.node.copy()
proc set*(scene: Scene, ui: UI) = scene.set(ui.node)
proc add*(ui: UI, kind: string, options: JsonNode = nil) =
  if not ui.node.hasKey("children"): ui.node["children"] = newJArray()
  ui.node["children"].add(widget(kind, options))
proc group*(ui: UI, kind: string, build: proc(child: UI), options: JsonNode = nil) =
  let child = newUI(kind, options)
  build(child)
  if not ui.node.hasKey("children"): ui.node["children"] = newJArray()
  ui.node["children"].add(child.node)
proc row*(ui: UI, build: proc(child: UI), options: JsonNode = nil) = ui.group("row", build, options)
proc col*(ui: UI, build: proc(child: UI), options: JsonNode = nil) = ui.group("col", build, options)
proc fields(options: JsonNode, pairs: varargs[(string, JsonNode)]): JsonNode =
  result = widget("", options)
  result.delete("type")
  for (key, value) in pairs: result[key] = value
proc panel*(ui: UI, title: string, build: proc(child: UI), options: JsonNode = nil) =
  ui.group("panel", build, fields(options, ("title", %title)))

proc text*(ui: UI, text:string, options: JsonNode = nil) =
  ui.add("text", fields(options, ("text", %text)))

proc meter*(ui: UI, value:float, options: JsonNode = nil) =
  ui.add("meter", fields(options, ("value", %value)))

proc graph*(ui: UI, values:JsonNode, options: JsonNode = nil) =
  ui.add("graph", fields(options, ("values", %values)))

proc gauge*(ui: UI, value:float, options: JsonNode = nil) =
  ui.add("gauge", fields(options, ("value", %value)))

proc table*(ui: UI, columns:JsonNode, rows:JsonNode, options: JsonNode = nil) =
  ui.add("table", fields(options, ("columns", %columns), ("rows", %rows)))

proc keys*(ui: UI, rows:JsonNode, options: JsonNode = nil) =
  ui.add("keys", fields(options, ("rows", %rows)))

proc log*(ui: UI, entries:JsonNode, options: JsonNode = nil) =
  ui.add("log", fields(options, ("entries", %entries)))

proc spacer*(ui: UI, options: JsonNode = nil) =
  ui.add("spacer", options)

proc divider*(ui: UI, text = "", options: JsonNode = nil) =
  ui.add("divider", fields(options, ("text", %text)))

proc badge*(ui: UI, text:string, options: JsonNode = nil) =
  ui.add("badge", fields(options, ("text", %text)))

proc progress*(ui: UI, value:float, options: JsonNode = nil) =
  ui.add("progress", fields(options, ("value", %value)))

proc sparkline*(ui: UI, values:JsonNode, options: JsonNode = nil) =
  ui.add("sparkline", fields(options, ("values", %values)))

proc heatbar*(ui: UI, value:float, options: JsonNode = nil) =
  ui.add("heatbar", fields(options, ("value", %value)))

proc columns*(ui: UI, values:JsonNode, options: JsonNode = nil) =
  ui.add("columns", fields(options, ("values", %values)))

proc donut*(ui: UI, segments:JsonNode, options: JsonNode = nil) =
  ui.add("donut", fields(options, ("segments", %segments)))

proc list*(ui: UI, items:JsonNode, options: JsonNode = nil) =
  ui.add("list", fields(options, ("items", %items)))

proc scrollbar*(ui: UI, total:int, options: JsonNode = nil) =
  ui.add("scrollbar", fields(options, ("total", %total)))

proc chart*(ui: UI, series:JsonNode, options: JsonNode = nil) =
  ui.add("chart", fields(options, ("series", %series)))

proc calendar*(ui: UI, year:int, month:int, options: JsonNode = nil) =
  ui.add("calendar", fields(options, ("year", %year), ("month", %month)))

proc tree*(ui: UI, nodes:JsonNode, options: JsonNode = nil) =
  ui.add("tree", fields(options, ("nodes", %nodes)))

proc button*(ui: UI, label:string, options: JsonNode = nil) =
  ui.add("button", fields(options, ("label", %label)))

proc checkbox*(ui: UI, label:string, options: JsonNode = nil) =
  ui.add("checkbox", fields(options, ("label", %label)))

proc select*(ui: UI, value:string, options: JsonNode = nil) =
  ui.add("select", fields(options, ("value", %value)))

proc input*(ui: UI, value:string, options: JsonNode = nil) =
  ui.add("input", fields(options, ("value", %value)))

proc tabs*(ui: UI, tabs:JsonNode, options: JsonNode = nil) =
  ui.add("tabs", fields(options, ("tabs", %tabs)))

proc statusbar*(ui: UI, items:JsonNode, options: JsonNode = nil) =
  ui.add("statusbar", fields(options, ("items", %items)))

proc label*(ui: UI, text:string, options: JsonNode = nil) =
  ui.add("label", fields(options, ("text", %text)))

proc heading*(ui: UI, text:string, options: JsonNode = nil) =
  ui.add("heading", fields(options, ("text", %text)))

proc meters*(ui: UI, items:JsonNode, options: JsonNode = nil) =
  ui.add("meters", fields(options, ("items", %items)))

proc modal*(ui: UI, options: JsonNode = nil) =
  ui.add("modal", options)

proc commandPalette*(ui: UI, options: JsonNode = nil) =
  ui.add("commandpalette", options)

proc tooltip*(ui: UI, text:string, x:int, y:int, options: JsonNode = nil) =
  ui.add("tooltip", fields(options, ("text", %text), ("x", %x), ("y", %y)))
