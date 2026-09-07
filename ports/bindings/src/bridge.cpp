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
      "row",   "col",   "panel", "text",  "spacer", "divider",
      "meter", "graph", "gauge", "table", "keys",   "log"};
  if (std::find(types.begin(), types.end(), type) == types.end())
    throw std::runtime_error("unknown widget: " + type);
  if (!n["children"].null() &&
      !std::holds_alternative<Json::Array>(n["children"].value))
    throw std::runtime_error("children must be an array");
  for (auto &child : n["children"].array())
    validate(child, depth + 1, count);
}
void node(UI &ui, const Json &n) {
  auto type = n["type"].s();
  auto body = [&n](UI &p) {
    for (auto &child : n["children"].array())
      node(p, child);
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
          draw_log(s, entries, &p);
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
  bool first = true;
  std::unique_ptr<demo::Terminal> terminal;
  hqb_scene(int w, int h, const hq_theme *t)
      : previous(w, h), frame(w, h), theme(t) {}
  void paint(const Json &scene) {
    frame.clear(theme->background, theme->foreground);
    UI ui(frame.surface(theme));
    node(ui, scene);
    ui.flush();
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
        s->frame.clear(s->theme->background, s->theme->foreground);
        UI ui(s->frame.surface(s->theme));
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
