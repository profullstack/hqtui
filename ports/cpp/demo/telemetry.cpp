#include "model.hpp"
namespace demo {
static std::string rate(double v) {
  return v >= 1e6    ? fixed(v / 1e6, 1) + "M/s"
         : v >= 1000 ? fixed(v / 1000, 1) + "K/s"
                     : fixed(v) + "/s";
}
static std::string commas(double v) {
  auto s = fixed(v);
  for (int i = int(s.size()) - 3; i > 0; i -= 3)
    s.insert(i, ",");
  return s;
}
static Color status_color(const hq_theme &t, std::string c) {
  return c == "1xx"   ? t.secondary
         : c == "2xx" ? t.success
         : c == "3xx" ? t.accent
         : c == "4xx" ? t.warning
         : c == "5xx" ? t.danger
                      : t.muted;
}
static void traffic(UI &ui, State &s) {
  const int gap = s.panel_gap();
  if (s.real)
    ui.label("Protocol/direction: port-based estimates; HTTP rate: estimated "
             "from log growth");
  auto t = ui.t();
  const auto &d = s.data["telemetry"], &net = d["net"], &rates = net["rates"],
             &http = d["http"];
  ui.row(cells(13), gap, [&, t](UI &r) {
    r.panel(
        "Protocols",
        [&, t](UI &p) {
          auto &data = d["protocols"].array();
          if (data.empty()) {
            p.label("No sockets visible.");
            return;
          }
          double maximum = 1;
          for (auto &v : data)
            maximum = std::max(maximum, v["total"].n());
          std::vector<Meter> items;
          int i = 0;
          for (auto &b : data) {
            if (i == 9)
              break;
            Meter m;
            m.label = b["protocol"].s();
            m.value = b["total"].n() / maximum;
            m.color = hq_series(&t, i++);
            m.readout = b["total"].s();
            m.label_width = 13;
            m.value_width = 5;
            m.segmented = false;
            items.push_back(m);
          }
          p.meters(items);
        },
        fr(),
        d["inboundConnections"].s() + " in / " + d["outboundConnections"].s() +
            " out",
        t.accent);
    r.panel(
        "TCP",
        [&, t](UI &p) {
          p.row(cells(1), 0, [&, t](UI &r) {
            r.text("↓ " + rate(rates["inSegs"].n()) + " seg", t.primary);
            r.text("↑ " + rate(rates["outSegs"].n()) + " seg", t.secondary,
                   HQ_RIGHT);
          });
          p.graph(multi(d["netInHistory"], d["netOutHistory"], t.primary,
                        t.secondary));
          p.divider();
          p.keys({kv("Established", net["tcpEstablished"].s(), t.success),
                  kv("Opens in/out",
                     rate(rates["passiveOpens"].n()) + " / " +
                         rate(rates["activeOpens"].n()),
                     t.accent),
                  kv("Resets sent", commas(net["tcpOutRsts"].n()), t.muted)});
        },
        fr(.9), "", t.primary);
    auto color = net["retransRatio"].n() > .02 ? t.danger : t.success;
    r.panel(
        "Retransmits",
        [&, t, color](UI &p) {
          p.text(fixed(ratio(net["retransRatio"].n()) * 100, 2) + "%", color,
                 HQ_LEFT, cells(1), HQ_BOLD);
          p.label("of outbound segments");
          p.graph(graph(d["retransHistory"], t.danger));
          p.keys(
              {kv("UDP in/out",
                  rate(rates["udpIn"].n()) + " / " + rate(rates["udpOut"].n()),
                  t.muted),
               kv("ICMP",
                  net["icmpInMsgs"].s() + " / " + net["icmpOutMsgs"].s(),
                  t.muted)});
        },
        fr(.7), "", color);
  });
  ui.row(fr(), 1, [&, t](UI &r) {
    r.col(fr(), s.panel_gap(), [&, t](UI &c) {
      c.panel(
          "HTTP",
          [&, t](UI &p) {
            if (http.null()) {
              p.label("No readable HTTP access log.");
              p.label("nginx, apache, httpd and caddy logs are");
              p.label("root/adm readable — run with sudo to track requests.");
              return;
            }
            p.row(cells(1), 0, [&, t](UI &r) {
              r.text(http["source"].s(), t.muted);
              r.text(http["upgrades"].s() + " upgrades (ws)", t.secondary,
                     HQ_RIGHT);
            });
            p.graph(graph(http["history"], t.success), cells(6));
            p.divider("status");
            double maximum = 1;
            for (auto &b : http["statusClasses"].array())
              maximum = std::max(maximum, b["count"].n());
            std::vector<Meter> items;
            for (auto &b : http["statusClasses"].array()) {
              Meter m;
              m.label = b["class"].s();
              m.value = b["count"].n() / maximum;
              m.color = status_color(t, m.label);
              m.readout = b["count"].s();
              m.label_width = 5;
              m.value_width = 7;
              m.segmented = false;
              items.push_back(m);
            }
            p.meters(items);
            p.divider("top paths");
            table(p, s, "traffic.paths", http["topPaths"].array(),
                  {dc("path", "Path", -1, 20, t.primary),
                   dc("count", "Hits", 7, 1, t.accent, true)},
                  false, false);
          },
          fr(),
          http.null() ? "no access log"
                      : fixed(http["requestsPerSecond"].n(), 1) + " req/s",
          t.success);
    });
    r.col(fr(.85), s.panel_gap(), [&, t](UI &c) {
      c.panel(
          "SSH Activity",
          [&, t](UI &p) {
            auto rows = d["ssh"].array();
            if (rows.empty()) {
              p.label("No sshd events in the journal.");
              return;
            }
            std::reverse(rows.begin(), rows.end());
            table(p, s, "traffic.ssh", rows,
                  {dc("time", "Time", 9, 1, t.muted),
                   dc("action", "Action", 11, 1, 0, false, {},
                      [=](const Json &d) {
                        return d["action"].s() == "accepted"     ? t.success
                               : d["action"].s() == "disconnect" ? t.muted
                                                                 : t.danger;
                      }),
                   dc("user", "User", 12, 1, t.primary),
                   dc("from", "From", -1, 14, t.accent),
                   dc("method", "Method", 10, 1, t.muted)},
                  true);
          },
          fr(), std::to_string(d["ssh"].array().size()), t.warning);
      c.panel(
          "Top Remote Hosts",
          [&, t](UI &p) {
            if (d["remotes"].array().empty()) {
              p.label("No remote peers.");
              return;
            }
            table(p, s, "traffic.remotes", d["remotes"].array(),
                  {dc("host", "Host", -1, 16, t.accent),
                   dc("connections", "Conns", 6, 1, t.success, true),
                   dc("protocols", "Protocols", -1, 12, t.muted)},
                  true);
          },
          cells(10), "", t.secondary);
    });
  });
  if (!http.null() && !http["recent"].array().empty())
    ui.panel(
        "Recent Requests",
        [&, t](UI &p) {
          table(p, s, "traffic.requests", http["recent"].array(),
                {dc("time", "Time", 9, 1, t.muted),
                 dc("method", "Method", 7, 1, t.secondary),
                 dc("path", "Path", -1, 24, t.primary),
                 dc("status", "Status", 7, 1, 0, true, {},
                    [=](const Json &d) {
                      return status_color(t,
                                          d["status"].s().substr(0, 1) + "xx");
                    }),
                 dc("client", "Client", 16, 1, t.accent),
                 dc("bytes", "Bytes", 9, 1, t.muted, true)},
                true);
        },
        cells(10), "", t.primary);
}
static void sessions(UI &ui, State &s) {
  const int gap = s.panel_gap();
  auto t = ui.t();
  const auto &d = s.data["telemetry"];
  ui.row(cells(9), gap, [&, t](UI &r) {
    r.panel(
        "Active Sessions",
        [&, t](UI &p) {
          if (d["sessions"].array().empty()) {
            p.label("No interactive sessions.");
            p.label("(`who` reports nothing on this host)");
            return;
          }
          table(p, s, "sessions.active", d["sessions"].array(),
                {dc("user", "User", 12, 1, t.primary), dc("tty", "TTY", 10),
                 dc("from", "From", -1, 12, t.accent),
                 dc("loginAt", "Login", 14, 1, t.muted),
                 dc("idle", "Idle", 8, 1, 0, true)});
        },
        fr(), std::to_string(d["sessions"].array().size()), t.success);
    r.panel(
        "Process States",
        [&, t](UI &p) {
          auto states = d["states"];
          const char *keys[] = {"running", "sleeping", "stopped", "zombie"},
                     *labels[] = {"run ", "slp ", "stop", "zomb"};
          Color colors[] = {t.success, t.primary, t.warning, t.danger};
          for (int i = 0; i < 4; i++) {
            Meter m;
            m.value = states[keys[i]].n() / std::max(1., states["total"].n());
            m.label = labels[i];
            m.readout = states[keys[i]].s();
            m.color = colors[i];
            m.segmented = false;
            p.meter(m);
          }
          p.spacer(cells(1));
          p.keys({kv("Total", states["total"].s(), t.accent)});
        },
        cells(34), "", t.primary);
  });
  ui.row(fr(), 1, [&, t](UI &r) {
    r.panel(
        "Recent Logins",
        [&, t](UI &p) {
          if (d["logins"].array().empty()) {
            p.label("No login history available.");
            return;
          }
          table(p, s, "sessions.logins", d["logins"].array(),
                {dc("user", "User", 12, 1, t.primary),
                 dc("tty", "TTY", 12, 1, t.muted),
                 dc("from", "From", -1, 14, t.accent),
                 dc("when", "When", -1, 16, t.muted),
                 dc("status", "Status", 8, 1, 0, false, {},
                    [=](const Json &d) {
                      return d["status"].s() == "still" ? t.success : t.muted;
                    })},
                true);
        },
        fr(), std::to_string(d["logins"].array().size()) + " from wtmp",
        t.accent);
    r.col(fr(.8), s.panel_gap(), [&, t](UI &c) {
      c.panel(
          "Failed Logins",
          [&, t](UI &p) {
            if (d["failedLogins"].array().empty()) {
              p.label("None recorded.");
              p.label("(btmp is usually root-only)");
              return;
            }
            table(p, s, "sessions.failed", d["failedLogins"].array(),
                  {dc("user", "User", 12, 1, t.danger),
                   dc("from", "From", -1, 12),
                   dc("when", "When", -1, 14, t.muted)});
          },
          fr(), "", t.danger);
      c.panel(
          "Session History",
          [&, t](UI &p) {
            p.label("concurrent sessions");
            p.graph(graph(d["sessionHistory"], t.success));
          },
          cells(8), "", t.secondary);
    });
  });
}
static void network(UI &ui, State &s) {
  const int gap = s.panel_gap();
  auto t = ui.t();
  const auto &d = s.data["telemetry"];
  auto shown = d["interfaces"].array();
  std::vector<Json> active;
  for (auto &i : shown)
    if (i["rxTotal"].n() > 0 || i["state"].s() == "up")
      active.push_back(i);
  if (!active.empty())
    shown = active;
  if (shown.size() > 3)
    shown.resize(3);
  ui.row(cells(13), gap, [&, t, shown](UI &r) {
    if (shown.empty()) {
      r.panel("Interfaces", [](UI &p) { p.label("No interfaces reported."); });
      return;
    }
    for (std::size_t i = 0; i < shown.size(); i++) {
      auto iface = shown[i];
      Color color = i == 0 ? t.primary : i == 1 ? t.success : t.secondary;
      r.panel(
          iface["name"].s() + " (" + iface["state"].s() + ")",
          [=](UI &p) {
            p.row(cells(1), 0, [=](UI &r) {
              r.text("↓ " + byte_rate(iface["rxRate"].n()), t.primary);
              r.text("↑ " + byte_rate(iface["txRate"].n()), t.secondary,
                     HQ_RIGHT);
            });
            p.graph(multi(iface["rxHistory"], iface["txHistory"], t.primary,
                          t.secondary));
            p.divider();
            p.keys({kv("RX total", bytes(iface["rxTotal"].n()), t.primary),
                    kv("TX total", bytes(iface["txTotal"].n()), t.secondary),
                    kv("MAC", iface["mac"].s(), t.muted),
                    kv("MTU / err / drop",
                       iface["mtu"].s() + " / " + iface["errors"].s() + " / " +
                           iface["drops"].s(),
                       t.muted)});
          },
          fr(), iface["ip"].s(""), color);
    }
  });
  ui.row(fr(), 1, [&, t](UI &r) {
    r.panel(
        "Connections",
        [&, t](UI &p) {
          if (d["connections"].array().empty()) {
            p.label("No connections visible (`ss` unavailable).");
            return;
          }
          table(p, s, "network.connections", d["connections"].array(),
                {dc("proto", "Proto", 6, 1, t.muted),
                 dc("local", "Local", -1, 18),
                 dc("remote", "Remote", -1, 18, t.accent),
                 dc("state", "State", 10, 1, t.success),
                 dc("process", "Process", -1, 12, t.primary)},
                true);
        },
        fr(), std::to_string(d["connections"].array().size()) + " open",
        t.accent);
    r.col(fr(.7), s.panel_gap(), [&, t](UI &c) {
      c.panel(
          "Listening Ports",
          [&, t](UI &p) {
            table(p, s, "network.listeners", d["listeners"].array(),
                  {dc("proto", "Proto", 6, 1, t.muted),
                   dc("port", "Port", 7, 1, t.warning, true),
                   dc("address", "Address", -1, 10, t.muted),
                   dc("process", "Process", -1, 10, t.primary)},
                  true);
          },
          fr(), std::to_string(d["listeners"].array().size()), t.warning);
      c.panel(
          "Open Connections",
          [&, t](UI &p) { p.graph(graph(d["connectionHistory"], t.accent)); },
          cells(6), "", t.secondary);
    });
  });
}
static void services(UI &ui, State &s) {
  auto t = ui.t();
  const auto &d = s.data["telemetry"];
  int failed = 0;
  for (auto &v : d["services"].array())
    failed += v["active"].s() == "failed";
  ui.row(fr(), 1, [&, t, failed](UI &r) {
    r.panel(
        "Services",
        [&, t](UI &p) {
          if (d["services"].array().empty()) {
            p.label("systemd not available on this host.");
            return;
          }
          table(p, s, "services.units", d["services"].array(),
                {dc("name", "Unit", -1, 18, t.primary),
                 dc("active", "Active", 10, 1, 0, false, {},
                    [=](const Json &d) {
                      return d["active"].s() == "failed"   ? t.danger
                             : d["active"].s() == "active" ? t.success
                                                           : t.muted;
                    }),
                 dc("sub", "Sub", 10, 1, t.muted),
                 dc("description", "Description", -1, 16, t.muted)},
                true);
        },
        fr(),
        failed ? std::to_string(failed) + " failed"
               : std::to_string(d["services"].array().size()) + " units",
        failed ? t.danger : t.success, {}, failed ? t.danger : t.muted);
    r.col(fr(.85), s.panel_gap(), [&, t](UI &c) {
      c.panel(
          "Kernel",
          [&, t](UI &p) {
            auto k = d["kernel"];
            auto krate = [](double v) {
              return v >= 1000 ? fixed(v / 1000, 1) + "K/s" : fixed(v) + "/s";
            };
            p.keys({kv("Context switches", krate(k["contextSwitchRate"].n()),
                       t.accent),
                    kv("Interrupts", krate(k["interruptRate"].n()), t.accent),
                    kv("Forks", krate(k["forkRate"].n()), t.accent),
                    kv("Procs running", k["procsRunning"].s(), t.success),
                    kv("Procs blocked", k["procsBlocked"].s(),
                       k["procsBlocked"].n() ? t.warning : t.muted),
                    kv("Open file descriptors", commas(k["openFiles"].n()),
                       t.primary),
                    kv("Entropy available", k["entropy"].s(),
                       k["entropy"].n() < 200 ? t.warning : t.success),
                    kv("Page in / out",
                       fixed(k["pageIn"].n() / 1000) + "K / " +
                           fixed(k["pageOut"].n() / 1000) + "K",
                       t.muted)});
          },
          cells(11), "", t.accent);
      c.panel(
          "Containers",
          [&, t](UI &p) {
            if (d["containers"].array().empty()) {
              p.label("No running containers.");
              p.label("(docker not installed or not reachable)");
              return;
            }
            table(p, s, "services.containers", d["containers"].array(),
                  {dc("name", "Name", -1, 12, t.primary),
                   dc("image", "Image", -1, 14, t.muted),
                   dc("status", "Status", -1, 12, t.success)},
                  true);
          },
          cells(9), "", t.primary);
      c.panel(
          "Hardware",
          [&, t](UI &p) {
            std::vector<KeyValue> rows;
            auto power = d["power"];
            if (!power.null()) {
              rows.push_back(kv("Battery",
                                power["battery"].s() + "% (" +
                                    power["timeRemaining"].s() + ")",
                                t.success));
              rows.push_back(kv("AC",
                                power["acConnected"].s() == "true"
                                    ? "connected"
                                    : "on battery",
                                t.muted));
              rows.push_back(kv("Draw",
                                power["powerDraw"].null()
                                    ? "—"
                                    : fixed(power["powerDraw"].n(), 1) + " W",
                                t.warning));
            }
            for (auto &g : d["gpus"].array()) {
              rows.push_back(
                  kv(g["name"].s(),
                     (g["utilization"].null() ? "—"
                                              : percent(g["utilization"].n())) +
                         " · " + g["temperature"].s() + "°C",
                     t.accent));
              rows.push_back(kv(
                  "GPU memory",
                  (g["memoryUsed"].null() ? "—" : bytes(g["memoryUsed"].n())) +
                      " / " +
                      (g["memoryTotal"].null() ? "—"
                                               : bytes(g["memoryTotal"].n())),
                  t.muted));
            }
            if (rows.empty()) {
              p.label("No battery or GPU telemetry on this host.");
              return;
            }
            p.keys(rows);
          },
          fr(), "", t.warning);
    });
  });
  ui.panel(
      "Filesystems",
      [&, t](UI &p) {
        if (d["filesystems"].array().empty()) {
          p.label("No filesystems reported.");
          return;
        }
        table(p, s, "services.filesystems", d["filesystems"].array(),
              {dc("mount", "Mount", -1, 14, t.primary),
               dc("device", "Device", -1, 12, t.muted),
               dc("type", "Type", 8, 1, t.muted),
               dc("size", "Size", 10, 1, 0, true,
                  [](const Json &d) { return bytes(d["size"].n(), 0); }),
               dc("used", "Used", 10, 1, 0, true,
                  [](const Json &d) { return bytes(d["used"].n(), 0); }),
               dc(
                   "pct", "Use%", 6, 1, 0, true,
                   [](const Json &d) {
                     return d["size"].n()
                                ? percent(d["used"].n() / d["size"].n())
                                : "-";
                   },
                   [=](const Json &d) {
                     return d["size"].n() && d["used"].n() / d["size"].n() > .9
                                ? t.danger
                                : t.warning;
                   }),
               dc("inodes", "Inodes", 16, 1, t.muted, true,
                  [](const Json &d) {
                    return d["inodesTotal"].n()
                               ? percent(d["inodesUsed"].n() /
                                         d["inodesTotal"].n()) +
                                     " of " +
                                     fixed(d["inodesTotal"].n() / 1e6, 1) + "M"
                               : "-";
                  })},
              true);
      },
      cells(10), "", t.secondary);
}
void telemetry(UI &ui, State &s) {
  switch (s.screen) {
  case 1:
    traffic(ui, s);
    break;
  case 2:
    sessions(ui, s);
    break;
  case 3:
    network(ui, s);
    break;
  case 4:
    services(ui, s);
    break;
  default:
    break;
  }
}
} // namespace demo
