#include "collect.hpp"
#include "model.hpp"
#include "sample.hpp"
#include <atomic>
#include <condition_variable>
#include <csignal>
#include <cstring>
#include <ctime>
#include <iostream>
#include <mutex>
#include <poll.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <thread>
#include <unistd.h>
namespace demo {
static volatile std::sig_atomic_t interrupted = 0;
static void signal_handler(int value) { interrupted = value; }
static bool write_all(std::string_view bytes) {
  while (!bytes.empty()) {
    ssize_t n = ::write(STDOUT_FILENO, bytes.data(), bytes.size());
    if (n < 0) {
      if (errno == EINTR && !interrupted)
        continue;
      return false;
    }
    if (!n)
      return false;
    bytes.remove_prefix(std::size_t(n));
  }
  return true;
}
class Terminal {
  termios before_{};
  bool active_ = false;
  using Handler = void (*)(int);
  Handler old_int_, old_term_, old_hup_, old_pipe_;

public:
  Terminal() {
    if (!isatty(0) || !isatty(1) || tcgetattr(0, &before_))
      throw std::runtime_error("An interactive terminal is required. Use "
                               "--snapshot for headless output.");
    auto raw = before_;
    cfmakeraw(&raw);
    raw.c_cc[VMIN] = 0;
    raw.c_cc[VTIME] = 0;
    if (tcsetattr(0, TCSANOW, &raw))
      throw std::runtime_error("Cannot acquire terminal");
    active_ = true;
    old_int_ = std::signal(SIGINT, signal_handler);
    old_term_ = std::signal(SIGTERM, signal_handler);
    old_hup_ = std::signal(SIGHUP, signal_handler);
    old_pipe_ = std::signal(SIGPIPE, signal_handler);
    write_all("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?"
              "2004h\x1b[?1004h");
  }
  ~Terminal() { restore(); }
  void restore() {
    if (!active_)
      return;
    write_all("\x1b[0m\x1b[?1000l\x1b[?1002l\x1b[?1006l\x1b[?2004l\x1b[?"
              "1004l\x1b[?25h\x1b[?1049l");
    int restored;
    do {
      restored = tcsetattr(0, TCSANOW, &before_);
    } while (restored < 0 && errno == EINTR);
    if (restored < 0)
      std::cerr << "Cannot restore terminal: " << std::strerror(errno) << "\n";
    std::signal(SIGINT, old_int_);
    std::signal(SIGTERM, old_term_);
    std::signal(SIGHUP, old_hup_);
    std::signal(SIGPIPE, old_pipe_);
    active_ = false;
  }
  std::pair<int, int> size() {
    winsize size{};
    if (ioctl(1, TIOCGWINSZ, &size))
      return {120, 40};
    return {std::clamp(int(size.ws_col), 1, 500),
            std::clamp(int(size.ws_row), 1, 200)};
  }
};
class Worker {
  Collector collector_;
  std::mutex mutex_;
  std::condition_variable wake_;
  std::thread thread_;
  std::optional<Json> ready_;
  std::string error_;

public:
  std::atomic<bool> stop{false};
  Worker(const Json &shape, double interval) : collector_(shape) {
    thread_ = std::thread([this, interval] {
      while (!stop) {
        try {
          collector_.refresh(&stop);
          if (stop)
            break;
          std::lock_guard<std::mutex> lock(mutex_);
          ready_ = collector_.data;
        } catch (const std::exception &e) {
          std::lock_guard<std::mutex> lock(mutex_);
          error_ = e.what();
        }
        std::unique_lock<std::mutex> lock(mutex_);
        wake_.wait_for(lock, std::chrono::duration<double>(interval),
                       [&] { return stop.load(); });
      }
    });
  }
  ~Worker() {
    stop = true;
    wake_.notify_all();
    if (thread_.joinable())
      thread_.join();
  }
  bool update(State &s) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!error_.empty())
      throw std::runtime_error(error_);
    if (!ready_ || s.paused)
      return false;
    s.data = std::move(*ready_);
    ready_.reset();
    return true;
  }
};
static void body(UI &ui, State &s) {
  if (s.screen == 0)
    dashboard(ui, s);
  else if (s.screen < 5)
    telemetry(ui, s);
  else
    showcase(ui, s);
}
void render(UI &ui, State &s, bool body_only) {
  if (body_only) {
    body(ui, s);
    return;
  }
  auto t = ui.t();
  auto regions = ui.regions;
  ui.row(cells(1), 0, [&, t, regions](UI &r) {
    r.text(" hqtui.com", t.title, HQ_LEFT, cells(12), HQ_BOLD);
    r.draw([&, t, regions](Surface surface) {
      int x = 0;
      for (int i = 0; i < 10; i++) {
        std::string label =
            " " + std::to_string((i + 1) % 10) + " " + screens[i] + " ";
        int w = int(width(label));
        if (x >= surface.rect().width)
          break;
        bool active = i == s.screen;
        text(surface, x, 0, label, active ? t.background : t.muted,
             active ? HQ_BOLD : 0,
             active ? std::optional<Color>(t.primary) : std::nullopt);
        if (regions)
          regions->push_back(
              {hq_intersect(surface.rect(),
                            {surface.rect().x + x, surface.rect().y, w, 1}),
               "tab:" + std::to_string(i), 0});
        x += w;
      }
    });
    r.text(std::string(s.paused ? "paused" : "live") + "  " +
               (s.real ? "real" : "simulated") + "  " + fixed(s.fps) + "fps  " +
               s.clock + " ",
           s.paused ? t.warning : t.success, HQ_RIGHT, cells(38));
  });
  ui.spacer(cells(1));
  ui.col(cells(std::max(0, ui.height() - 4)), 0, [&](UI &p) { body(p, s); });
  ui.spacer(cells(1));
  ui.draw(
      [&, t](Surface surface) {
        int x = 0;
        std::vector<std::pair<std::string, std::string>> items = {
            {"F1", "Help"},
            {"F2", "Theme (" + std::string(themes[s.theme_index]) + ")"},
            {"F3", s.filtering ? "Filter: " + s.filter + "_" : "Filter"},
            {"c", "Collapse"},
            {"F6", "Sort: " + std::vector<std::string>{"cpu", "mem", "pid",
                                                       "name"}[s.sort]},
            {"^K", "Palette"},
            {"Tab", "Screen"},
            {"q", "Quit"}};
        for (auto &item : items) {
          text(surface, x, 0, " " + item.first + " ", t.background, HQ_BOLD,
               t.primary);
          x += int(width(item.first)) + 2;
          text(surface, x, 0, " " + item.second + " ", t.muted);
          x += int(width(item.second)) + 2;
        }
        auto right = fixed(s.render_ms, 2) + "ms  " +
                     std::to_string(s.changed_cells) + " cells  " +
                     std::to_string(s.output_bytes) + "B";
        if (surface.rect().width - int(width(right)) > x)
          text(surface, surface.rect().width - int(width(right)), 0, right,
               t.muted);
      },
      cells(1));
}
static void overlay(Buffer &frame, State &s) {
  if (!s.help && !s.modal && !s.palette && !s.filtering)
    return;
  auto t = hq_theme_named(themes[s.theme_index]);
  auto surface = frame.surface(t);
  int w = std::min(frame.width() - 2, 72),
      h = std::min(frame.height() - 2, s.palette ? 16 : 11);
  if (w < 4 || h < 3)
    return;
  hq_box_options box{};
  box.title = s.help      ? "hqtui — Help"
              : s.modal   ? "Read-only Demo"
              : s.palette ? "Command Palette"
                          : "Filter Processes";
  auto p =
      surface.sub({(frame.width() - w) / 2, (frame.height() - h) / 2, w, h})
          .box(box);
  std::vector<std::string> lines;
  if (s.help)
    lines = {"1–9 / 0 / Tab: change screen",
             "F2: theme · F3: filter · F6: sort",
             "Ctrl+K: command palette · Space: pause",
             "Arrows / PgUp / PgDn / Home / End: scroll",
             "Mouse: select a pane, click controls, scroll",
             "e: edit text · Esc: finish · q / Ctrl+C: quit",
             "Any key closes help"};
  else if (s.modal)
    lines = {"No process will be killed and no service changed.",
             "Press any key to close."};
  else if (s.filtering)
    lines = {"Filter: " + s.filter + "_", "Enter or Esc to finish"};
  else {
    lines.push_back("> " + s.query + "_");
    for (int i = 0; i < 10; i++)
      lines.push_back(std::string(i == s.palette_index ? "▸ " : "  ") +
                      screens[i]);
  }
  for (int y = 0; y < p.rect().height && y < int(lines.size()); y++)
    text(p, 1, y, fit(lines[y], std::max(0, p.rect().width - 2)),
         t->foreground);
}
static void activate(State &s, const std::string &id) {
  if (id.rfind("tab:", 0) == 0) {
    s.screen = std::stoi(id.substr(4));
    return;
  }
  if (id == "checkbox")
    s.checkbox = !s.checkbox;
  else if (id == "toggle")
    s.toggle = !s.toggle;
  else if (id == "select")
    s.select_open = !s.select_open;
  else if (id.rfind("button:", 0) == 0)
    s.modal = true;
  else
    s.focused = id;
}
static bool key(State &s, std::string key) {
  s.last_key = key.size() == 1 && static_cast<unsigned char>(key[0]) < 32
                   ? "Ctrl+" + std::string(1, char(key[0] + 64))
                   : key;
  s.key_log.push_back(s.last_key);
  if (s.key_log.size() > 100)
    s.key_log.erase(s.key_log.begin());
  if (key == "\x03")
    return true;
  if (s.help || s.modal) {
    s.help = false;
    s.modal = false;
    return false;
  }
  if (s.filtering || s.editing || s.palette) {
    std::string &value = s.filtering ? s.filter : s.editing ? s.input : s.query;
    if (key == "escape" || key == "\r") {
      if (s.palette && key == "\r")
        s.screen = s.palette_index;
      s.filtering = s.editing = s.palette = false;
    } else if (s.palette && (key == "up" || key == "down"))
      s.palette_index = (s.palette_index + (key == "up" ? 9 : 1)) % 10;
    else if (key == "\x7f" || key == "\b") {
      if (!value.empty()) {
        std::size_t i = value.size() - 1;
        while (i && ((static_cast<unsigned char>(value[i]) & 192) == 128))
          i--;
        value.resize(i);
      }
    } else if ((key.size() == 1 || static_cast<unsigned char>(key[0]) >= 128) &&
               key.size() <= 4 && static_cast<unsigned char>(key[0]) >= 32 &&
               value.size() + key.size() <= 4096)
      value += key;
    return false;
  }
  if (s.select_open) {
    if (key == "up" || key == "down")
      s.select_index = (s.select_index + (key == "up" ? 3 : 1)) % 4;
    else if (key == "\r" || key == "escape")
      s.select_open = false;
    return false;
  }
  if (key == "q")
    return true;
  if (key == "f1" || key == "?")
    s.help = true;
  else if (key == "f2")
    s.theme_index = (s.theme_index + 1) % 9;
  else if (key == "f3" || key == "/")
    s.filtering = true;
  else if (key == "c")
    // Shows what collapsed borders do, live. Worth a key because the
    // difference is only visible when panels sit next to each other.
    s.collapse = !s.collapse;
  else if (key == "f6")
    s.sort = (s.sort + 1) % 4;
  else if (key == "\x0b")
    s.palette = true;
  else if (key == "e")
    s.editing = true;
  else if (key == " ")
    s.paused = !s.paused;
  else if (key == "\t")
    s.screen = (s.screen + 1) % 10;
  else if (key == "backtab")
    s.screen = (s.screen + 9) % 10;
  else if (key.size() == 1 && key[0] >= '0' && key[0] <= '9')
    s.screen = (key[0] - '0' + 9) % 10;
  else if ((key == "left" || key == "right") && s.screen == 7)
    s.theme_index = (s.theme_index + (key == "left" ? 8 : 1)) % 9;
  else if (key == "left" || key == "right") {
    std::vector<std::string> ids;
    for (auto &r : s.regions)
      if (s.panes.count(r.id) &&
          std::find(ids.begin(), ids.end(), r.id) == ids.end())
        ids.push_back(r.id);
    if (!ids.empty()) {
      auto it = std::find(ids.begin(), ids.end(), s.focused);
      int i = it == ids.end() ? 0 : int(it - ids.begin());
      s.focused = ids[(i + (key == "left" ? int(ids.size()) - 1 : 1)) %
                      int(ids.size())];
    }
  } else {
    auto &p = s.panes[s.focused];
    if (key == "down")
      p.move(1);
    else if (key == "up")
      p.move(-1);
    else if (key == "pagedown")
      p.move(std::max(1, p.capacity));
    else if (key == "pageup")
      p.move(-std::max(1, p.capacity));
    else if (key == "home") {
      if (p.log)
        p.offset = std::max(0, p.total - p.capacity);
      else
        p.selected = 0;
    } else if (key == "end") {
      if (p.log)
        p.offset = 0;
      else
        p.selected = std::max(0, p.total - 1);
    }
  }
  return false;
}
class Input {
  std::string pending;
  bool paste = false;
  std::chrono::steady_clock::time_point escape_time;

public:
  bool feed(State &s, std::string_view input) {
    if (pending.size() + input.size() > 8192)
      pending.clear();
    if (pending.empty())
      escape_time = std::chrono::steady_clock::now();
    pending += input;
    while (!pending.empty()) {
      if (paste) {
        auto end = pending.find("\x1b[201~");
        if (end == pending.npos) {
          if (pending.size() < 4096)
            return false;
          end = pending.size() - 6;
        }
        std::string &target = s.filtering ? s.filter
                              : s.palette ? s.query
                                          : s.input;
        if (s.editing || s.filtering || s.palette)
          target.append(pending.substr(0, std::min(end, 4096 - target.size())));
        pending.erase(0, end);
        if (pending.rfind("\x1b[201~", 0) == 0) {
          pending.erase(0, 6);
          paste = false;
        }
        continue;
      }
      if (pending.rfind("\x1b[200~", 0) == 0) {
        pending.erase(0, 6);
        paste = true;
        continue;
      }
      if (pending.rfind("\x1b[<", 0) == 0) {
        auto end = pending.find_first_of("mM", 3);
        if (end == pending.npos)
          return false;
        auto sequence = pending.substr(0, end + 1);
        pending.erase(0, end + 1);
        int button, x, y;
        if (std::sscanf(sequence.c_str(), "\x1b[<%d;%d;%d", &button, &x, &y) ==
                3 &&
            x >= 1 && y >= 1 && x <= 500 && y <= 200) {
          x--;
          y--;
          s.last_mouse = "mouse " + std::to_string(x) + "," + std::to_string(y);
          if (!s.overlay())
            for (auto it = s.regions.rbegin(); it != s.regions.rend(); it++) {
              auto r = it->rect;
              if (x < r.x || y < r.y || x >= r.x + r.width ||
                  y >= r.y + r.height)
                continue;
              if (button & 64) {
                s.focused = it->id;
                s.panes[it->id].move(button & 1 ? 3 : -3);
              } else if (sequence.back() == 'M' && (button & 3) == 0 &&
                         !(button & 32)) {
                activate(s, it->id);
                if (s.panes.count(it->id) && y - r.y >= it->header) {
                  auto &p = s.panes[it->id];
                  p.selected = std::clamp(p.offset + y - r.y - it->header, 0,
                                          std::max(0, p.total - 1));
                }
              }
              break;
            }
        }
        continue;
      }
      if (pending[0] == '\x1b') {
        static const std::vector<std::pair<std::string, std::string>>
            sequences = {{"\x1b[A", "up"},      {"\x1b[B", "down"},
                         {"\x1b[C", "right"},   {"\x1b[D", "left"},
                         {"\x1b[H", "home"},    {"\x1b[F", "end"},
                         {"\x1b[5~", "pageup"}, {"\x1b[6~", "pagedown"},
                         {"\x1b[Z", "backtab"}, {"\x1bOP", "f1"},
                         {"\x1bOQ", "f2"},      {"\x1bOR", "f3"},
                         {"\x1b[11~", "f1"},    {"\x1b[12~", "f2"},
                         {"\x1b[13~", "f3"},    {"\x1b[17~", "f6"},
                         {"\x1b[I", "focus"},   {"\x1b[O", "blur"}};
        bool matched = false;
        for (auto &entry : sequences)
          if (pending.rfind(entry.first, 0) == 0) {
            pending.erase(0, entry.first.size());
            if (key(s, entry.second))
              return true;
            matched = true;
            break;
          }
        if (matched)
          continue;
        if (std::chrono::steady_clock::now() - escape_time <
            std::chrono::milliseconds(35))
          return false;
        pending.erase(0, 1);
        if (key(s, "escape"))
          return true;
        continue;
      }
      unsigned char c = pending[0];
      std::size_t n = c < 128 ? 1 : c < 224 ? 2 : c < 240 ? 3 : 4;
      if (pending.size() < n)
        return false;
      auto token = pending.substr(0, n);
      pending.erase(0, n);
      if (key(s, token))
        return true;
    }
    return false;
  }
};
static void simulate(State &s) {
  double time = s.data["time"].n() + .1;
  s.data["time"] = time;
  auto &cpu = s.data["cpu"];
  double used = .45 + std::sin(time * .35) * .22;
  cpu["total"] = used;
  auto &cores = cpu["cores"].array();
  for (std::size_t i = 0; i < cores.size(); i++)
    cores[i] = ratio(used + std::sin(time + i) * .15);
  auto &history = cpu["history"].array();
  if (history.size() >= 240)
    history.erase(history.begin());
  history.emplace_back(used * 100);
}
} // namespace demo
#ifndef HQTUI_DEMO_TEST
int hqtui_demo_main(int argc, char **argv) {
  demo::interrupted = 0;
  using namespace demo;
  try {
    bool snapshot = false, body_only = false, sim = false, real = false;
    int w = 160, h = 50, fps = 30, ticks = 0;
    double interval = 1;
    std::string format = "text";
    State state;
    state.data = Json::parse(sample_json);
    for (int i = 1; i < argc; i++) {
      std::string arg = argv[i];
      if (arg == "--help" || arg == "-h") {
        std::cout
            << "hqtui-demo-cpp — native C++ reference demo\n--sim | --real  "
               "--snapshot  --screen "
               "dashboard|traffic|sessions|network|services|components|"
               "graphics|themes|input|stress\n--theme "
               "dark|dracula|nord|tokyo-night|gruvbox|matrix|monochrome|high-"
               "contrast|light\n--width N --height N --fps 1–120 --interval "
               "0.05–60 --ticks N --format text|ansi\n--version\n";
        return 0;
      }
      if (arg == "--version") {
        std::cout << HQTUI_DEMO_VERSION << "\n";
        return 0;
      }
      if (arg == "--sim")
        sim = true;
      else if (arg == "--real")
        real = true;
      else if (arg == "--snapshot")
        snapshot = true;
      else if (arg == "--body")
        body_only = true;
      else {
        if (++i == argc)
          throw std::runtime_error("Missing value for " + arg);
        std::string v = argv[i];
        if (arg == "--screen") {
          int n = 0;
          for (; n < 10 && v != screens[n]; n++) {
          }
          if (n == 10)
            throw std::runtime_error("Unknown screen");
          state.screen = n;
        } else if (arg == "--theme") {
          int n = 0;
          for (; n < 9 && v != themes[n]; n++) {
          }
          if (n == 9)
            throw std::runtime_error("Unknown theme");
          state.theme_index = n;
        } else if (arg == "--format")
          format = v;
        else {
          std::size_t end = 0;
          double number = std::stod(v, &end);
          if (end != v.size() || !std::isfinite(number))
            throw std::runtime_error("Invalid number");
          if (arg == "--interval")
            interval = number;
          else {
            if (number != std::floor(number) || number < 0 || number > 10000)
              throw std::runtime_error("Invalid integer");
            if (arg == "--width")
              w = int(number);
            else if (arg == "--height")
              h = int(number);
            else if (arg == "--fps")
              fps = int(number);
            else if (arg == "--ticks")
              ticks = int(number);
            else
              throw std::runtime_error("Unknown option " + arg);
          }
        }
      }
    }
    if (w < 1 || w > 500 || h < 1 || h > 200 || fps < 1 || fps > 120 ||
        interval < .05 || interval > 60 || sim && real ||
        (format != "text" && format != "ansi"))
      throw std::runtime_error("Invalid options");
#if defined(__linux__)
    state.real = real || (!sim && !snapshot);
#else
    state.real =
        real; // Non-Linux hosts default to explicitly labelled sample data.
#endif
    if (state.real) {
      Collector collector(state.data);
      if (snapshot) {
        collector.refresh();
        state.data = collector.data;
      } else
        state.data = collector.data;
    } else
      for (int i = 0; i < ticks; i++)
        simulate(state);
    if (snapshot) {
      auto t = hq_theme_named(themes[state.theme_index]);
      Buffer frame(w, h);
      frame.clear(t->background, t->foreground);
      UI ui(frame.surface(t), false, 0, &state.regions, state.collapse);
      render(ui, state, body_only);
      ui.flush();
      if (format == "ansi") {
        Buffer previous(w, h);
        Encoder encoder;
        write_all(encoder.encode(previous, frame, true).output);
      } else
        for (int y = 0; y < h; y++)
          std::cout << frame.row(y) << "\n";
      return 0;
    }
    Terminal terminal;
    std::unique_ptr<Worker> worker;
    if (state.real)
      worker = std::make_unique<Worker>(Json::parse(sample_json), interval);
    auto size = terminal.size();
    Buffer previous(size.first, size.second), frame(size.first, size.second);
    Encoder encoder;
    Input input;
    bool first = true;
    auto last = std::chrono::steady_clock::now(), last_sim = last;
    while (!interrupted) {
      auto start = std::chrono::steady_clock::now();
      if (worker)
        worker->update(state);
      else if (!state.paused &&
               start - last_sim >= std::chrono::milliseconds(100)) {
        simulate(state);
        last_sim = start;
      }
      size = terminal.size();
      if (size.first != frame.width() || size.second != frame.height()) {
        frame.resize(size.first, size.second);
        previous.resize(size.first, size.second);
        first = true;
      }
      auto t = hq_theme_named(themes[state.theme_index]);
      frame.clear(t->background, t->foreground);
      state.regions.clear();
      std::time_t wall = std::time(nullptr);
      std::tm utc{};
      gmtime_r(&wall, &utc);
      char clock[9];
      std::strftime(clock, sizeof clock, "%H:%M:%S", &utc);
      state.clock = clock;
      state.fps =
          first ? fps
                : 1 / std::max(
                          .0001,
                          std::chrono::duration<double>(start - last).count());
      last = start;
      UI ui(frame.surface(t), false, 0, &state.regions, state.collapse);
      render(ui, state);
      ui.flush();
      if (!state.overlay() &&
          std::none_of(
              state.regions.begin(), state.regions.end(),
              [&](const Region &r) { return r.id == state.focused; })) {
        for (const auto &region : state.regions)
          if (state.panes.count(region.id)) {
            state.focused = region.id;
            break;
          }
      }
      overlay(frame, state);
      auto result = encoder.encode(previous, frame, first);
      first = false;
      if (!write_all(result.output))
        break;
      state.changed_cells = result.changed_cells;
      state.output_bytes = result.output.size();
      previous.copy_from(frame);
      state.render_ms = std::chrono::duration<double, std::milli>(
                            std::chrono::steady_clock::now() - start)
                            .count();
      if (input.feed(state, {}))
        break;
      auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                         std::chrono::steady_clock::now() - start)
                         .count();
      struct pollfd pfd{0, POLLIN, 0};
      int ready = poll(&pfd, 1, std::max(0, 1000 / fps - int(elapsed)));
      if (ready > 0) {
        if (pfd.revents & (POLLHUP | POLLERR))
          break;
        char buffer[4096];
        ssize_t n = read(0, buffer, sizeof buffer);
        if (n > 0 &&
            input.feed(state, std::string_view(buffer, std::size_t(n))))
          break;
      }
    }
    terminal.restore();
    return interrupted ? 128 + interrupted : 0;
  } catch (const std::exception &e) {
    std::cerr << "hqtui-demo-cpp: " << e.what() << "\n";
    return 2;
  }
}
#ifndef HQTUI_DEMO_LIBRARY
int main(int argc, char **argv) { return hqtui_demo_main(argc, argv); }
#endif
#endif
