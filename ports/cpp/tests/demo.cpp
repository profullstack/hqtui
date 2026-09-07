#define HQTUI_DEMO_TEST
#include "../demo/main.cpp"

static void require(bool value, const char *message) {
  if (!value)
    throw std::runtime_error(message);
}
int main() {
  using namespace demo;
  try {
    for (auto source : {"{", "[1,]", "{\"x\":1,\"x\":2}", "1e999", "01",
                        "\"\\uD800\"", "true false"}) {
      bool rejected = false;
      try {
        Json::parse(source);
      } catch (const std::exception &) {
        rejected = true;
      }
      require(rejected, "Malformed JSON accepted");
    }
    require(Json::parse("\"\\uD83D\\uDE80\"").s() == "🚀", "JSON Unicode pair");
    auto shape = Json::parse(sample_json);
    Collector collector(shape);
    require(collector.data["sensors"].array().empty() &&
                collector.data["processes"].array().empty(),
            "real data contains simulated rows");
    require(collector.data["telemetry"]["http"].null() &&
                collector.data["telemetry"]["power"].null(),
            "missing sources not null");
    State s;
    s.data = shape;
    Input input;
    require(!input.feed(s, "\x1b") && !input.feed(s, "O") &&
                !input.feed(s, "P") && s.help,
            "split F1");
    require(!input.feed(s, "q") && !s.help, "help must consume q");
    input.feed(s, "e");
    input.feed(s, "\x1b[B");
    require(s.input.empty(), "arrow inserted text");
    input.feed(s, "q");
    require(s.input == "q", "editing swallowed q");
    input.feed(s, "\x1b[200~hello");
    input.feed(s, " world\x1b[201~");
    require(s.input == "qhello world", "split bracketed paste");
    input.feed(s, "\r");
    require(!s.editing, "finish editing");
    input.feed(s, "3");
    require(s.screen == 2, "numeric tab");
    Pane pane;
    pane.selected = 49;
    Table table;
    table.header = false;
    table.pane = &pane;
    table.columns = {{"Path", -1, 1, 0, HQ_LEFT}};
    for (int i = 0; i < 50; i++)
      table.rows.push_back({{"route-" + std::to_string(i)}, {}});
    Buffer frame(20, 3);
    auto t = hq_theme_named("dark");
    frame.clear(t->background, t->foreground);
    draw_table(frame.surface(t), table);
    require(pane.offset == 47 &&
                frame.row(2).find("route-49") != std::string::npos,
            "table used wrong viewport");
    Pane log;
    log.log = true;
    log.total = 50;
    log.move(-3);
    require(log.offset == 3, "log scroll direction");
    log.move(100);
    require(log.offset == 0, "log tail clamp");
    s.regions = {{{0, 0, 20, 3}, "test.pane", 0}};
    s.panes["test.pane"].total = 50;
    input.feed(s, "\x1b[<65;2;2M");
    require(s.panes["test.pane"].selected == 3, "mouse wheel");
    s.filtering = true;
    input.feed(s, "\x1b[<65;2;2M");
    require(s.panes["test.pane"].selected == 3, "overlay leaked mouse input");
    std::atomic<bool> cancel{false};
    auto start = std::chrono::steady_clock::now();
    command({"sh", "-c", "exec 1>&-; sleep 20"}, &cancel, 100);
    require(std::chrono::steady_clock::now() - start < std::chrono::seconds(1),
            "child closing stdout blocked exit");
    start = std::chrono::steady_clock::now();
    command({"sh", "-c", "sleep 20"}, &cancel, 100);
    require(std::chrono::steady_clock::now() - start < std::chrono::seconds(1),
            "command deadline");
    cancel = true;
    require(command({"sh", "-c", "echo must-not-run"}, &cancel).empty(),
            "cancelled command ran");
    for (int width : {1, 2, 20, 80, 500})
      for (int height : {1, 2, 8, 30, 200})
        for (int screen = 0; screen < 10; screen++) {
          State state;
          state.data = shape;
          state.screen = screen;
          Buffer b(width, height);
          b.clear(t->background, t->foreground);
          UI ui(b.surface(t));
          render(ui, state, true);
          ui.flush();
        }
    std::cout << "C++ input, JSON, viewport, real-data isolation, subprocess "
                 "and extreme-size tests passed.\n";
  } catch (const std::exception &e) {
    std::cerr << e.what() << "\n";
    return 1;
  }
}
