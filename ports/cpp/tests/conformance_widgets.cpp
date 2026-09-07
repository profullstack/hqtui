// Every widget, drawn with the same arguments the fixture generator used, and
// compared against what the TypeScript reference produced.
//
// The other native ports have had this for a while; C++ did not, which is how
// it ended up implementing seven widgets while claiming to be a port. A scene
// with no case here is reported as missing rather than skipped, so the gap is
// visible in the test output instead of in a coverage table nobody reads.
//
// Rows are compared as text. The fixture also carries per-cell colour, which
// the richer ports check; text catches every structural difference and is what
// tells you *what* drifted rather than merely where.

#include <cstdio>
#include <limits>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <hqtui.hpp>
#include <hqtui/widgets.hpp>

#include "json.hpp"

using namespace hqtui;
using demo::Json;

namespace {

const std::vector<double> kSeries{3, 7, 2, 9, 4, 8, 6, 1, 5, 9,
                                  3, 7, 8, 2, 6, 4, 9, 1, 5, 7};

/// Draws one named scene. Returns false when C++ has no implementation yet.
bool draw_scene(const std::string &name, Surface s) {
  const auto &t = theme(s);

  if (name == "text-plain") {
    draw_text(s, "hello terminal");
    return true;
  }
  if (name == "text-wrapped") {
    draw_text(s, "the quick brown fox jumps", TextStyle{.wrap = true});
    return true;
  }
  if (name == "text-aligned") {
    draw_text(s.sub({0, 0, 20, 1}), "left", TextStyle{.align = HQ_LEFT});
    draw_text(s.sub({0, 1, 20, 1}), "center", TextStyle{.align = HQ_CENTER});
    draw_text(s.sub({0, 2, 20, 1}), "right", TextStyle{.align = HQ_RIGHT});
    return true;
  }
  if (name == "badge") {
    draw_badge(s, Badge{.text = "LIVE"});
    return true;
  }
  if (name == "badge-outline") {
    draw_badge(s, Badge{.text = "IDLE", .variant = HQ_BADGE_OUTLINE});
    return true;
  }
  if (name == "badge-subtle") {
    draw_badge(s, Badge{.text = "WARN", .variant = HQ_BADGE_SUBTLE});
    return true;
  }
  if (name == "divider") {
    draw_divider(s, Divider{.label = "Section"});
    return true;
  }
  if (name == "keyvalues") {
    std::vector<KeyValue> rows{{"Host", "seed1"}, {"Uptime", "12d 4h"}, {"Load", "0.42"}};
    draw_keys(s, rows);
    return true;
  }
  if (name == "meter") {
    draw_meter(s, Meter{.value = 0.72, .label = "CPU"});
    return true;
  }
  if (name == "meter-segmented") {
    draw_meter(s, Meter{.value = 0.33, .label = "MEM", .segmented = true});
    return true;
  }
  if (name == "meter-ascii") {
    draw_meter(s, Meter{.value = 0.9, .label = "IO", .ascii = true});
    return true;
  }
  if (name == "meter-nan") {
    draw_meter(s, Meter{.value = std::numeric_limits<double>::quiet_NaN(), .label = "BAD"});
    return true;
  }
  if (name == "meters-grid") {
    Meters m;
    m.items = {{"c0", 0.2}, {"c1", 0.5}, {"c2", 0.8}, {"c3", 1}, {"c4", 0}, {"c5", 0.65}};
    m.columns = 2;
    draw_meters(s, m);
    return true;
  }
  if (name == "progress") {
    draw_progress(s, Progress{.value = 37, .max = 120, .label = "Sync", .show_count = true});
    return true;
  }
  if (name == "bar-smooth") {
    draw_bar(s, Bar{.value = 0.63});
    return true;
  }
  if (name == "bar-segmented") {
    draw_bar(s, Bar{.value = 0.63, .style = HQ_BAR_SEGMENTED});
    return true;
  }
  if (name == "bar-ascii") {
    draw_bar(s, Bar{.value = 0.63, .style = HQ_BAR_ASCII});
    return true;
  }
  if (name == "sparkline") {
    draw_spark(s, kSeries);
    return true;
  }
  if (name == "sparkline-widget") {
    draw_sparkline(s, Sparkline{.values = kSeries, .label = "net", .text = "1.2M"});
    return true;
  }
  if (name == "heat-bar") {
    draw_heat_bar(s, HeatBar{.value = 0.6});
    return true;
  }
  if (name == "columns") {
    draw_columns(s, Columns{.values = kSeries});
    return true;
  }
  if (name == "gauge") {
    draw_gauge(s, 0.7, "70%");
    return true;
  }
  if (name == "scrollbar") {
    draw_scrollbar(s, 1, 0, 8, 40, 12);
    return true;
  }
  if (name == "table") {
    Table table;
    table.columns = {{"PID", -1, 1, 0, HQ_RIGHT}, {"NAME"}, {"CPU%", -1, 1, 0, HQ_RIGHT}};
    table.rows = {{{"1", "systemd", "0.1"}}, {{"420", "node", "12.5"}}, {{"900", "hqtui-demo", "3.2"}}};
    table.zebra = true;
    Pane pane;
    pane.selected = 1;
    pane.total = 3;
    table.pane = &pane;
    draw_table(s, table);
    return true;
  }
  if (name == "button") {
    draw_button(s, Button{.label = "OK"});
    return true;
  }
  if (name == "button-focused") {
    draw_button(s, Button{.label = "Run", .focused = true});
    return true;
  }
  if (name == "button-variants") {
    draw_button(s.sub({0, 0, 10, 1}), Button{.label = "ok", .variant = HQ_BUTTON_SUCCESS});
    draw_button(s.sub({10, 0, 10, 1}), Button{.label = "hm", .variant = HQ_BUTTON_WARNING});
    draw_button(s.sub({20, 0, 10, 1}), Button{.label = "no", .variant = HQ_BUTTON_DANGER});
    draw_button(s.sub({30, 0, 10, 1}), Button{.label = "gh", .variant = HQ_BUTTON_GHOST});
    return true;
  }
  if (name == "checkbox") {
    draw_checkbox(s.sub({0, 0, 24, 1}), Checkbox{.label = "on", .checked = true});
    draw_checkbox(s.sub({0, 1, 24, 1}), Checkbox{.label = "toggle", .variant = HQ_CHECKBOX_TOGGLE});
    draw_checkbox(s.sub({0, 2, 24, 1}),
                  Checkbox{.label = "radio", .checked = true, .variant = HQ_CHECKBOX_RADIO});
    return true;
  }
  if (name == "select-closed") {
    draw_select(s, Select{.value = "dark"});
    return true;
  }
  if (name == "select-open") {
    draw_select(s, Select{.value = "dark",
                          .open = true,
                          .options = {"dark", "nord", "light"},
                          .selected_index = 1});
    return true;
  }
  if (name == "text-input") {
    draw_text_input(s, TextInput{.value = "seed", .label = "host", .focused = true});
    return true;
  }
  if (name == "text-input-password") {
    draw_text_input(s, TextInput{.value = "hunter2", .password = true});
    return true;
  }
  if (name == "text-input-placeholder") {
    draw_text_input(s, TextInput{.value = "", .placeholder = "search…"});
    return true;
  }
  if (name == "tabs") {
    draw_tabs(s, Tabs{.tabs = {"cpu", "mem", "net"}, .active = 1});
    return true;
  }
  if (name == "tabs-underline") {
    draw_tabs(s, Tabs{.tabs = {"a", "b"}, .active = 0, .variant = HQ_TAB_UNDERLINE});
    return true;
  }
  if (name == "status-bar") {
    draw_status_bar(s, StatusBar{.items = {{"F1", "Help"}, {"F10", "Quit"}},
                                 .right = {{"", "30fps"}}});
    return true;
  }
  if (name == "list") {
    List list;
    list.items = {{"alpha"}, {"beta"}, {"gamma"}, {"delta"}};
    list.selected = 2;
    list.bullet = "•";
    draw_list(s, list);
    return true;
  }
  if (name == "tree") {
    Tree tree;
    TreeNode root{.label = "root"};
    TreeNode a{.label = "child-a"};
    a.children.push_back(TreeNode{.label = "leaf"});
    root.children.push_back(a);
    root.children.push_back(TreeNode{.label = "child-b"});
    tree.nodes.push_back(root);
    tree.nodes.push_back(TreeNode{.label = "second"});
    tree.selected = 1;
    draw_tree(s, tree);
    return true;
  }
  if (name == "log") {
    std::vector<LogEntry> entries{
        {"10:00:00", "INFO", "started", ""},
        {"10:00:01", "WARN", "slow query", "412ms"},
        {"10:00:02", "ERROR", "connection reset", ""},
    };
    Pane pane;
    pane.log = true;
    pane.total = 3;
    draw_log(s, entries, &pane);
    return true;
  }
  (void)t;
  return false;
}

std::string read_file(const std::string &path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    std::fprintf(stderr, "cannot open %s\n", path.c_str());
    std::exit(2);
  }
  std::ostringstream out;
  out << in.rdbuf();
  return out.str();
}

}  // namespace

