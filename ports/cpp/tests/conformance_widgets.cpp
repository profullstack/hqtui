// Every widget, drawn with the same arguments the fixture generator used, and
// compared against what the TypeScript reference produced.
//
// The other native ports have had this for a while; C++ did not, which is how
// it ended up implementing seven widgets while claiming to be a port. All 53
// scenes are covered now. A scene with no case here is reported as missing
// rather than skipped, so a future gap shows up in the test output instead of
// in a coverage table nobody reads.
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
    {
      TextStyle text_style;
      text_style.wrap = true;
      draw_text(s, "the quick brown fox jumps", text_style);
    }
    return true;
  }
  if (name == "text-aligned") {
    {
      TextStyle text_style;
      text_style.align = HQ_RIGHT;
      {
      TextStyle text_style;
      text_style.align = HQ_CENTER;
      {
      TextStyle text_style;
      text_style.align = HQ_LEFT;
      draw_text(s.sub({0, 0, 20, 1}), "left", text_style);
    }
    draw_text(s.sub({0, 1, 20, 1}), "center", text_style);
    }
    draw_text(s.sub({0, 2, 20, 1}), "right", text_style);
    }
    return true;
  }
  if (name == "badge") {
    {
      Badge badge;
      badge.text = "LIVE";
      draw_badge(s, badge);
    }
    return true;
  }
  if (name == "badge-outline") {
    {
      Badge badge;
      badge.text = "IDLE";
      badge.variant = HQ_BADGE_OUTLINE;
      draw_badge(s, badge);
    }
    return true;
  }
  if (name == "badge-subtle") {
    {
      Badge badge;
      badge.text = "WARN";
      badge.variant = HQ_BADGE_SUBTLE;
      draw_badge(s, badge);
    }
    return true;
  }
  if (name == "divider") {
    {
      Divider divider;
      divider.label = "Section";
      draw_divider(s, divider);
    }
    return true;
  }
  if (name == "keyvalues") {
    std::vector<KeyValue> rows{{"Host", "seed1"}, {"Uptime", "12d 4h"}, {"Load", "0.42"}};
    draw_keys(s, rows);
    return true;
  }
  if (name == "meter") {
    {
      Meter meter;
      meter.value = 0.72;
      meter.label = "CPU";
      draw_meter(s, meter);
    }
    return true;
  }
  if (name == "meter-segmented") {
    {
      Meter meter;
      meter.value = 0.33;
      meter.label = "MEM";
      meter.segmented = true;
      draw_meter(s, meter);
    }
    return true;
  }
  if (name == "meter-ascii") {
    {
      Meter meter;
      meter.value = 0.9;
      meter.label = "IO";
      meter.ascii = true;
      draw_meter(s, meter);
    }
    return true;
  }
  if (name == "meter-nan") {
    {
      Meter meter;
      meter.value = std::numeric_limits<double>::quiet_NaN();
      meter.label = "BAD";
      draw_meter(s, meter);
    }
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
    {
      Progress progress;
      progress.value = 37;
      progress.max = 120;
      progress.label = "Sync";
      progress.show_count = true;
      draw_progress(s, progress);
    }
    return true;
  }
  if (name == "bar-smooth") {
    {
      Bar bar;
      bar.value = 0.63;
      draw_bar(s, bar);
    }
    return true;
  }
  if (name == "bar-segmented") {
    {
      Bar bar;
      bar.value = 0.63;
      bar.style = HQ_BAR_SEGMENTED;
      draw_bar(s, bar);
    }
    return true;
  }
  if (name == "bar-ascii") {
    {
      Bar bar;
      bar.value = 0.63;
      bar.style = HQ_BAR_ASCII;
      draw_bar(s, bar);
    }
    return true;
  }
  if (name == "sparkline") {
    draw_spark(s, kSeries);
    return true;
  }
  if (name == "sparkline-widget") {
    {
      Sparkline sparkline;
      sparkline.values = kSeries;
      sparkline.label = "net";
      sparkline.text = "1.2M";
      draw_sparkline(s, sparkline);
    }
    return true;
  }
  if (name == "heat-bar") {
    {
      HeatBar heat_bar;
      heat_bar.value = 0.6;
      draw_heat_bar(s, heat_bar);
    }
    return true;
  }
  if (name == "columns") {
    {
      Columns columns;
      columns.values = kSeries;
      draw_columns(s, columns);
    }
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
  if (name == "graph-axis") {
    Graph g;
    g.series = {{kSeries, 0, "", false}};
    g.axis = true;
    draw_graph(s, g);
    return true;
  }
  if (name == "plot-braille") {
    Graph g;
    g.series = {{kSeries, 0, "", false}};
    draw_graph(s, g);
    return true;
  }
  if (name == "plot-block") {
    Graph g;
    g.series = {{kSeries, 0, "", false}};
    g.mode = "block";
    draw_graph(s, g);
    return true;
  }
  if (name == "plot-ascii") {
    Graph g;
    g.series = {{kSeries, 0, "", false}};
    g.mode = "ascii";
    draw_graph(s, g);
    return true;
  }
  if (name == "plot-fill") {
    Graph g;
    g.series = {{kSeries, 0, "", true}};
    draw_graph(s, g);
    return true;
  }
  if (name == "plot-grid") {
    Graph g;
    g.series = {{kSeries, 0, "", false}};
    g.grid = true;
    draw_graph(s, g);
    return true;
  }
  if (name == "plot-multi") {
    std::vector<double> inverted;
    for (double v : kSeries) inverted.push_back(10 - v);
    Graph g;
    g.series = {{kSeries, 0, "", false}, {inverted, 0, "", false}};
    draw_graph(s, g);
    return true;
  }
  if (name == "graph-legend") {
    std::vector<double> halved;
    for (double v : kSeries) halved.push_back(v / 2);
    Graph g;
    g.series = {{kSeries, 0, "rx", false}, {halved, 0, "tx", false}};
    g.legend = true;
    draw_graph(s, g);
    return true;
  }
  if (name == "graph-timeaxis") {
    Graph g;
    g.series = {{kSeries, 0, "", false}};
    g.time_axis = {"60s", "30s", "0s"};
    draw_graph(s, g);
    return true;
  }
  // Both axes together. Each was covered alone, which is how the y-axis minimum
  // came to be drawn onto the time-axis row with no fixture noticing.
  if (name == "graph-axis-timeaxis") {
    Graph g;
    g.series = {{kSeries, 0, "", false}};
    g.axis = true;
    g.min = 0;
    g.max = 100;
    g.time_axis = {"60s", "30s", "0s"};
    draw_graph(s, g);
    return true;
  }
  if (name == "table-scrollbar") {
    Table table;
    table.columns = {{"#", -1, 1, 0, HQ_RIGHT}, {"VALUE"}};
    for (int i = 0; i < 20; i++)
      table.rows.push_back({{std::to_string(i), "row " + std::to_string(i)}});
    Pane pane;
    pane.selected = 12;
    pane.total = 20;
    table.pane = &pane;
    table.scrollbar = true;
    draw_table(s, table);
    return true;
  }
  if (name == "donut") {
    Donut d;
    d.segments = {{3}, {5}, {2}};
    draw_donut(s, d);
    return true;
  }
  if (name == "modal") {
    Modal modal;
    modal.title = "Confirm";
    modal.message = "Restart the service?";
    ModalButton yes;
    yes.label = "Yes";
    yes.focused = true;
    ModalButton no;
    no.label = "No";
    modal.buttons = {yes, no};
    draw_modal(s, modal);
    return true;
  }
  if (name == "command-palette") {
    CommandPalette palette;
    palette.query = "th";
    palette.items = {{"theme: dark", "T"}, {"theme: nord", ""}};
    draw_command_palette(s, palette);
    return true;
  }
  if (name == "tooltip") {
    {
      Tooltip tooltip;
      tooltip.text = "hint";
      tooltip.x = 4;
      tooltip.y = 2;
      draw_tooltip(s, tooltip);
    }
    return true;
  }
  if (name == "button") {
    {
      Button button;
      button.label = "OK";
      draw_button(s, button);
    }
    return true;
  }
  if (name == "button-focused") {
    {
      Button button;
      button.label = "Run";
      button.focused = true;
      draw_button(s, button);
    }
    return true;
  }
  if (name == "button-variants") {
    {
      Button button;
      button.label = "gh";
      button.variant = HQ_BUTTON_GHOST;
      {
      Button button;
      button.label = "no";
      button.variant = HQ_BUTTON_DANGER;
      {
      Button button;
      button.label = "hm";
      button.variant = HQ_BUTTON_WARNING;
      {
      Button button;
      button.label = "ok";
      button.variant = HQ_BUTTON_SUCCESS;
      draw_button(s.sub({0, 0, 10, 1}), button);
    }
    draw_button(s.sub({10, 0, 10, 1}), button);
    }
    draw_button(s.sub({20, 0, 10, 1}), button);
    }
    draw_button(s.sub({30, 0, 10, 1}), button);
    }
    return true;
  }
  if (name == "checkbox") {
    {
      Checkbox checkbox;
      checkbox.label = "radio";
      checkbox.checked = true;
      checkbox.variant = HQ_CHECKBOX_RADIO;
      {
      Checkbox checkbox;
      checkbox.label = "toggle";
      checkbox.variant = HQ_CHECKBOX_TOGGLE;
      {
      Checkbox checkbox;
      checkbox.label = "on";
      checkbox.checked = true;
      draw_checkbox(s.sub({0, 0, 24, 1}), checkbox);
    }
    draw_checkbox(s.sub({0, 1, 24, 1}), checkbox);
    }
    draw_checkbox(s.sub({0, 2, 24, 1}),
                  checkbox);
    }
    return true;
  }
  if (name == "select-closed") {
    {
      Select select;
      select.value = "dark";
      draw_select(s, select);
    }
    return true;
  }
  if (name == "select-open") {
    {
      Select select;
      select.value = "dark";
      select.open = true;
      select.options = {"dark", "nord", "light"};
      select.selected_index = 1;
      draw_select(s, select);
    }
    return true;
  }
  if (name == "text-input") {
    {
      TextInput text_input;
      text_input.value = "seed";
      text_input.label = "host";
      text_input.focused = true;
      draw_text_input(s, text_input);
    }
    return true;
  }
  if (name == "text-input-password") {
    {
      TextInput text_input;
      text_input.value = "hunter2";
      text_input.password = true;
      draw_text_input(s, text_input);
    }
    return true;
  }
  if (name == "text-input-placeholder") {
    {
      TextInput text_input;
      text_input.value = "";
      text_input.placeholder = "search…";
      draw_text_input(s, text_input);
    }
    return true;
  }
  if (name == "tabs") {
    {
      Tabs tabs;
      tabs.tabs = {"cpu", "mem", "net"};
      tabs.active = 1;
      draw_tabs(s, tabs);
    }
    return true;
  }
  if (name == "tabs-underline") {
    {
      Tabs tabs;
      tabs.tabs = {"a", "b"};
      tabs.active = 0;
      tabs.variant = HQ_TAB_UNDERLINE;
      draw_tabs(s, tabs);
    }
    return true;
  }
  if (name == "status-bar") {
    {
      StatusBar status_bar;
      status_bar.items = {{"F1", "Help"}, {"F10", "Quit"}};
      status_bar.right = {{"", "30fps"}};
      draw_status_bar(s, status_bar);
    }
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
    TreeNode root;
    root.label = "root";
    TreeNode a;
    a.label = "child-a";
    {
      TreeNode tree_node;
      tree_node.label = "leaf";
      a.children.push_back(tree_node);
    }
    root.children.push_back(a);
    {
      TreeNode tree_node;
      tree_node.label = "child-b";
      root.children.push_back(tree_node);
    }
    tree.nodes.push_back(root);
    {
      TreeNode tree_node;
      tree_node.label = "second";
      tree.nodes.push_back(tree_node);
    }
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
