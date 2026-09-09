#include "model.hpp"
namespace demo {
static void cpu_panel(UI &ui, State &s, int columns, Constraint size = fr()) {
  const auto &c = s.data["cpu"];
  ui.panel(
      "CPU Overview",
      [&, columns](UI &p) {
        auto t = p.t();
        p.label(c["model"].s() + "   " + fixed(c["frequencyGhz"].n(), 1) +
                " GHz");
        p.graph(graph(c["history"], t.success, 100));
        std::vector<Meter> items;
        int i = 0;
        for (auto &v : c["cores"].array()) {
          Meter m;
          m.value = v.n();
          m.label = "P" + std::to_string(i++);
          m.label_width = 4;
          m.value_width = 5;
          m.segmented = true;
          items.push_back(m);
        }
        p.meters(items, columns);
        p.divider();
        std::string load;
        for (auto &v : c["load"].array()) {
          if (!load.empty())
            load += "   ";
          load += fixed(v.n(), 2);
        }
        p.keys({kv("Load Avg", load, t.warning)});
      },
      size, percent(c["total"].n()));
}
static void memory_panel(UI &ui, State &s, Constraint size = fr()) {
  const auto &m = s.data["memory"];
  ui.panel("Memory & Swap", [&](UI &p) {
    auto t = p.t();
    double used = m["used"].n() / std::max(1., m["total"].n()),
           swap = m["swapUsed"].n() / std::max(1., m["swapTotal"].n());
    p.text("Memory      " + bytes(m["used"].n()) + " / " +
           bytes(m["total"].n()) + " (" + percent(used) + ")");
    p.meter(meter(used));
    p.spacer(cells(1));
    p.keys({kv("Used:", bytes(m["used"].n()), t.warning),
            kv("Available:", bytes(m["available"].n()), t.success),
            kv("Cached:", bytes(m["cached"].n()), t.accent),
            kv("Buffers:", bytes(m["buffers"].n()), t.secondary),
            kv("Free:", bytes(m["free"].n()), t.muted)});
    p.spacer();
    p.divider();
    p.text("Swap        " + bytes(m["swapUsed"].n()) + " / " +
           bytes(m["swapTotal"].n()) + " (" + percent(swap) + ")");
    p.meter(meter(swap, t.secondary));
    p.keys(
        {kv("Used:", bytes(m["swapUsed"].n()), t.secondary),
         kv("Free:", bytes(m["swapTotal"].n() - m["swapUsed"].n()), t.muted)});
  }, size);
}
static void disks_panel(UI &ui, State &s, Constraint size = fr()) {
  ui.panel("Disks", [&](UI &p) {
    auto t = p.t();
    auto &disks = s.data["disks"].array();
    if (disks.empty()) {
      p.label("No disks reported");
      return;
    }
    for (std::size_t i = 0; i < std::min(std::size_t(2), disks.size()); i++) {
      auto d = disks[i];
      double used = d["used"].n() / std::max(1., d["total"].n());
      p.text(d["device"].s() + " — " + bytes(d["total"].n()) + " (" +
             d["type"].s() + ")");
      p.text("Used: " + bytes(d["used"].n()) + " (" + percent(used) + ")",
             t.muted);
      p.meter(meter(used));
      p.text("Free: " + bytes(d["total"].n() - d["used"].n()), t.muted);
      p.row(cells(1), 0, [=](UI &r) {
        r.text("Read: " + byte_rate(d["readRate"].n()), t.success);
        r.text("Write: " + byte_rate(d["writeRate"].n()), t.secondary,
               HQ_RIGHT);
      });
      p.graph(
          multi(d["readHistory"], d["writeHistory"], t.success, t.secondary));
      if (i == 0 && disks.size() > 1)
        p.divider();
    }
  }, size);
}
static void system_panel(UI &ui, State &s, Constraint size = fr()) {
  const int gap = s.panel_gap();
  ui.panel("System", [&, gap](UI &p) {
    auto t = p.t();
    auto sys = s.data["system"], c = s.data["cpu"], m = s.data["memory"];
    double used = m["used"].n() / std::max(1., m["total"].n());
    auto count = sys["processCount"].n()
                     ? sys["processCount"].s()
                     : std::to_string(s.data["processes"].array().size());
    p.row(cells(6, 6), 2, [=, &s](UI &r) {
      r.keys({kv("OS:", sys["os"].s()), kv("Kernel:", sys["kernel"].s()),
              kv("Uptime:", duration(sys["uptime"].n())),
              kv("Hostname:", sys["hostname"].s()),
              kv("Shell:", sys["shell"].s()),
              kv("Source:", s.real ? "linux/proc" : "simulated", t.accent)},
             false);
      std::string load;
      for (auto &v : c["load"].array()) {
        if (!load.empty())
          load += ' ';
        load += fixed(v.n(), 2);
      }
      r.keys({kv("CPU:", percent(c["total"].n()), hq_heat(&t, c["total"].n())),
              kv("Memory:", percent(used) + " (" + bytes(m["used"].n()) + ")",
                 t.warning),
              kv("Swap:",
                 m["swapTotal"].n()
                     ? percent(m["swapUsed"].n() / m["swapTotal"].n())
                     : "—",
                 t.secondary),
              kv("Load:", load), kv("Processes:", count),
              kv("Threads:", sys["threadCount"].s())},
             false);
    });
    p.panel(
        "CPU History",
        [=](UI &g) { g.graph(graph(c["history"], t.success, 100, true)); },
        fr(1, 5));
    if (p.width() >= 46 && p.height() >= 16)
      p.row(cells(6), gap, [=, &s](UI &r) {
        r.panel("Quick Stats", [=, &s](UI &q) {
          q.keys(
              {kv("Uptime", duration(sys["uptime"].n()), t.accent),
               kv("Procs", count, t.accent),
               kv("Threads",
                  sys["threadCount"].n() ? sys["threadCount"].s() : "—",
                  t.accent),
               kv("Ctx/s",
                  fixed(s.data.path("telemetry.kernel.contextSwitchRate").n() /
                            1000,
                        1) +
                      "K",
                  t.accent)});
        });
        r.panel("Memory", [=](UI &q) {
          q.text(percent(used), t.warning);
          q.graph(graph(m["history"], t.primary, 100));
        });
        auto temp = s.data["temperatures"].at(0);
        r.panel(
            "Temp",
            [=](UI &q) {
              q.gauge(temp.null()
                          ? c["total"].n()
                          : std::min(1., temp["value"].n() /
                                             std::max(1., temp["max"].n(100))),
                      temp.null()
                          ? percent(c["total"].n())
                          : fixed(std::floor(temp["value"].n() + .5)) + "°C");
            },
            cells(14));
      });
    else {
      p.divider();
      p.keys({kv("Threads", sys["threadCount"].s(), t.accent),
              kv("Ctx switches",
                 fixed(sys["contextSwitches"].n() / 1000, 1) + "K", t.accent)});
    }
  }, size);
}
static void processes_panel(UI &ui, State &s, Constraint size = fr()) {
  std::string sort =
      std::vector<std::string>{"CPU", "MEM", "PID", "NAME"}[s.sort];
  ui.panel(
      "Processes (sorted by " + sort + ")",
      [&](UI &p) {
        auto t = p.t();
        table(p, s, "dashboard.processes", s.processes(),
              {dc("pid", "PID", 7, 1, 0, true),
               dc("name", "Name", -1, 8, t.primary),
               dc(
                   "cpu", "CPU%", 6, 1, 0, true,
                   [](const Json &d) { return fixed(d["cpu"].n(), 1); },
                   [=](const Json &d) {
                     return hq_heat(&t, std::min(1., d["cpu"].n() / 100));
                   }),
               dc("mem", "MEM%", 6, 1, t.warning, true,
                  [](const Json &d) { return fixed(d["mem"].n(), 1); }),
               dc("rss", "RSS", 9, 1, 0, true,
                  [](const Json &d) { return bytes(d["rss"].n(), 0); }),
               dc("threads", "Threads", 7, 1, 0, true),
               dc("state", "S", 2, 1, 0, false, {},
                  [=](const Json &d) {
                    return d["state"].s() == "R" ? t.success : t.muted;
                  }),
               dc("user", "User", 10, 1, t.muted),
               dc("command", "Command", -1, 10, t.muted)});
      },
      size, s.filter.empty() ? "" : "filter: " + s.filter,
      ui.t().border_focused);
}
static void network_panel(UI &ui, State &s, Constraint size = fr()) {
  ui.panel("Network", [&](UI &p) {
    auto t = p.t();
    auto n = s.data["network"];
    p.row(cells(1), 0, [=](UI &r) {
      r.text("Download: " + bit_rate(n["downRate"].n()), t.primary);
      r.text("Upload: " + bit_rate(n["upRate"].n()), t.secondary, HQ_RIGHT);
    });
    for (auto prefix : {"down", "up"}) {
      auto g = graph(n[std::string(prefix) + "History"],
                     std::string(prefix) == "down" ? t.primary : t.secondary,
                     {}, true);
      g.axis_format = [](double v) {
        auto value = bit_rate(v);
        value.erase(std::remove(value.begin(), value.end(), ' '), value.end());
        return value;
      };
      p.graph(g);
    }
    p.divider();
    p.row(cells(3), 2, [=](UI &r) {
      for (auto prefix : {"down", "up"}) {
        auto color = std::string(prefix) == "down" ? t.primary : t.secondary;
        r.keys(
            {kv("Total:", bytes(n[std::string(prefix) + "Total"].n()), color),
             kv("Current:", bit_rate(n[std::string(prefix) + "Rate"].n()),
                color),
             kv("Peak:", bit_rate(n[std::string(prefix) + "Peak"].n()), color)},
            false);
      }
    });
  }, size);
}
static void disk_usage_panel(UI &ui, State &s, Constraint size = fr()) {
  ui.panel(
      "Disk Usage",
      [&](UI &p) {
        auto t = p.t();
        for (auto &d : s.data["disks"].array()) {
          double used = d["used"].n() / std::max(1., d["total"].n());
          Meter m;
          m.value = used;
          m.segmented = true;
          m.readout = percent(used) + " " + bytes(d["used"].n(), 0) + " / " +
                      bytes(d["total"].n(), 0);
          p.meter(m);
          p.label(d["mount"].s() + " (" + d["device"].s() + ")");
        }
        p.spacer(cells(1));
        auto first = s.data["disks"].at(0);
        p.panel("I/O Summary", [=](UI &io) {
          io.row(fr(), 2, [=](UI &r) {
            r.col(fr(), 0, [=](UI &c) {
              c.text("Read: " + byte_rate(first["readRate"].n()), t.success);
              c.graph(graph(first["readHistory"], t.success));
            });
            r.col(fr(), 0, [=](UI &c) {
              c.text("Write: " + byte_rate(first["writeRate"].n()),
                     t.secondary);
              c.graph(graph(first["writeHistory"], t.secondary));
            });
          });
        });
      },
      size, s.data["disks"].at(0)["device"].s(""));
}
static void temperatures_panel(UI &ui, State &s) {
  ui.panel("Temperatures", [&](UI &p) {
    auto temps = s.data["temperatures"].array();
    auto t = p.t();
    if (temps.empty()) {
      p.text("No thermal sensors on this host.", t.muted);
      p.spacer(cells(1));
      p.label("Run with --sim to see this panel populated.");
      return;
    }
    int count = 0;
    for (auto &temp : temps) {
      if (count++ == 10)
        break;
      double v =
          std::min(1., temp["value"].n() / std::max(1., temp["max"].n(100)));
      p.row(cells(1), 0, [=](UI &r) {
        r.text(temp["label"].s(), t.muted, HQ_LEFT, cells(16));
        r.draw([=](Surface surface) {
          int w = surface.rect().width, filled = iround(v * w);
          for (int x = 0; x < w; x++)
            surface.set(x, 0, 0x25ae,
                        Style().foreground(
                            x < filled
                                ? hq_heat(&t, w <= 1 ? v : double(x) / (w - 1))
                                : hq_mix(t.background, t.border, .75)));
        });
        r.text(fixed(std::floor(temp["value"].n() + .5)) + "°C", hq_heat(&t, v),
               HQ_RIGHT, cells(6));
      });
    }
  });
}
static void sensors_panel(UI &ui, State &s) {
  ui.panel("Sensors", [&](UI &p) {
    auto &sensors = s.data["sensors"].array();
    if (sensors.empty()) {
      p.label("No hardware sensors on this host.");
      p.spacer(cells(1));
      p.label("Probed: /sys/class/hwmon, thermal zones, lm-sensors,");
      p.label("power supplies and nvidia-smi.");
      return;
    }
    std::vector<KeyValue> rows;
    for (auto &v : sensors)
      rows.push_back(kv(v["label"].s(), v["value"].s(), p.t().accent));
    p.keys(rows);
  });
}
static void logs_panel(UI &ui, State &s, Constraint size = fr()) {
  ui.panel("Logs", [&](UI &p) {
    p.log(logs(s.data["logs"]), &s.panes["dashboard.logs"], "dashboard.logs");
  }, size);
}
// Panels go straight into their row rather than each inside a sizing column. A
// column is not a bordered child, so a row of them has no seam to merge and `c`
// could never change this screen; a size on the panel does the same job and
// leaves the borders adjacent to each other.
void dashboard(UI &ui, State &s) {
  const int gap = s.panel_gap();
  if (ui.width() >= 150) {
    ui.row(cells(ui.height() >= 44 ? 19 : 16), gap, [&](UI &r) {
      cpu_panel(r, s, 2, fr());
      memory_panel(r, s, fr(.95));
      disks_panel(r, s, fr(.95));
      system_panel(r, s, fr(1.35));
    });
    ui.row(fr(), gap, [&](UI &r) {
      processes_panel(r, s, fr(2));
      network_panel(r, s, fr(1.2));
      disk_usage_panel(r, s, fr(1.2));
    });
    ui.row(cells(12), gap, [&](UI &r) {
      temperatures_panel(r, s);
      sensors_panel(r, s);
      logs_panel(r, s, fr(1.6));
    });
  } else if (ui.width() >= 100) {
    ui.row(cells(14), gap, [&](UI &r) {
      cpu_panel(r, s, 2);
      memory_panel(r, s);
      system_panel(r, s);
    });
    ui.row(fr(), gap, [&](UI &r) {
      processes_panel(r, s, fr(1.6));
      network_panel(r, s, fr());
    });
    ui.row(cells(10), gap, [&](UI &r) {
      temperatures_panel(r, s);
      logs_panel(r, s);
    });
  } else {
    ui.row(cells(10), gap, [&](UI &r) {
      cpu_panel(r, s, 1);
      memory_panel(r, s);
    });
    ui.col(fr(), 0, [&](UI &c) { processes_panel(c, s); });
    ui.row(cells(8), gap, [&](UI &r) { network_panel(r, s); });
  }
}
} // namespace demo