int main(int argc, char **argv) {
  const std::string path = argc > 1 ? argv[1] : "../conformance/fixtures/widgets.json";
  const Json fixtures = Json::parse(read_file(path));

  const hq_theme *dark = hq_theme_named("dark");
  int compared = 0, failed = 0;
  std::vector<std::string> missing;

  for (const auto &scene : fixtures.array()) {
    const std::string name = scene["name"].s("");
    const int width = int(scene["width"].n());
    const int height = int(scene["height"].n());

    Buffer buffer(width, height);
    buffer.clear(dark ? dark->background : 0, dark ? dark->foreground : 0);
    if (!draw_scene(name, buffer.surface(dark))) {
      missing.push_back(name);
      continue;
    }

    ++compared;
    const auto &want = scene["result"]["text"].array();
    for (int y = 0; y < height; ++y) {
      std::string got = buffer.row(y);
      // The fixture trims each row's trailing spaces; do the same rather than
      // teaching the reference to pad.
      while (!got.empty() && got.back() == ' ') got.pop_back();
      std::string expected = y < int(want.size()) ? want[size_t(y)].s("") : "";
      while (!expected.empty() && expected.back() == ' ') expected.pop_back();
      if (got != expected) {
        std::fprintf(stderr, "%s row %d:\n  want %s\n  got  %s\n", name.c_str(), y,
                     expected.c_str(), got.c_str());
        ++failed;
        break;
      }
    }
  }

  std::fprintf(stderr, "%d scenes compared, %zu not implemented in C++\n", compared,
               missing.size());
  if (!missing.empty()) {
    std::fprintf(stderr, "missing:");
    for (const auto &name : missing) std::fprintf(stderr, " %s", name.c_str());
    std::fprintf(stderr, "\n");
  }
  if (failed > 0) std::fprintf(stderr, "%d scenes differ from the reference\n", failed);
  return failed == 0 ? 0 : 1;
}
