#pragma once
#include "json.hpp"
#include <chrono>
#include <iomanip>
#include <sstream>
namespace demo {
using namespace hqtui;
inline constexpr const char *screens[] = {
    "dashboard",  "traffic",  "sessions", "network", "services",
    "components", "graphics", "themes",   "input",   "stress"};
inline constexpr const char *themes[] = {
    "dark",   "dracula",    "nord",          "tokyo-night", "gruvbox",
    "matrix", "monochrome", "high-contrast", "light"};
inline std::string fixed(double v, int digits = 0) {
  if (!std::isfinite(v))
    return "—";
  std::ostringstream s;
  s.imbue(std::locale::classic());
  s << std::fixed << std::setprecision(digits) << v;
  return s.str();
}
inline std::string bytes(double v, int digits = 2) {
  if (!std::isfinite(v))
    return "—";
  v = std::max(0., v);
  const char *units[] = {"B", "KiB", "MiB", "GiB", "TiB", "PiB"};
  int i = 0;
  while (v >= 1024 && i < 5) {
    v /= 1024;
    i++;
  }
  return fixed(v, i ? digits : 0) + " " + units[i];
}
inline std::string percent(double v) {
  return fixed(std::floor(ratio(v) * 100 + .5)) + "%";
}
inline std::string byte_rate(double v) {
  for (auto item : {std::pair<double, const char *>{1e9, "GB/s"},
                    {1e6, "MB/s"},
                    {1e3, "KB/s"}})
    if (v >= item.first)
      return fixed(v / item.first, 1) + " " + item.second;
  return fixed(std::max(0., v)) + " B/s";
}
inline std::string bit_rate(double v) {
  v = std::max(0., v) * 8;
  for (auto item : {std::pair<double, const char *>{1e9, "Gb/s"},
                    {1e6, "Mb/s"},
                    {1e3, "Kb/s"}})
    if (v >= item.first)
      return fixed(v / item.first, 1) + " " + item.second;
  return fixed(v) + " b/s";
}
inline std::string duration(double v) {
  auto n = static_cast<long long>(std::max(0., v));
  auto d = n / 86400, h = n % 86400 / 3600, m = n % 3600 / 60;
  if (d)
    return std::to_string(d) + "d " + std::to_string(h) + "h " +
           std::to_string(m) + "m";
  if (h)
    return std::to_string(h) + "h " + std::to_string(m) + "m";
  return std::to_string(m) + "m " + std::to_string(n % 60) + "s";
}
inline KeyValue kv(std::string label, std::string value, Color color = 0) {
  return {std::move(label), std::move(value), color};
}
inline Graph graph(const Json &values, Color color,
                   std::optional<double> max = {}, bool axis = false) {
  Graph g;
  g.series.push_back({numbers(values), color, "", true});
  g.max = max;
  g.axis = axis;
  return g;
}
inline Graph multi(const Json &a, const Json &b, Color ca, Color cb) {
  Graph g;
  g.series = {{numbers(a), ca, "", true}, {numbers(b), cb, "", true}};
  return g;
}
inline Meter meter(double value, Color color = 0) {
  Meter m;
  m.value = value;
  m.color = color;
  m.show_value = false;
  // The demo's bars are segmented, like btop's. The library default is smooth,
  // matching every other port, so this asks rather than assuming.
  m.segmented = true;
  return m;
}
struct State {
  Json data;
  bool real = false, paused = false, help = false, modal = false,
       palette = false, filtering = false, editing = false, toggle = true,
       checkbox = true, select_open = false;
  int screen = 0, theme_index = 0, sort = 0, select_index = 0,
      palette_index = 0;
  double slider = .7, fps = 0, render_ms = 0;
  std::size_t changed_cells = 0, output_bytes = 0;
  std::string clock = "12:00:00", input = "", filter, query, last_key = "—",
              last_mouse = "—", focused = "dashboard.processes";
  std::vector<std::string> key_log;
  std::map<std::string, Pane> panes;
  std::vector<Region> regions;
  bool overlay() const { return help || modal || palette || filtering; }
  std::vector<Json> processes() const {
    auto rows = data["processes"].array();
    rows.erase(std::remove_if(rows.begin(), rows.end(),
                              [&](const Json &p) {
                                return !filter.empty() &&
                                       p["name"].s().find(filter) ==
                                           std::string::npos &&
                                       p["command"].s().find(filter) ==
                                           std::string::npos;
                              }),
               rows.end());
    std::stable_sort(
        rows.begin(), rows.end(), [&](const Json &a, const Json &b) {
          if (sort == 3)
            return a["name"].s() < b["name"].s();
          auto key = sort == 0 ? "cpu" : sort == 1 ? "mem" : "pid";
          return sort == 2 ? a[key].n() < b[key].n() : a[key].n() > b[key].n();
        });
    return rows;
  }
};
struct DataColumn {
  std::string key;
  Column column;
  std::function<std::string(const Json &)> format;
  std::function<Color(const Json &)> color;
};
inline DataColumn dc(std::string key, std::string title, int width = -1,
                     int min = 1, Color color = 0, bool right = false,
                     std::function<std::string(const Json &)> format = {},
                     std::function<Color(const Json &)> tint = {}) {
  return {std::move(key),
          {std::move(title), width, min, color, right ? HQ_RIGHT : HQ_LEFT},
          std::move(format),
          std::move(tint)};
}
inline void table(UI &p, State &s, std::string name,
                  const std::vector<Json> &rows, std::vector<DataColumn> cols,
                  bool zebra = false, bool header = true,
                  bool scrollbar = true) {
  Table t;
  t.pane = &s.panes[name];
  t.zebra = zebra;
  t.header = header;
  t.scrollbar = scrollbar;
  for (auto &c : cols)
    t.columns.push_back(c.column);
  for (auto &r : rows) {
    TableRow row;
    for (auto &c : cols) {
      row.cells.push_back(c.format ? c.format(r) : r[c.key].s());
      row.colors.push_back(c.color ? c.color(r) : c.column.color);
    }
    t.rows.push_back(std::move(row));
  }
  p.table(std::move(t), name);
}
inline std::vector<LogEntry> logs(const Json &data) {
  std::vector<LogEntry> rows;
  for (auto &r : data.array())
    rows.push_back({r["time"].s(""), r["level"].s(""), r["message"].s(""),
                    "{" + r["meta"].s("") + "}"});
  return rows;
}
void dashboard(UI &, State &);
void telemetry(UI &, State &);
void showcase(UI &, State &);
void render(UI &, State &, bool body = false);
} // namespace demo
