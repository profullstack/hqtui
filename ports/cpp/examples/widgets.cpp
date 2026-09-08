// Every widget the C++ port draws, one function each.
//
// Built as the `hqtui-widgets` target; running it renders all of them
// headlessly and prints the result, so this file is a program rather than a
// snippet dump. The `@widget` / `@end` markers are what hqtui.com/widgets
// slices to show the code for one widget, which is why a snippet on the site
// is always a region of something that compiles.
//
// C++ draws straight onto a Surface rather than describing a tree, so each
// function here places its own widgets rather than nesting containers. It
// covers the same twenty-eight widgets every other native port does, checked
// against the shared fixtures by tests/conformance_widgets.cpp.

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

// @widget scrollbar
void widget_scrollbar(Surface s) {
  // The bar is over state you own, so it works beside anything that scrolls:
  // wrapped prose, a canvas, a draw() of your own. Here it takes the rightmost
  // column and the prose takes the rest.
  int w = s.rect().width, h = s.rect().height;
  const auto &t = theme(s);
  draw_text(s.sub({0, 0, w - 2, h}),
            "A scrollbar you drive yourself. It has no idea what is beside it, "
            "only how much there is, how much fits, and where you are.",
            TextStyle{t.foreground, std::nullopt, HQ_LEFT, 0, true});
  draw_scrollbar(s.sub({w - 1, 0, 1, h}), Scrollbar{40, 5, 12, HQ_SCROLLBAR_RIGHT});
}
// @end

