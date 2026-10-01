#include "model.hpp"
namespace demo {
static void button(UI &p, std::string label, Color color, int width,
                   std::string id) {
  auto regions = p.regions;
  p.draw(
      [=](Surface surface) {
        auto t = theme(surface);
        bool focused = id == "button:A";
        Color bg = focused ? color : hq_mix(t.surface, color, .16),
              fg = focused ? (t.dark ? t.background : t.surface) : color;
        aligned(surface, 0, " " + label + " ", fg, HQ_CENTER, HQ_BOLD, bg);
        if (regions)
          regions->push_back({surface.rect(), id, 0});
      },
      cells(width));
}
static void badge(UI &p, std::string label, Color color, int width,
                  std::string variant = "filled",
                  std::optional<Color> background = {}) {
  p.draw(
      [=](Surface surface) {
        auto t = theme(surface);
        std::optional<Color> bg =
            variant == "filled" ? std::optional<Color>(color)
            : variant == "subtle"
                ? std::optional<Color>(hq_mix(t.surface, color, .18))
                : background;
        auto fg =
            variant == "filled" ? (t.dark ? t.background : t.surface) : color;
        text(surface, 0, 0, " " + label + " ", fg,
             variant == "subtle" ? 0 : HQ_BOLD, bg);
      },
      cells(width));
}
static void checkbox(UI &p, State &s, std::string label, int width,
                     bool toggle = false) {
  auto regions = p.regions;
  bool checked = toggle ? s.toggle : s.checkbox;
  p.draw(
      [=](Surface surface) {
        auto t = theme(surface);
        text(surface, 0, 0,
             toggle ? (checked ? "[▮ ]" : "[ ▮]") : (checked ? "[✓]" : "[ ]"),
             checked ? t.success : t.muted);
        text(surface, toggle ? 4 : 3, 0, " " + label, t.muted);
        if (regions)
          regions->push_back(
              {surface.rect(), toggle ? "toggle" : "checkbox", 0});
      },
      cells(width));
}
static void spark(UI &p, std::string label, const Json &data, std::string value,
                  Color color) {
  auto values = numbers(data);
  p.draw(
      [=](Surface surface) {
        auto t = theme(surface);
        int lw = int(width(label)) + 1, vw = int(width(value)) + 1,
            w = surface.rect().width - lw - vw;
        text(surface, 0, 0, label, t.muted);
        double hi = 1;
        for (int i = std::max(0, int(values.size()) - w);
             i < int(values.size()); i++)
          hi = std::max(hi, values[i]);
        int count = std::min(std::max(0, w), int(values.size()));
        for (int i = 0; i < count; i++) {
          int n = std::clamp(
              iround(ratio(values[values.size() - count + i] / hi) * 8), 0, 8);
          surface.set(lw + w - count + i, 0, n ? 0x2580 + n : ' ',
                      Style().foreground(color));
        }
        text(surface, surface.rect().width - vw, 0, fit(value, vw, HQ_RIGHT),
             color, HQ_BOLD);
      },
      cells(1));
}
static void donut(UI &p, double a, double b, Color ca, Color cb) {
  p.draw([=](Surface surface) {
    Braille canvas(surface.rect().width, surface.rect().height);
    double total = std::max(1., a + b), cx = canvas.w / 2., cy = canvas.h / 2.,
           outer = std::min(canvas.w / 2., canvas.h / 2.) - 1,
           inner = outer * .55, angle = -std::acos(-1.) / 2;
    std::vector<Color> colors(canvas.dots.size());
    double vals[] = {a, b};
    Color tint[] = {ca, cb};
    for (int i = 0; i < 2; i++) {
      double sweep = std::max(0., vals[i]) / total * std::acos(-1.) * 2;
      int steps = std::max(8, iround(sweep * outer * 3));
      for (int step = 0; step <= steps; step++) {
        double a = angle + sweep * step / steps;
        for (double r = inner; r <= outer; r += .4) {
          int x = iround(cx + std::cos(a) * r),
              y = iround(cy + std::sin(a) * r * .9);
          canvas.pixel(x, y);
          if (x >= 0 && y >= 0 && x < canvas.w && y < canvas.h)
            colors[std::size_t(y / 4) * canvas.cols + x / 2] = tint[i];
        }
      }
      angle += sweep;
    }
    for (int y = 0; y < canvas.rows; y++)
      for (int x = 0; x < canvas.cols; x++) {
        auto index = std::size_t(y) * canvas.cols + x;
        if (canvas.dots[index])
          surface.set(x, y, 0x2800 + canvas.dots[index],
                      Style().foreground(colors[index] ? colors[index]
                                                       : theme(surface).muted));
      }
  });
}
static void list(UI &p, State &s, std::string id,
                 std::vector<std::string> items, std::string bullet = "",
                 bool selected = true, bool scrollbar = false) {
  auto regions = p.regions;
  auto *pane = &s.panes[id];
  p.draw([=](Surface surface) {
    auto t = theme(surface);
    int h = surface.rect().height, w = surface.rect().width - int(scrollbar);
    pane->total = int(items.size());
    pane->capacity = h;
    pane->offset = std::clamp(pane->offset, 0, std::max(0, pane->total - h));
    if (selected && h > 0) {
      if (pane->selected < pane->offset)
        pane->offset = pane->selected;
      if (pane->selected >= pane->offset + h)
        pane->offset = pane->selected - h + 1;
    }
    for (int y = 0; y < h && pane->offset + y < pane->total; y++) {
      int i = pane->offset + y;
      bool active = selected && i == pane->selected;
      std::optional<Color> bg;
      if (active)
        bg = t.selection;
      auto fg = active ? t.selection_text : i == 0 ? t.primary : t.foreground;
      if (bg)
        surface.sub({0, y, w, 1}).fill(' ', Style().background(*bg));
      text(surface, 0, y,
           fit((bullet.empty() ? "" : bullet + " ") + items[i], w), fg,
           active ? HQ_BOLD : 0, bg);
    }
    if (scrollbar)
      draw_scrollbar(surface, surface.rect().width - 1, 0, h, pane->total,
                     pane->offset);
    if (regions)
      regions->push_back({surface.rect(), id, 0});
  });
}
static void graphics(UI &ui, State &s) {
  const int gap = s.panel_gap();
  auto t = ui.t();
  double time = s.data["time"].n();
  auto wave = [](double phase, double freq) {
    std::vector<double> a;
    for (int i = 0; i < 240; i++)
      a.push_back(std::sin(i / freq + phase) * 50 + 50);
    return a;
  };
  auto a = wave(time / 3, 9), b = wave(time / 3 + 2, 5), c = wave(time / 2, 17);
  ui.row(fr(), gap, [=](UI &r) {
    r.col(fr(), gap, [=](UI &p) {
      p.panel("Braille (2×4 pixels per cell)", [=](UI &g) {
        Graph o;
        o.series = {{a, t.accent, "", true}};
        o.max = 100;
        o.grid = true;
        g.graph(o);
      });
      p.panel("Block elements", [=](UI &g) {
        Graph o;
        o.series = {{a, 0, "", false}};
        o.max = 100;
        o.mode = "block";
        o.colors.assign(t.heat, t.heat + t.heat_count);
        g.graph(o);
      });
      p.panel("ASCII fallback", [=](UI &g) {
        Graph o;
        o.series = {{a, t.foreground, "", false}};
        o.max = 100;
        o.mode = "ascii";
        g.graph(o);
      });
    }, true);
    r.col(fr(), gap, [=](UI &p) {
      p.panel("Multi-series", [=](UI &g) {
        Graph o;
        o.series = {{a, t.primary, "alpha", false},
                    {b, t.success, "beta", false},
                    {c, t.secondary, "gamma", false}};
        o.max = 100;
        o.axis = true;
        o.legend = true;
        g.graph(o);
      });
      p.panel("Gradients", [=](UI &g) {
        g.draw([=](Surface surface) {
          for (int y = 0; y < surface.rect().height; y++)
            for (int x = 0; x < surface.rect().width; x++)
              surface.set(x, y, 0x2588,
                          Style().foreground(hq_gradient(
                              t.heat, t.heat_count,
                              surface.rect().width <= 1
                                  ? 0
                                  : double(x) / (surface.rect().width - 1))));
        });
      });
      p.panel("Raw Braille canvas", [=](UI &g) {
        g.draw([=](Surface surface) {
          Braille canvas(surface.rect().width, surface.rect().height);
          double cx = canvas.w / 2., cy = canvas.h / 2.,
                 radius = std::min(cx, cy) - 2;
          int x = iround(
                  std::min(std::abs(radius), double(canvas.w + canvas.h))),
              y = 0, err = 1 - x;
          while (x >= y) {
            canvas.pixel(cx + x, cy + y);
            canvas.pixel(cx + y, cy + x);
            canvas.pixel(cx - y, cy + x);
            canvas.pixel(cx - x, cy + y);
            canvas.pixel(cx - x, cy - y);
            canvas.pixel(cx - y, cy - x);
            canvas.pixel(cx + y, cy - x);
            canvas.pixel(cx + x, cy - y);
            y++;
            if (err < 0)
              err += 2 * y + 1;
            else {
              x--;
              err += 2 * (y - x) + 1;
            }
          }
          for (int i = 0; i < 12; i++) {
            double a = double(i) / 12 * std::acos(-1.) * 2 + time / 4;
            canvas.line(cx, cy, cx + std::cos(a) * radius,
                        cy + std::sin(a) * radius * .9);
          }
          canvas.blit(surface, t.accent);
        });
      });
    }, true);
  });
}
static void theme_screen(UI &ui, State &s) {
  const int gap = s.panel_gap();
  ui.label("Theme " + std::to_string(s.theme_index + 1) + "/9: " + ui.t().name +
           "   ←/→ or F2 to change");
  ui.spacer(cells(1));
  ui.col(fr(), gap, [&, gap](UI &grid) {
    for (int row = 0; row < 3; row++)
      grid.row(fr(), gap, [&, row](UI &r) {
        for (int column = 0; column < 3; column++) {
          int i = row * 3 + column;
          auto e = *hq_theme_named(themes[i]);
          r.panel(
              e.name,
              [&, e](UI &p) {
                p.row(cells(1), 1, [=](UI &r) {
                  badge(r, "primary", e.primary, 10);
                  badge(r, "ok", e.success, 5);
                  badge(r, "warn", e.warning, 7);
                  badge(r, "err", e.danger, 6);
                  r.spacer();
                });
                Meter m;
                m.value = .72;
                m.label = "cpu";
                m.segmented = false;
                m.background = e.background;
                p.meter(m);
                auto g = graph(s.data.path("cpu.history"), e.graph[0], 100);
                g.background = e.background;
                p.graph(g);
                p.draw(
                    [=](Surface surface) {
                      for (std::size_t i = 0; i < e.graph_count; i++)
                        for (int x = 0; x < 3; x++)
                          surface.set(int(i) * 4 + x, 0, 0x2588,
                                      Style()
                                          .foreground(e.graph[i])
                                          .background(e.background));
                    },
                    cells(1));
              },
              fr(), "", i == s.theme_index ? e.border_focused : e.border,
              e.background);
        }
      }, true);
  });
}
static void input_screen(UI &ui, State &s) {
  const int gap = s.panel_gap();
  auto t = ui.t();
  ui.row(fr(), gap, [&, t](UI &r) {
    r.panel("Last Events", [&, t](UI &p) {
      p.keys({kv("Key", s.last_key, t.accent),
              kv("Mouse", s.last_mouse, t.primary)});
      p.spacer(cells(1));
      p.divider("history");
      auto history = s.key_log;
      std::reverse(history.begin(), history.end());
      list(p, s, "input.history", history, "", false);
    });
    r.panel("Try it", [&, t](UI &p) {
      p.text("Press any key — modifiers are normalized.");
      p.label("Arrows, Function keys, Ctrl/Alt/Shift combinations,");
      p.label("paste, focus, mouse move, click, drag and scroll.");
      p.spacer(cells(1));
      p.divider("focusable controls");
      p.spacer(cells(1));
      p.row(cells(1), 2, [&, t](UI &r) {
        button(r, "Button A", t.primary, 12, "button:A");
        button(r, "Button B", t.success, 12, "button:B");
        checkbox(r, s, "Check", 12);
        r.spacer();
      });
      p.spacer(cells(1));
      p.label("Tab / Shift+Tab moves focus. Enter activates.");
      p.spacer();
      p.keys({kv("Mouse tracking", "on"), kv("Bracketed paste", "on"),
              kv("Focus events", "on")});
    });
  });
}
static void stress(UI &ui, State &s) {
  const int gap = s.panel_gap();
  auto t = ui.t();
  ui.row(cells(3), gap, [&, t](UI &r) {
    std::vector<std::string> titles = {"Render", "Changed cells", "Bytes/frame",
                                       "FPS"},
                             values = {fixed(s.render_ms, 2) + " ms/frame",
                                       std::to_string(s.changed_cells),
                                       std::to_string(s.output_bytes),
                                       fixed(s.fps, 1)};
    Color colors[] = {t.success, t.warning, t.primary, t.accent};
    for (int i = 0; i < 4; i++) {
      auto value = values[i];
      auto color = colors[i];
      r.panel(titles[i], [=](UI &p) { p.text(value, color); });
    }
  });
  double time = s.data["time"].n();
  ui.panel("Full-screen churn", [=](UI &p) {
    p.draw([=](Surface surface) {
      uint32_t chars[] = {0x2596, 0x2597, 0x2598, 0x2599, 0x259a,
                          0x259b, 0x259c, 0x259d, 0x259e, 0x259f,
                          0x2588, 0x2593, 0x2592, 0x2591};
      for (int y = 0; y < surface.rect().height; y++)
        for (int x = 0; x < surface.rect().width; x++) {
          double n =
              ((std::sin(x / 6. + time) + std::cos(y / 4. - time)) / 2 + 1) / 2;
          surface.set(
              x, y, chars[std::clamp(int(std::floor(n * 13)), 0, 13)],
              Style().foreground(hq_gradient(t.graph, t.graph_count, n)));
        }
    });
  });
}
static void components(UI &ui, State &s) {
  auto t = ui.t();
  const int gap = s.panel_gap();
  const auto &c = s.data["cpu"], &m = s.data["memory"], &n = s.data["network"];
  ui.row(fr(), gap, [&, t](UI &r) {
    r.col(fr(), s.panel_gap(), [&, t](UI &left) {
      left.panel(
          "Buttons & Inputs",
          [&, t](UI &p) {
            p.row(cells(1), 1, [&, t](UI &r) {
              button(r, "Primary", t.primary, 11, "button:Primary");
              button(r, "Success", t.success, 11, "button:Success");
              button(r, "Warning", t.warning, 11, "button:Warning");
              button(r, "Danger", t.danger, 10, "button:Danger");
              r.spacer();
            });
            p.spacer(cells(1));
            p.row(cells(1), 2, [&, t](UI &r) {
              auto regions = r.regions;
              r.draw(
                  [&, t, regions](Surface surface) {
                    const char *options[] = {"Dark", "Dracula", "Nord",
                                             "Tokyo Night"};
                    auto &th = theme(surface);
                    auto bg =
                        hq_mix(th.surface,
                               hq_rgb(th.dark ? 255 : 0, th.dark ? 255 : 0,
                                      th.dark ? 255 : 0),
                               .05);
                    text(
                        surface, 0, 0,
                        fit(" " + std::string(options[s.select_index % 4]), 18),
                        th.foreground, 0, bg);
                    text(surface, 18, 0, s.select_open ? " ▴" : " ▾", th.border,
                         0, bg);
                    if (regions)
                      regions->push_back({surface.rect(), "select", 0});
                  },
                  cells(20));
              checkbox(r, s, "Toggle", 12, true);
              checkbox(r, s, "Checkbox", 14);
              r.spacer();
            });
            p.spacer(cells(1));
            p.draw(
                [&, t](Surface surface) {
                  auto regions = p.regions;
                  (void)regions;
                  std::string value =
                      s.input.empty() ? "type to filter…" : s.input;
                  text(surface, 0, 0, "Search", t.muted);
                  auto field = surface.sub(
                      {7, 0, std::max(0, surface.rect().width - 7), 1});
                  auto bg = hq_mix(t.surface,
                                   hq_rgb(t.dark ? 255 : 0, t.dark ? 255 : 0,
                                          t.dark ? 255 : 0),
                                   .1);
                  field.fill(' ', Style().background(bg));
                  text(field, 1, 0,
                       fit(value, std::min(std::max(0, field.rect().width - 2),
                                           int(width(value)))),
                       s.input.empty() ? t.muted : t.foreground, 0, bg);
                  if (field.rect().width > 0) {
                    auto cursor = field.rect();
                    cursor.x += std::min(field.rect().width - 1,
                                         1 + int(width(s.input)));
                    cursor.width = 1;
                    cursor.height = 1;
                    hq_buffer_style(
                        field.native().buffer, cursor,
                        Style().foreground(t.background).background(t.cursor));
                  }
                },
                cells(1));
            p.spacer(cells(1));
            Meter slider;
            slider.value = s.slider;
            slider.label = "Slider";
            slider.color = t.primary;
            slider.segmented = false;
            p.meter(slider);
            Meter progress;
            progress.value = 37. / 120;
            progress.label = "Progress";
            progress.readout = "37/120";
            progress.color = t.primary;
            progress.segmented = false;
            p.meter(progress);
          },
          cells(13));
      left.panel("Table Widget", [&, t](UI &p) {
        static const char *files[][4] = {
            {"src", "4.2 KB", "dir", "2m ago"},
            {"test", "1.1 KB", "dir", "5m ago"},
            {"package.json", "1.2 KB", "file", "10m ago"},
            {"README.md", "3.4 KB", "file", "1h ago"},
            {"bun.lockb", "12 KB", "file", "1h ago"}};
        std::vector<Json> rows;
        for (auto &v : files)
          rows.push_back(Json::Object{{"name", v[0]},
                                      {"size", v[1]},
                                      {"type", v[2]},
                                      {"modified", v[3]}});
        table(p, s, "components.files", rows,
              {dc("name", "Name", -1, 10, t.primary),
               dc("size", "Size", 9, 1, 0, true), dc("type", "Type", 6),
               dc("modified", "Modified", 10, 1, t.muted, true)},
              true, true, false);
      });
      left.panel(
          "Log Viewer",
          [&](UI &p) {
            p.log(logs(s.data["logs"]), &s.panes["components.logs"],
                  "components.logs");
          },
          cells(11));
    }, true);
    r.col(fr(), s.panel_gap(), [&, t](UI &right) {
      right.panel(
          "Process Tree",
          [&, t](UI &p) {
            p.row(cells(1), 0, [=](UI &r) {
              r.text("Name", t.muted, HQ_LEFT, automatic(1), HQ_BOLD);
              r.text("CPU%   MEM%", t.muted, HQ_RIGHT, automatic(1), HQ_BOLD);
            });
            auto pane = &s.panes["components.tree"];
            auto regions = p.regions;
            p.draw([=](Surface surface) {
              const char *names[] = {"systemd",     "bash",       "bun",
                                     "bun:worker",  "bun:worker", "node",
                                     "node:worker", "postgres"};
              const char *prefix[] = {"└─ ",       "   ├─ ",    "   ├─ ",
                                      "   │  ├─ ", "   │  └─ ", "   ├─ ",
                                      "   │  └─ ", "   └─ "};
              const char *cpu[] = {"1.3", "0.1",  "32.8", "12.4",
                                   "8.7", "18.1", "6.1",  "6.7"},
                         *mem[] = {"0.1", "0.2", "4.2", "1.8",
                                   "1.3", "2.1", "0.8", "1.8"};
              int w = surface.rect().width, h = surface.rect().height,
                  lw = std::max(0, w - 14);
              pane->total = 8;
              pane->capacity = h;
              pane->offset = std::clamp(pane->offset, 0, std::max(0, 8 - h));
              if (h > 0) {
                if (pane->selected < pane->offset)
                  pane->offset = pane->selected;
                if (pane->selected >= pane->offset + h)
                  pane->offset = pane->selected - h + 1;
              }
              for (int y = 0; y < h && pane->offset + y < 8; y++) {
                int i = pane->offset + y;
                bool selected = i == pane->selected;
                std::optional<Color> bg;
                if (selected) {
                  bg = t.selection;
                  surface.sub({0, y, w, 1}).fill(' ', Style().background(*bg));
                }
                int px = std::min(lw, int(width(prefix[i])));
                text(surface, 0, y, fit(prefix[i], px),
                     hq_mix(t.border, t.foreground, .15), 0, bg);
                text(surface, px, y,
                     fit(names[i],
                         std::min(std::max(0, lw - px), int(width(names[i])))),
                     selected ? t.selection_text : t.foreground,
                     selected ? HQ_BOLD : 0, bg);
                text(surface, lw, y, fit(cpu[i], 6, HQ_RIGHT),
                     selected ? t.selection_text : t.foreground, 0, bg);
                text(surface, lw + 7, y, fit(mem[i], 6, HQ_RIGHT),
                     selected ? t.selection_text : t.foreground, 0, bg);
              }
              if (regions)
                regions->push_back({surface.rect(), "components.tree", 0});
            });
          },
          cells(13));
      right.panel(
          "Sparklines & Gauges",
          [&, t](UI &p) {
            spark(p, "CPU ", c["history"], percent(c["total"].n()), t.success);
            spark(p, "Mem ", m["history"],
                  percent(m["used"].n() / std::max(1., m["total"].n())),
                  t.warning);
            spark(p, "Net ", n["downHistory"], bytes(n["downRate"].n()) + "/s",
                  t.primary);
            p.spacer(cells(1));
            p.row(fr(), 2, [&, t](UI &r) {
              r.gauge(c["total"].n(), percent(c["total"].n()));
              donut(r, m["used"].n(), m["available"].n(), t.primary, t.warning);
            });
          },
          cells(12));
      right.panel("Lists & Badges", [&, t](UI &p) {
        p.row(cells(1), 1, [=](UI &r) {
          badge(r, "active", t.success, 10);
          badge(r, "idle", t.warning, 8, "subtle");
          badge(r, "failed", t.danger, 10, "outline");
          r.spacer();
        });
        p.spacer(cells(1));
        list(p, s, "components.list",
             {"apps/demo", "packages/hqtui", "apps/web", "docs"}, "▸", true,
             true);
      });
    }, true);
  });
}
void showcase(UI &ui, State &s) {
  switch (s.screen) {
  case 5:
    components(ui, s);
    break;
  case 6:
    graphics(ui, s);
    break;
  case 7:
    theme_screen(ui, s);
    break;
  case 8:
    input_screen(ui, s);
    break;
  case 9:
    stress(ui, s);
    break;
  default:
    break;
  }
}
} // namespace demo
