# Runnable widget gallery. The website extracts the marked procedures.
import ../src/hqtui

# @widget text
proc exampletext(ui: UI) =
  ui.text("Plain text. It fills the width it is given.")
  ui.text("Centered.", %*{"align": 1})
# @end

# @widget label
proc examplelabel(ui: UI) =
  ui.label("Muted supporting text")
# @end

# @widget heading
proc exampleheading(ui: UI) =
  ui.heading("System overview")
# @end

# @widget badge
proc examplebadge(ui: UI) =
  ui.badge("RUNNING", %*{"color": "success"})
# @end

# @widget divider
proc exampledivider(ui: UI) =
  ui.text("Above the line")
  ui.divider("status")
  ui.text("Below it")
# @end

# @widget keyValues
proc examplekeyValues(ui: UI) =
  ui.keys(%*[["Host", "web-01"], ["Uptime", "18d 04:12"], ["Load", "0.42"]])
# @end

# @widget statusBar
proc examplestatusBar(ui: UI) =
  ui.statusbar(%*[{"key": "q", "label": "Quit"}, {"key": "Tab", "label": "Next"}], %*{"right": "Connected"})
# @end

# @widget table
proc exampletable(ui: UI) =
  ui.table(%*["Name", "Status"], %*[["worker", "running"], ["queue", "ready"]], %*{"selected": 1})
# @end

# @widget list
proc examplelist(ui: UI) =
  ui.list(%*["Dashboard", "Network", "Services"], %*{"selected": 1})
# @end

# @widget tree
proc exampletree(ui: UI) =
  ui.tree(%*[{"label": "src", "children": [{"label": "main.nim"}, {"label": "widgets.nim"}]}])
# @end

# @widget log
proc examplelog(ui: UI) =
  ui.log(%*[{"time": "12:45", "level": "INFO", "message": "Listening on :8080"}])
# @end

# @widget scrollbar
proc examplescrollbar(ui: UI) =
  ui.scrollbar(120, %*{"viewport": 8, "offset": 36, "orientation": "bottom"})
# @end

# @widget chart
proc examplechart(ui: UI) =
  ui.chart(%*[{"label": "load", "points": [{"x": 0, "y": 1}, {"x": 2, "y": 6}, {"x": 5, "y": 3}]}], %*{"axis": true, "legend": true})
# @end

# @widget calendar
proc examplecalendar(ui: UI) =
  ui.calendar(2026, 9, %*{"selected": 8, "marks": [{"day": 15}]})
# @end

# @widget meter
proc examplemeter(ui: UI) =
  ui.meter(0.72, %*{"label": "CPU", "color": "success"})
# @end

# @widget meters
proc examplemeters(ui: UI) =
  ui.meters(%*[{"label": "P0", "value": 0.72}, {"label": "P1", "value": 0.45}], %*{"columns": 2})
# @end

# @widget progress
proc exampleprogress(ui: UI) =
  ui.progress(42, %*{"max": 100, "label": "Build", "count": true})
# @end

# @widget graph
proc examplegraph(ui: UI) =
  ui.graph(%*[12, 18, 26, 22, 44, 38, 61, 48, 72], %*{"min": 0, "max": 100})
# @end

# @widget sparkline
proc examplesparkline(ui: UI) =
  ui.sparkline(%*[12, 18, 26, 22, 44, 38, 61, 48, 72], %*{"label": "CPU"})
# @end

# @widget histogram
proc examplehistogram(ui: UI) =
  ui.columns(%*[12, 18, 26, 22, 44, 38, 61, 48, 72], %*{"max": 100})
# @end

# @widget heatBar
proc exampleheatBar(ui: UI) =
  ui.heatbar(0.72)
# @end

# @widget gauge
proc examplegauge(ui: UI) =
  ui.gauge(0.72, %*{"label": "CPU"})
# @end

# @widget donut
proc exampledonut(ui: UI) =
  ui.donut(%*[{"value": 60, "label": "Used", "color": "primary"}, {"value": 40, "label": "Free", "color": "muted"}])
# @end

# @widget button
proc examplebutton(ui: UI) =
  ui.button("Deploy", %*{"focused": true})
# @end

# @widget checkbox
proc examplecheckbox(ui: UI) =
  ui.checkbox("Auto-refresh", %*{"checked": true})
# @end

# @widget select
proc exampleselect(ui: UI) =
  ui.select("Production", %*{"options": ["Production", "Staging"], "selected": 0})
# @end

# @widget textInput
proc exampletextInput(ui: UI) =
  ui.input("web-01", %*{"label": "Host", "focused": true})
# @end

# @widget tabs
proc exampletabs(ui: UI) =
  ui.tabs(%*["Overview", "Network", "Services"], %*{"active": 1})
# @end

# @widget modal
proc examplemodal(ui: UI) =
  ui.modal(%*{"title": "Deploy?", "message": "Update production now?", "buttons": [{"label": "Cancel"}, {"label": "Deploy", "focused": true}]})
# @end

# @widget commandPalette
proc examplecommandPalette(ui: UI) =
  ui.commandPalette(%*{"query": "de", "items": [{"label": "Deploy", "hint": "production"}, {"label": "Describe"}], "selected": 0})
# @end

# @widget tooltip
proc exampletooltip(ui: UI) =
  ui.text("Hover for details")
  ui.tooltip("CPU usage", 4, 2)
# @end

when isMainModule:
  block:
    let ui = newUI()
    exampletext(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "text"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplelabel(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "label"
    stdout.write scene.render()
  block:
    let ui = newUI()
    exampleheading(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "heading"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplebadge(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "badge"
    stdout.write scene.render()
  block:
    let ui = newUI()
    exampledivider(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "divider"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplekeyValues(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "keyValues"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplestatusBar(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "statusBar"
    stdout.write scene.render()
  block:
    let ui = newUI()
    exampletable(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "table"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplelist(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "list"
    stdout.write scene.render()
  block:
    let ui = newUI()
    exampletree(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "tree"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplelog(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "log"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplescrollbar(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "scrollbar"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplechart(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "chart"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplecalendar(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "calendar"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplemeter(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "meter"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplemeters(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "meters"
    stdout.write scene.render()
  block:
    let ui = newUI()
    exampleprogress(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "progress"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplegraph(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "graph"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplesparkline(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "sparkline"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplehistogram(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "histogram"
    stdout.write scene.render()
  block:
    let ui = newUI()
    exampleheatBar(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "heatBar"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplegauge(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "gauge"
    stdout.write scene.render()
  block:
    let ui = newUI()
    exampledonut(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "donut"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplebutton(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "button"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplecheckbox(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "checkbox"
    stdout.write scene.render()
  block:
    let ui = newUI()
    exampleselect(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "select"
    stdout.write scene.render()
  block:
    let ui = newUI()
    exampletextInput(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "textInput"
    stdout.write scene.render()
  block:
    let ui = newUI()
    exampletabs(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "tabs"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplemodal(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "modal"
    stdout.write scene.render()
  block:
    let ui = newUI()
    examplecommandPalette(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "commandPalette"
    stdout.write scene.render()
  block:
    let ui = newUI()
    exampletooltip(ui)
    var scene = newScene(58, 12)
    scene.set(ui)
    echo "tooltip"
    stdout.write scene.render()
