// Every widget the C++ port draws, one function each.
//
// Built as the `hqtui-widgets` target; running it renders all of them
// headlessly and prints the result, so this file is a program rather than a
// snippet dump. The `@widget` / `@end` markers are what hqtui.com/widgets
// slices to show the code for one widget, which is why a snippet on the site
// is always a region of something that compiles.
//
// C++ draws straight onto a Surface rather than describing a tree, and the
// native core exposes eight widgets rather than the twenty-eight the
// TypeScript, JavaScript, Rust, Go, Python and Zig ports do. The list is
// honest about that.

#include <cstdio>
#include <string>
#include <vector>

#include <hqtui.hpp>
#include <hqtui/widgets.hpp>

using namespace hqtui;

static std::vector<double> cpu_history() {
  return {12, 18, 26, 22, 31, 44, 38, 52, 61, 48,
          39, 44, 57, 66, 72, 64, 51, 43, 37, 41};
}

// @widget text
void widget_text(Surface s) {
  // `text` places a string at a cell; `aligned` centres or right-aligns it on
  // a row. Both take the colour explicitly.
  const auto &t = theme(s);
  text(s, 0, 0, "Plain text. It fills the width it is given.", t.foreground);
  aligned(s, 1, "Centered.", t.foreground, HQ_CENTER);
  aligned(s, 2, "Right aligned.", t.muted, HQ_RIGHT);
}
// @end

// @widget keyValues
void widget_key_values(Surface s) {
  // The backbone of every "System" panel: labels left, values right.
  std::vector<KeyValue> rows{
      {"Host", "web-01.iad"},
      {"Uptime", "18d 04:12"},
      {"Load", "0.42  0.51  0.60"},
      {"Established", "1,284"},
  };
  draw_keys(s, rows);
}
// @end

// @widget table
void widget_table(Surface s) {
  Table t;
  t.columns = {{"Name"}, {"Size", 9, 1, 0, HQ_RIGHT}, {"Type", 6}, {"Modified", 10, 1, 0, HQ_RIGHT}};
  t.rows = {
      {{"src", "4.2 KB", "dir", "2m ago"}},
      {{"test", "1.1 KB", "dir", "5m ago"}},
      {{"package.json", "1.2 KB", "file", "10m ago"}},
      {{"README.md", "3.4 KB", "file", "1h ago"}},
  };
  t.zebra = true;
  // The pane carries selection and scroll, and stays yours between frames.
  Pane pane;
  pane.selected = 1;
  pane.total = static_cast<int>(t.rows.size());
  t.pane = &pane;
  draw_table(s, t);
}
// @end

// @widget log
void widget_log(Surface s) {
  std::vector<LogEntry> entries{
      {"12:45:02", "INFO", "listening on :8080", ""},
      {"12:45:09", "WARN", "slow query 412ms", "table=users"},
      {"12:45:11", "ERROR", "upstream timeout", ""},
      {"12:45:14", "INFO", "retry succeeded", ""},
  };
  Pane pane;
  pane.log = true;
  pane.total = static_cast<int>(entries.size());
  draw_log(s, entries, &pane);
}
// @end

// @widget meter
void widget_meter(Surface s) {
  const int width = s.rect().width;
  draw_meter(s.sub(Rect{0, 0, width, 1}), Meter{.value = 0.62, .label = "CPU"});
  draw_meter(s.sub(Rect{0, 1, width, 1}), Meter{.value = 0.31, .label = "MEM"});
  draw_meter(s.sub(Rect{0, 2, width, 1}), Meter{.value = 0.87, .label = "SWP"});
}
// @end

// @widget graph
void widget_graph(Surface s) {
  // Braille line chart, filled under the curve.
  Graph g;
  g.series.push_back({cpu_history(), 0, "cpu", true});
  g.min = 0;
  g.max = 100;
  draw_graph(s, g);
}
// @end

// @widget gauge
void widget_gauge(Surface s) {
  // A semicircular dial. Wants at least nine columns by five rows.
  draw_gauge(s, 0.62, "62%");
}
// @end

int main() {
  struct Example {
    const char *name;
    void (*draw)(Surface);
  };
  const Example examples[] = {
      {"text", widget_text},   {"keyValues", widget_key_values},
      {"table", widget_table}, {"log", widget_log},
      {"meter", widget_meter}, {"graph", widget_graph},
      {"gauge", widget_gauge},
  };

  const hq_theme *dark = hq_theme_named("dark");
  int blank = 0;
  for (const auto &example : examples) {
    Buffer buffer(62, 12);
    buffer.clear(dark ? dark->background : 0, dark ? dark->foreground : 0);
    example.draw(buffer.surface(dark));

    std::string out;
    for (int y = 0; y < buffer.height(); ++y) {
      std::string row = buffer.row(y);
      while (!row.empty() && row.back() == ' ') row.pop_back();
      out += row;
      out += '\n';
    }
    if (out.find_first_not_of(" \n") == std::string::npos) {
      std::fprintf(stderr, "FAIL %s: rendered an empty screen\n", example.name);
      ++blank;
      continue;
    }
    std::printf("--- %s\n%s", example.name, out.c_str());
  }

  const int total = static_cast<int>(sizeof(examples) / sizeof(examples[0]));
  std::fprintf(stderr, "%d/%d widget examples rendered\n", total - blank, total);
  return blank == 0 ? 0 : 1;
}
