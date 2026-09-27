import ../src/hqtui
for line in stdin.lines:
  let c = parseJson(line)
  var scene = newScene(c["width"].getInt, c["height"].getInt, c["theme"].getStr)
  try:
    if c.hasKey("collapsed"): scene.collapse(c["collapsed"].getBool)
    if c.hasKey("screen"):
      echo scene.demoFrame(c["screen"].getStr, "hashes")
    else:
      scene.set(c["tree"])
      echo scene.render("hashes")
  finally:
    scene.close()
