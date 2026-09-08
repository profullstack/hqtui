#define HQTUI_DEMO_LIBRARY
#include "../../cpp/demo/main.cpp"
#include "hqtui_bindings.h"
#include <limits>

namespace {
using demo::Json;
using namespace hqtui;
thread_local std::string error;
std::atomic<bool> terminal_claimed{false};
void dimensions(int w, int h) {
  if (w < 1 || h < 1 || w > 500 || h > 200)
    throw std::runtime_error("dimensions must be 1..500 by 1..200");
}
template <class F> int checked(F action) noexcept {
  try {
    error.clear();
    action();
    return 1;
  } catch (const std::exception &e) {
    error = e.what();
  } catch (...) {
    error = "native operation failed";
  }
  return 0;
}
Json parse(const char *value, size_t length) {
  if (!value || length > 1048576)
    throw std::runtime_error("JSON must be at most 1 MiB");
  return Json::parse(std::string_view(value, length));
}
int integer(const Json &v, int fallback, int lo, int hi) {
  if (v.null())
    return fallback;
  double n = v.n(std::numeric_limits<double>::quiet_NaN());
  if (!std::isfinite(n) || n != std::floor(n) || n < lo || n > hi)
    throw std::runtime_error("integer option out of range");
  return int(n);
}
Color color(const Json &v, const hq_theme &t, Color fallback) {
  if (v.null())
    return fallback;
  auto name = v.s("");
  if (name == "primary")
    return t.primary;
  if (name == "secondary")
    return t.secondary;
  if (name == "accent")
    return t.accent;
  if (name == "muted")
    return t.muted;
  if (name == "success")
    return t.success;
  if (name == "warning")
    return t.warning;
  if (name == "danger")
    return t.danger;
  if (name == "foreground")
    return t.foreground;
  if (name.size() == 7 && name[0] == '#' &&
      name.find_first_not_of("0123456789abcdefABCDEF", 1) == name.npos)
    return hq_hex(name.c_str());
  throw std::runtime_error("color must be a theme role or #rrggbb");
}
Constraint size(const Json &n, Constraint fallback = fr()) {
  if (n["size"].null())
    return fallback;
  return cells(integer(n["size"], 0, 0, 10000));
}
void validate(const Json &n, int depth, int &count) {
  if (depth > 32 || ++count > 4096 ||
      !std::holds_alternative<Json::Object>(n.value))
    throw std::runtime_error(
        "scene exceeds depth/node limits or node is not an object");
  auto type = n["type"].s("");
  static const std::vector<std::string> types = {
      "row",      "col",      "panel",     "text",      "spacer",  "divider",
      "meter",    "graph",    "gauge",     "table",     "keys",    "log",
      "badge",    "progress", "sparkline", "heatbar",   "columns", "donut",
      "list",     "tree",     "button",    "checkbox",  "select",  "input",
      "tabs",     "statusbar", "label",     "heading",   "meters",  "modal",
      "commandpalette",        "tooltip",   "scrollbar"};
  if (std::find(types.begin(), types.end(), type) == types.end())
    throw std::runtime_error("unknown widget: " + type);
  if (!n["children"].null() &&
      !std::holds_alternative<Json::Array>(n["children"].value))
    throw std::runtime_error("children must be an array");
  for (auto &child : n["children"].array())
    validate(child, depth + 1, count);
}
/// An overlay drawn after layout, over the whole frame. Collected while the
/// tree is walked rather than drawn where it appears, because a modal centred
/// on the node that declared it would land inside that node's rectangle
/// instead of on the screen.
struct PendingOverlay {
  enum Kind { kModal, kPalette, kTooltip } kind;
  Modal modal;
  CommandPalette palette;
  Tooltip tooltip;
};

void node(UI &ui, const Json &n, std::vector<PendingOverlay> &overlays) {
  auto type = n["type"].s();
  auto body = [&n, &overlays](UI &p) {
    for (auto &child : n["children"].array())
      node(p, child, overlays);
  };
  int gap = integer(n["gap"], 0, 0, 100);
  auto c = color(n["color"], ui.t(), ui.t().foreground);
  if (type == "row" || type == "col")
    ui.group(size(n), gap, type == "row", body);
  else if (type == "panel")
    ui.panel(n["title"].s(""), body, size(n), n["subtitle"].s(""));
  else if (type == "text")
    ui.text(n["text"].s(""), c, integer(n["align"], HQ_LEFT, 0, 2),
            size(n, automatic(1)), integer(n["attrs"], 0, 0, 127));
  else if (type == "spacer")
    ui.spacer(size(n));
  else if (type == "divider")
    ui.divider(n["text"].s(""));
  else if (type == "meter") {
    Meter m;
    m.value = n["value"].n();
    m.label = n["label"].s("");
    m.color = c;
    ui.meter(m);
  } else if (type == "gauge") {
    auto v = n["value"].n();
    auto label = n["label"].s("");
    ui.draw([v, label](Surface s) { draw_gauge(s, v, label); }, size(n));
  } else if (type == "graph") {
    Graph g;
    g.series.push_back({demo::numbers(n["values"]), c, "", true});
    if (!n["max"].null())
      g.max = n["max"].n();
    g.min = n["min"].n();
    ui.graph(g, size(n));
  } else if (type == "keys") {
    std::vector<KeyValue> rows;
    for (auto &r : n["rows"].array())
      rows.push_back({r.at(0).s(""), r.at(1).s(""), c});
    ui.keys(rows);
  } else if (type == "table") {
    Table t;
    for (auto &column : n["columns"].array())
      t.columns.push_back({column.s(""), -1, 1, 0, HQ_LEFT});
    for (auto &r : n["rows"].array()) {
      TableRow row;
      for (auto &v : r.array())
        row.cells.push_back(v.s(""));
      t.rows.push_back(std::move(row));
    }
    if (t.columns.size() > 256 || t.rows.size() > 10000)
      throw std::runtime_error("table too large");
    int selected = integer(n["selected"], 0, 0, 10000),
        offset = integer(n["offset"], 0, 0, 10000);
    ui.draw(
        [t, selected, offset](Surface s) mutable {
          Pane p;
          p.selected = selected;
          p.offset = offset;
          t.pane = &p;
          draw_table(s, t);
        },
        size(n));
  } else if (type == "label") {
    // Text in the theme's muted colour: captions, and the line under a number
    // that says what the number is.
    ui.text(n["text"].s(""), color(n["color"], ui.t(), ui.t().muted),
            integer(n["align"], HQ_LEFT, 0, 2), size(n, automatic(1)),
            integer(n["attrs"], 0, 0, 127));
  } else if (type == "heading") {
    ui.text(n["text"].s(""), color(n["color"], ui.t(), ui.t().title),
            integer(n["align"], HQ_LEFT, 0, 2), size(n, automatic(1)),
            integer(n["attrs"], HQ_BOLD, 0, 127));
  } else if (type == "meters") {
    Meters m;
    for (auto &item : n["items"].array())
      m.items.push_back({item["label"].s(""), item["value"].n(),
                         item["max"].n(0), color(item["color"], ui.t(), 0),
                         item["text"].s("")});
    if (m.items.size() > 1000)
      throw std::runtime_error("too many meters");
    m.columns = integer(n["columns"], 1, 1, 16);
    m.label_width = integer(n["labelWidth"], -1, -1, 100);
    m.value_width = integer(n["valueWidth"], -1, -1, 100);
    m.style = integer(n["style"], HQ_BAR_SMOOTH, 0, 2);
    m.gap = integer(n["gap"], 2, 0, 100);
    int rows = (int(m.items.size()) + m.columns - 1) / m.columns;
    ui.draw([m](Surface s) { draw_meters(s, m); }, size(n, cells(rows)));
  } else if (type == "modal") {
    PendingOverlay overlay;
    overlay.kind = PendingOverlay::kModal;
    overlay.modal.title = n["title"].s("");
    overlay.modal.message = n["message"].s("");
    overlay.modal.width = integer(n["width"], -1, -1, 1000);
    overlay.modal.height = integer(n["height"], -1, -1, 1000);
    overlay.modal.backdrop = n["backdrop"].b(true);
    overlay.modal.align = integer(n["align"], HQ_CENTER, 0, 2);
    for (auto &button : n["buttons"].array())
      overlay.modal.buttons.push_back(
          {button["label"].s(""),
           integer(button["variant"], HQ_BUTTON_PRIMARY, 0, 4),
           button["focused"].b(false)});
    if (overlay.modal.buttons.size() > 16)
      throw std::runtime_error("too many modal buttons");
    overlays.push_back(std::move(overlay));
  } else if (type == "commandpalette") {
    PendingOverlay overlay;
    overlay.kind = PendingOverlay::kPalette;
    overlay.palette.query = n["query"].s("");
    overlay.palette.placeholder = n["placeholder"].s("");
    for (auto &item : n["items"].array())
      overlay.palette.items.push_back({item["label"].s(""), item["hint"].s("")});
    if (overlay.palette.items.size() > 1000)
      throw std::runtime_error("too many palette items");
    overlay.palette.selected = integer(n["selected"], 0, 0, 1000);
    overlay.palette.width = integer(n["width"], -1, -1, 1000);
    overlay.palette.height = integer(n["height"], -1, -1, 1000);
    overlays.push_back(std::move(overlay));
  } else if (type == "tooltip") {
    PendingOverlay overlay;
    overlay.kind = PendingOverlay::kTooltip;
    overlay.tooltip.text = n["text"].s("");
    overlay.tooltip.x = integer(n["x"], 0, 0, 10000);
    overlay.tooltip.y = integer(n["y"], 0, 0, 10000);
    overlay.tooltip.color = color(n["color"], ui.t(), 0);
    overlays.push_back(std::move(overlay));
  } else if (type == "badge") {
    Badge b;
    b.text = n["text"].s("");
    b.color = n["color"].null() ? 0 : c;
    b.variant = integer(n["variant"], HQ_BADGE_FILLED, 0, 2);
    b.align = integer(n["align"], HQ_LEFT, 0, 2);
    ui.badge(b);
  } else if (type == "progress") {
    Progress p;
    p.value = n["value"].n();
    p.max = n["max"].null() ? 1 : n["max"].n();
    p.label = n["label"].s("");
    p.color = n["color"].null() ? 0 : c;
    p.show_count = n["count"].b(false);
    ui.progress(p);
  } else if (type == "sparkline") {
    Sparkline sp;
    sp.values = demo::numbers(n["values"]);
    sp.label = n["label"].s("");
    sp.text = n["text"].s("");
    sp.color = n["color"].null() ? 0 : c;
    if (!n["min"].null())
      sp.min = n["min"].n();
    if (!n["max"].null())
      sp.max = n["max"].n();
    ui.sparkline(sp);
  } else if (type == "heatbar") {
    HeatBar hb;
    hb.value = n["value"].n();
    hb.color = n["color"].null() ? 0 : c;
    ui.heat_bar(hb);
  } else if (type == "columns") {
    Columns cols;
    cols.values = demo::numbers(n["values"]);
    cols.color = n["color"].null() ? 0 : c;
    if (!n["max"].null())
      cols.max = n["max"].n();
    ui.columns(cols, size(n));
  } else if (type == "donut") {
    Donut d;
    for (auto &seg : n["segments"].array())
      d.segments.push_back({seg["value"].n(), 0, seg["label"].s("")});
    if (d.segments.size() > 64)
      throw std::runtime_error("too many donut segments");
    ui.donut(d, size(n));
  } else if (type == "scrollbar") {
    Scrollbar bar;
    bar.total = integer(n["total"], 0, 0, 1000000);
    bar.viewport = integer(n["viewport"], 0, 0, 1000000);
    bar.offset = integer(n["offset"], 0, 0, 1000000);
    auto edge = n["orientation"].s("right");
    bar.orientation = edge == "left"     ? HQ_SCROLLBAR_LEFT
                      : edge == "bottom" ? HQ_SCROLLBAR_BOTTOM
                      : edge == "top"    ? HQ_SCROLLBAR_TOP
                                         : HQ_SCROLLBAR_RIGHT;
    ui.scrollbar(bar, n["id"].s(""));
  } else if (type == "list") {
    List l;
    for (auto &item : n["items"].array())
      l.items.push_back({item.s(""), 0});
    if (l.items.size() > 10000)
      throw std::runtime_error("list too large");
    l.selected = integer(n["selected"], -1, -1, 10000);
    l.offset = integer(n["offset"], 0, 0, 10000);
    l.bullet = n["bullet"].s("");
    l.scrollbar = n["scrollbar"].b(false);
    ui.list(l, n["id"].s(""));
  } else if (type == "tree") {
    Tree tree;
    // One level of nesting, which is what a record-shaped scene can describe:
    // a node with its children, not an arbitrary depth.
    for (auto &node_json : n["nodes"].array()) {
      TreeNode parent;
      parent.label = node_json["label"].s("");
      for (auto &child : node_json["children"].array())
        parent.children.push_back(TreeNode{child["label"].s("")});
      tree.nodes.push_back(std::move(parent));
    }
    tree.selected = integer(n["selected"], -1, -1, 10000);
    ui.tree(tree, n["id"].s(""));
  } else if (type == "button") {
    Button b;
    b.label = n["label"].s("");
    b.focused = n["focused"].b(false);
    b.variant = integer(n["variant"], HQ_BUTTON_PRIMARY, 0, 4);
    b.disabled = n["disabled"].b(false);
    ui.button(b);
  } else if (type == "checkbox") {
    Checkbox cb;
    cb.label = n["label"].s("");
    cb.checked = n["checked"].b(false);
    cb.focused = n["focused"].b(false);
    cb.variant = integer(n["variant"], HQ_CHECKBOX_BOX, 0, 2);
    ui.checkbox(cb);
  } else if (type == "select") {
    Select sel;
    sel.value = n["value"].s("");
    sel.open = n["open"].b(false);
    for (auto &option : n["options"].array())
      sel.options.push_back(option.s(""));
    if (sel.options.size() > 1000)
      throw std::runtime_error("too many options");
    sel.selected_index = integer(n["selected"], 0, 0, 1000);
    sel.focused = n["focused"].b(false);
    ui.select(sel);
  } else if (type == "input") {
    TextInput input;
    input.value = n["value"].s("");
    input.placeholder = n["placeholder"].s("");
    input.label = n["label"].s("");
    input.focused = n["focused"].b(false);
    input.password = n["password"].b(false);
    ui.text_input(input);
  } else if (type == "tabs") {
    Tabs tabs;
    for (auto &tab : n["tabs"].array())
      tabs.tabs.push_back(tab.s(""));
    if (tabs.tabs.size() > 100)
      throw std::runtime_error("too many tabs");
    tabs.active = integer(n["active"], 0, 0, 100);
    tabs.variant = integer(n["variant"], HQ_TAB_FILLED, 0, 1);
    ui.tabs(tabs);
  } else if (type == "statusbar") {
    StatusBar bar;
    for (auto &item : n["items"].array())
      bar.items.push_back({item["key"].s(""), item["label"].s(""), 0,
                           item["active"].b(false)});
    for (auto &item : n["right"].array())
      bar.right.push_back({item["key"].s(""), item["label"].s(""), 0, false});
    if (bar.items.size() + bar.right.size() > 100)
      throw std::runtime_error("too many status items");
    ui.status_bar(bar);
  } else if (type == "log") {
    std::vector<LogEntry> entries;
    for (auto &v : n["entries"].array())
      entries.push_back({v["time"].s(""), v["level"].s("INFO"),
                         v["message"].s(""), v["meta"].s("")});
    int offset = integer(n["offset"], 0, 0, 10000);
    ui.draw(
        [entries, offset](Surface s) {
          Pane p;
          p.offset = offset;
          draw_log(s, entries, &p, true);
        },
        size(n));
  }
}
std::string hashes(const Buffer &frame) {
  std::string out = "[";
  for (int y = 0; y < frame.height(); y++) {
    uint32_t h = 2166136261u;
    auto byte = [&](unsigned char b) { h = (h ^ b) * 16777619u; };
    for (int x = 0; x < frame.width(); x++) {
      auto cell = frame.cell(x, y);
      char scratch[5];
      std::string_view glyph =
          hq_buffer_cell_text(frame.native_handle(), x, y, scratch);
      for (unsigned char b : glyph)
        byte(b);
      byte(0);
      for (auto value :
           {uint32_t(cell.fg), uint32_t(cell.bg), uint32_t(cell.attrs)})
        for (int i = 0; i < 4; i++)
          byte((value >> (8 * i)) & 255);
    }
    if (y)
      out += ',';
    out += std::to_string(h);
  }
  return out + "]";
}
} // namespace
struct hqb_scene {
  Buffer previous, frame;
  Encoder encoder;
  const hq_theme *theme;
  Json tree;
  std::string output, input;
  bool first = true, collapse = false;
  std::unique_ptr<demo::Terminal> terminal;
  hqb_scene(int w, int h, const hq_theme *t)
      : previous(w, h), frame(w, h), theme(t) {}
  void paint(const Json &scene) {
    frame.clear(theme->background, theme->foreground);
    UI ui(frame.surface(theme), false, 0, nullptr, collapse);
    std::vector<PendingOverlay> overlays;
    node(ui, scene, overlays);
    ui.flush();
    // Overlays go on after the flush, so a modal covers the laid-out screen
    // rather than being covered by it.
    Surface root = frame.surface(theme);
    for (const auto &overlay : overlays) {
      switch (overlay.kind) {
      case PendingOverlay::kModal:
        draw_modal(root, overlay.modal);
        break;
      case PendingOverlay::kPalette:
        draw_command_palette(root, overlay.palette);
        break;
      case PendingOverlay::kTooltip:
        draw_tooltip(root, overlay.tooltip);
        break;
      }
    }
  }
  const char *finish(const char *format) {
    if (!format)
      throw std::runtime_error("missing format");
    std::string f = format;
    if (f == "text") {
      output.clear();
      for (int y = 0; y < frame.height(); y++)
        output += frame.row(y) + "\n";
    } else if (f == "hashes")
      output = hashes(frame);
    else if (f == "ansi" || f == "diff")
      output = encoder.encode(previous, frame, first || f == "ansi").output;
    else
      throw std::runtime_error("format must be text, ansi, diff or hashes");
    previous.copy_from(frame);
    first = false;
    return output.c_str();
  }
};
extern "C" {
int hqb_abi_version(void) { return 1; }
const char *hqb_error(void) { return error.c_str(); }
hqb_scene *hqb_create(int w, int h, const char *name) {
  hqb_scene *s = nullptr;
  checked([&] {
    dimensions(w, h);
    auto t = hq_theme_named(name ? name : "dark");
    if (!t)
      throw std::runtime_error("unknown theme");
    auto candidate = std::make_unique<hqb_scene>(w, h, t);
    candidate->tree = Json::Object{{"type", "col"}};
    s = candidate.release();
  });
  return s;
}
void hqb_close(hqb_scene *s) {
  if (s && s->terminal) {
    s->terminal.reset();
    terminal_claimed = false;
  }
}
void hqb_destroy(hqb_scene *s) {
  hqb_close(s);
  delete s;
}
int hqb_set(hqb_scene *s, const char *json, size_t length) {
  return checked([&] {
    if (!s)
      throw std::runtime_error("closed scene");
    auto tree = parse(json, length);
    int count = 0;
    validate(tree, 0, count);
    // Validate widget options and allocations before committing the new tree.
    s->paint(tree);
    s->tree = std::move(tree);
  });
}
int hqb_resize(hqb_scene *s, int w, int h) {
  return checked([&] {
    if (!s)
      throw std::runtime_error("closed scene");
    dimensions(w, h);
    s->frame.resize(w, h);
    s->previous.resize(w, h);
    s->first = true;
  });
}
int hqb_collapse(hqb_scene *s, int enabled) {
  return checked([&] {
    if (!s)
      throw std::runtime_error("closed scene");
    s->collapse = enabled != 0;
  });
}
const char *hqb_render(hqb_scene *s, const char *format) {
  if (!checked([&] {
        if (!s || !format)
          throw std::runtime_error("closed scene or missing format");
        s->paint(s->tree);
        s->finish(format);
      }))
    return nullptr;
  return s->output.c_str();
}
const char *hqb_demo_frame(hqb_scene *s, const char *screen,
                           const char *format) {
  if (!checked([&] {
        if (!s || !screen)
          throw std::runtime_error("closed scene or missing screen");
        demo::State state;
        state.data = Json::parse(demo::sample_json);
        int i = 0;
        for (; i < 10 && std::string(screen) != demo::screens[i]; i++) {
        }
        if (i == 10)
          throw std::runtime_error("unknown demo screen");
        state.screen = i;
        for (int t = 0; t < 9; t++)
          if (std::string(s->theme->name) == demo::themes[t])
            state.theme_index = t;
        // Collapsing changes the layout, not only the glyphs: the screens close
        // the seams between panels so their borders have something to merge.
        state.collapse = s->collapse;
        s->frame.clear(s->theme->background, s->theme->foreground);
        UI ui(s->frame.surface(s->theme), false, 0, nullptr, s->collapse);
        demo::render(ui, state, true);
        ui.flush();
        s->finish(format);
      }))
    return nullptr;
  return s->output.c_str();
}
int hqb_open(hqb_scene *s) {
  return checked([&] {
    if (!s)
      throw std::runtime_error("closed scene");
    if (s->terminal)
      return;
    bool expected = false;
    if (!terminal_claimed.compare_exchange_strong(expected, true))
      throw std::runtime_error("terminal already acquired");
    try {
      demo::interrupted = 0;
      s->terminal = std::make_unique<demo::Terminal>();
      s->first = true;
    } catch (...) {
      terminal_claimed = false;
      throw;
    }
  });
}
int hqb_present(hqb_scene *s) {
  return checked([&] {
    if (!s || !s->terminal)
      throw std::runtime_error("terminal not open");
    auto dimensions = s->terminal->size();
    if (dimensions.first != s->frame.width() ||
        dimensions.second != s->frame.height())
      if (!hqb_resize(s, dimensions.first, dimensions.second))
        throw std::runtime_error(error);
    auto bytes = hqb_render(s, "diff");
    if (!bytes)
      throw std::runtime_error(error);
    if (!demo::write_all(s->output))
      throw std::runtime_error("terminal write failed");
  });
}
const char *hqb_poll(hqb_scene *s, int timeout_ms) {
  if (!checked([&] {
        if (!s || !s->terminal || timeout_ms < 0 || timeout_ms > 1000)
          throw std::runtime_error("invalid terminal poll");
        s->input.clear();
        struct pollfd fd{0, POLLIN, 0};
        auto ready = poll(&fd, 1, timeout_ms);
        if (ready < 0 && errno != EINTR)
          throw std::runtime_error("terminal poll failed");
        if (ready > 0 && fd.revents & (POLLHUP | POLLERR))
          demo::interrupted = SIGHUP;
        if (ready > 0 && fd.revents & POLLIN) {
          char b[4096];
          auto n = read(0, b, sizeof b);
          if (n > 0)
            s->input.assign(b, size_t(n));
        }
      }))
    return nullptr;
  return s->input.c_str();
}
int hqb_interrupted(void) { return demo::interrupted; }
int hqb_demo(const char *arguments, size_t length) {
  int status = 2;
  if (!checked([&] {
        auto args = parse(arguments, length);
        if (!std::holds_alternative<Json::Array>(args.value) ||
            args.array().size() > 128)
          throw std::runtime_error(
              "arguments must be an array of at most 128 strings");
        std::vector<std::string> strings{"hqtui-demo-binding"};
        for (auto &v : args.array()) {
          if (!std::holds_alternative<std::string>(v.value) ||
              v.s().find('\0') != std::string::npos)
            throw std::runtime_error("arguments must be NUL-free strings");
          strings.push_back(v.s());
        }
        std::vector<char *> argv;
        for (auto &v : strings)
          argv.push_back(v.data());
        argv.push_back(nullptr);
        bool expected = false;
        if (!terminal_claimed.compare_exchange_strong(expected, true))
          throw std::runtime_error("terminal already acquired");
        struct Release {
          ~Release() { terminal_claimed = false; }
        } release;
        status = hqtui_demo_main(int(strings.size()), argv.data());
      }))
    return -1;
  return status;
}
}