// @widget meter
void widget_meter(Surface s) {
  const int width = s.rect().width;
  {
    Meter meter;
    meter.value = 0.87;
    meter.label = "SWP";
    {
    Meter meter;
    meter.value = 0.31;
    meter.label = "MEM";
    {
    Meter meter;
    meter.value = 0.62;
    meter.label = "CPU";
    draw_meter(s.sub(Rect{0, 0, width, 1}), meter);
  }
  draw_meter(s.sub(Rect{0, 1, width, 1}), meter);
  }
  draw_meter(s.sub(Rect{0, 2, width, 1}), meter);
  }
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

// @widget label
void widget_label(Surface s) {
  // Muted secondary copy: captions, and the line under a number that says what
  // the number is.
  const auto &t = theme(s);
  {
    TextStyle text_style;
    text_style.fg = t.muted;
    {
    TextStyle text_style;
    text_style.attrs = HQ_BOLD;
    {
    TextStyle text_style;
    text_style.fg = t.muted;
    draw_text(s, "cpu · 8 cores · 3.4 GHz", text_style);
  }
  draw_text(s.sub(Rect{0, 1, s.rect().width, 1}), "42.1%", text_style);
  }
  draw_text(s.sub(Rect{0, 2, s.rect().width, 1}), "15 minute average",
            text_style);
  }
}
// @end

// @widget heading
void widget_heading(Surface s) {
  const auto &t = theme(s);
  {
    TextStyle text_style;
    text_style.fg = t.muted;
    {
    TextStyle text_style;
    text_style.fg = t.title;
    text_style.attrs = HQ_BOLD;
    draw_text(s, "Storage", text_style);
  }
  draw_text(s.sub(Rect{0, 1, s.rect().width, 1}), "Four volumes, one degraded",
            text_style);
  }
}
// @end

// @widget badge
void widget_badge(Surface s) {
  const auto &t = theme(s);
  {
    Badge badge;
    badge.text = "failed";
    badge.color = t.danger;
    badge.variant = HQ_BADGE_OUTLINE;
    {
    Badge badge;
    badge.text = "idle";
    badge.color = t.warning;
    badge.variant = HQ_BADGE_SUBTLE;
    {
    Badge badge;
    badge.text = "active";
    badge.color = t.success;
    draw_badge(s.sub(Rect{0, 0, 10, 1}), badge);
  }
  draw_badge(s.sub(Rect{10, 0, 10, 1}),
             badge);
  }
  draw_badge(s.sub(Rect{20, 0, 10, 1}),
             badge);
  }
}
// @end

// @widget divider
void widget_divider(Surface s) {
  draw_text(s, "Above the line");
  draw_divider(s.sub(Rect{0, 1, s.rect().width, 1}));
  draw_text(s.sub(Rect{0, 2, s.rect().width, 1}), "Below it");
  {
    Divider divider;
    divider.label = "status";
    divider.align = HQ_CENTER;
    draw_divider(s.sub(Rect{0, 3, s.rect().width, 1}),
               divider);
  }
}
// @end

// @widget meters
void widget_meters(Surface s) {
  // One call for a whole bank. `columns` lays them out side by side.
  Meters m;
  for (int i = 0; i < 8; i++)
    m.items.push_back({"P" + std::to_string(i), (i * 13 % 100) / 100., 0, 0, ""});
  m.columns = 2;
  m.label_width = 4;
  m.value_width = 5;
  m.style = HQ_BAR_SEGMENTED;
  draw_meters(s, m);
}
// @end

// @widget progress
void widget_progress(Surface s) {
  {
    Progress progress;
    progress.value = 0.82;
    progress.label = "Upload";
    {
    Progress progress;
    progress.value = 37;
    progress.max = 120;
    progress.label = "Indexing";
    progress.show_count = true;
    draw_progress(s, progress);
  }
  draw_progress(s.sub(Rect{0, 1, s.rect().width, 1}),
                progress);
  }
}
// @end

// @widget sparkline
void widget_sparkline(Surface s) {
  {
    Sparkline sparkline;
    sparkline.values = cpu_history();
    sparkline.label = "CPU ";
    sparkline.text = "44%";
    draw_sparkline(s, sparkline);
  }
}
// @end

// @widget histogram
void widget_histogram(Surface s) {
  {
    Columns columns;
    columns.values = cpu_history();
    // Block columns. Cheaper than Braille and easier to read when short.
  draw_columns(s, columns);
  }
}
// @end

// @widget heatBar
void widget_heat_bar(Surface s) {
  {
    HeatBar heat_bar;
    heat_bar.value = 0.91;
    {
    HeatBar heat_bar;
    heat_bar.value = 0.64;
    {
    HeatBar heat_bar;
    heat_bar.value = 0.28;
    // Coloured along the theme's heat ramp, like btop's temperatures.
  draw_heat_bar(s, heat_bar);
  }
  draw_heat_bar(s.sub(Rect{0, 1, s.rect().width, 1}), heat_bar);
  }
  draw_heat_bar(s.sub(Rect{0, 2, s.rect().width, 1}), heat_bar);
  }
}
// @end

// @widget donut
void widget_donut(Surface s) {
  const auto &t = theme(s);
  Donut d;
  d.segments = {{4.65, t.primary, "Used"}, {10.96, t.warning, "Free"}};
  draw_donut(s, d);
}
// @end

// @widget list
void widget_list(Surface s) {
  List l;
  l.items = {{"apps/demo"}, {"packages/hqtui"}, {"apps/web"}, {"docs"}};
  l.selected = 0;
  l.bullet = "▸";
  l.scrollbar = true;
  draw_list(s, l);
}
// @end

// @widget tree
void widget_tree(Surface s) {
  Tree tree;
  TreeNode root;
  root.label = "systemd";
  {
    TreeNode tree_node;
    tree_node.label = "bash";
    root.children.push_back(tree_node);
  }
  TreeNode bun;
  bun.label = "bun";
  {
    TreeNode tree_node;
    tree_node.label = "bun:worker";
    bun.children.push_back(tree_node);
  }
  root.children.push_back(bun);
  {
    TreeNode tree_node;
    tree_node.label = "postgres";
    root.children.push_back(tree_node);
  }
  tree.nodes.push_back(root);
  tree.selected = 2;
  draw_tree(s, tree);
}
// @end

// @widget button
void widget_button(Surface s) {
  {
    Button button;
    button.label = "Danger";
    button.variant = HQ_BUTTON_DANGER;
    {
    Button button;
    button.label = "Success";
    button.variant = HQ_BUTTON_SUCCESS;
    {
    Button button;
    button.label = "Primary";
    draw_button(s.sub(Rect{0, 0, 11, 1}), button);
  }
  draw_button(s.sub(Rect{12, 0, 11, 1}), button);
  }
  draw_button(s.sub(Rect{24, 0, 10, 1}), button);
  }
}
// @end

// @widget checkbox
void widget_checkbox(Surface s) {
  {
    Checkbox checkbox;
    checkbox.label = "Checkbox";
    {
    Checkbox checkbox;
    checkbox.label = "Toggle";
    checkbox.checked = true;
    checkbox.variant = HQ_CHECKBOX_TOGGLE;
    draw_checkbox(s.sub(Rect{0, 0, 14, 1}),
                checkbox);
  }
  draw_checkbox(s.sub(Rect{16, 0, 14, 1}), checkbox);
  }
}
// @end

// @widget select
void widget_select(Surface s) {
  {
    Select select;
    select.value = "Dracula";
    select.open = true;
    select.options = {"Dark", "Dracula", "Nord", "Tokyo Night"};
    select.selected_index = 1;
    select.width = 20;
    draw_select(s, select);
  }
}
// @end

// @widget textInput
void widget_text_input(Surface s) {
  {
    TextInput text_input;
    text_input.placeholder = "type to filter…";
    text_input.label = "Filter";
    {
    TextInput text_input;
    text_input.value = "postgres";
    text_input.label = "Search";
    draw_text_input(s, text_input);
  }
  draw_text_input(s.sub(Rect{0, 2, s.rect().width, 1}),
                  text_input);
  }
}
// @end

// @widget tabs
void widget_tabs(Surface s) {
  {
    Tabs tabs;
    tabs.tabs = {"1 dashboard", "2 traffic", "3 sessions", "4 network"};
    tabs.active = 1;
    draw_tabs(s, tabs);
  }
}
// @end

// @widget statusBar
void widget_status_bar(Surface s) {
  {
    StatusBar status_bar;
    status_bar.items = {{"F1", "Help"}, {"F2", "Theme"}, {"F3", "Filter", 0, true}, {"q", "Quit"}};
    status_bar.right = {{"", "0.41ms 184 cells"}};
    // Usually the last thing drawn, pinned to the bottom row.
  draw_status_bar(s, status_bar);
  }
}
// @end

// @widget modal
void widget_modal(Surface s) {
  // Overlays draw over everything already on the screen, centred.
  Modal modal;
  modal.title = "Confirm Action";
  modal.message = "Terminate process 4821 (postgres)?";
  modal.width = 46;
  modal.height = 9;
  ModalButton yes;
  yes.label = "Yes";
  yes.variant = HQ_BUTTON_SUCCESS;
  yes.focused = true;
  ModalButton no;
  no.label = "No";
  no.variant = HQ_BUTTON_GHOST;
  modal.buttons = {yes, no};
  draw_modal(s, modal);
}
// @end

// @widget commandPalette
void widget_command_palette(Surface s) {
  CommandPalette palette;
  palette.query = "the";
  palette.items = {{"Toggle theme", "F2"}, {"Filter processes", "F3"}, {"Sort by memory", "F6"}};
  draw_command_palette(s, palette);
}
// @end

// @widget tooltip
void widget_tooltip(Surface s) {
  draw_text(s, "Tooltips are overlays positioned at a cell.");
  {
    Tooltip tooltip;
    tooltip.text = "swap is 87% full";
    tooltip.x = 6;
    tooltip.y = 3;
    draw_tooltip(s, tooltip);
  }
}
// @end

int main() {
  struct Example {
    const char *name;
    void (*draw)(Surface);
  };
  const Example examples[] = {
      {"text", widget_text},
      {"label", widget_label},
      {"heading", widget_heading},
      {"badge", widget_badge},
      {"divider", widget_divider},
      {"keyValues", widget_key_values},
      {"statusBar", widget_status_bar},
      {"table", widget_table},
      {"list", widget_list},
      {"tree", widget_tree},
      {"log", widget_log},
      {"scrollbar", widget_scrollbar},
      {"meter", widget_meter},
      {"meters", widget_meters},
      {"progress", widget_progress},
      {"graph", widget_graph},
      {"sparkline", widget_sparkline},
      {"histogram", widget_histogram},
      {"heatBar", widget_heat_bar},
      {"gauge", widget_gauge},
      {"donut", widget_donut},
      {"button", widget_button},
      {"checkbox", widget_checkbox},
      {"select", widget_select},
      {"textInput", widget_text_input},
      {"tabs", widget_tabs},
      {"modal", widget_modal},
      {"commandPalette", widget_command_palette},
      {"tooltip", widget_tooltip},
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
