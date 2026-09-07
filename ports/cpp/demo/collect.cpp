#include "collect.hpp"
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <thread>
#if defined(__unix__) || defined(__APPLE__)
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <sys/statvfs.h>
#include <sys/utsname.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;
#endif
namespace demo {
std::string read_file(const std::string &path, std::size_t limit) {
  std::ifstream in(path, std::ios::binary);
  if (!in)
    return {};
  std::string out;
  char buffer[4096];
  while (in && out.size() < limit) {
    in.read(buffer,
            std::streamsize(std::min(sizeof buffer, limit - out.size())));
    out.append(buffer, std::size_t(in.gcount()));
  }
  return out;
}
static double now() {
  return std::chrono::duration<double>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}
std::string command(const std::vector<std::string> &args,
                    const std::atomic<bool> *cancel, int timeout_ms) {
#if defined(__unix__) || defined(__APPLE__)
  if (args.empty() || (cancel && cancel->load()))
    return {};
  int fd[2];
  if (pipe(fd))
    return {};
  fcntl(fd[0], F_SETFD, FD_CLOEXEC);
  fcntl(fd[1], F_SETFD, FD_CLOEXEC);
  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0);
  posix_spawn_file_actions_addopen(&actions, 2, "/dev/null", O_WRONLY, 0);
  posix_spawn_file_actions_adddup2(&actions, fd[1], 1);
  posix_spawn_file_actions_addclose(&actions, fd[0]);
  posix_spawn_file_actions_addclose(&actions, fd[1]);
  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETPGROUP);
  posix_spawnattr_setpgroup(&attr, 0);
  std::vector<char *> argv;
  for (auto &s : args)
    argv.push_back(const_cast<char *>(s.c_str()));
  argv.push_back(nullptr);
  pid_t pid = 0;
  int error =
      posix_spawnp(&pid, argv[0], &actions, &attr, argv.data(), environ);
  posix_spawn_file_actions_destroy(&actions);
  posix_spawnattr_destroy(&attr);
  close(fd[1]);
  if (error) {
    close(fd[0]);
    return {};
  }
  fcntl(fd[0], F_SETFL, fcntl(fd[0], F_GETFL) | O_NONBLOCK);
  std::string out;
  double deadline = now() + timeout_ms / 1000.;
  int status = 0;
  bool done = false;
  while (now() < deadline && out.size() < 262144 &&
         !(cancel && cancel->load())) {
    char buffer[8192];
    ssize_t n =
        read(fd[0], buffer, std::min(sizeof buffer, 262144 - out.size()));
    if (n > 0)
      out.append(buffer, std::size_t(n));
    else if (n == 0) {
      done = true;
      break;
    } else if (errno != EAGAIN && errno != EINTR)
      break;
    struct pollfd pfd{fd[0], POLLIN, 0};
    poll(&pfd, 1, 20);
  }
  // A child may close stdout and continue running. Reaping is bounded too.
  pid_t reaped;
  do {
    reaped = waitpid(pid, &status, WNOHANG);
  } while (reaped < 0 && errno == EINTR);
  if (!done || reaped == 0) {
    kill(-pid, SIGKILL);
    while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {
    }
  }
  close(fd[0]);
  return out;
#else
  (void)args;
  (void)cancel;
  (void)timeout_ms;
  return {};
#endif
}
static std::vector<std::string> lines(const std::string &s) {
  std::vector<std::string> out;
  std::istringstream in(s);
  std::string line;
  while (std::getline(in, line))
    out.push_back(line);
  return out;
}
static std::vector<std::string> words(const std::string &s) {
  std::vector<std::string> out;
  std::istringstream in(s);
  std::string word;
  while (in >> word)
    out.push_back(word);
  return out;
}
static std::string trim(std::string s) {
  auto first = s.find_first_not_of(" \t\r\n"),
       last = s.find_last_not_of(" \t\r\n");
  return first == s.npos ? "" : s.substr(first, last - first + 1);
}
static double numeric(const std::string &s) {
  char *end = nullptr;
  double v = std::strtod(s.c_str(), &end);
  return end != s.c_str() && std::isfinite(v) ? v : 0;
}
static Json clear(const Json &v) {
  if (std::holds_alternative<Json::Object>(v.value)) {
    Json::Object out;
    for (auto &item : std::get<Json::Object>(v.value))
      out[item.first] = clear(item.second);
    return out;
  }
  if (std::holds_alternative<Json::Array>(v.value))
    return Json::Array{};
  if (std::holds_alternative<double>(v.value))
    return 0;
  if (std::holds_alternative<std::string>(v.value))
    return "";
  if (std::holds_alternative<bool>(v.value))
    return false;
  return {};
}
static void history(Json &j, double value) {
  auto &a = j.array();
  if (a.size() >= 240)
    a.erase(a.begin());
  a.emplace_back(value);
}
Collector::Collector(const Json &shape) : data(clear(shape)) {
  data["telemetry"]["http"] = Json();
  data["telemetry"]["power"] = Json();
}
void Collector::refresh(const std::atomic<bool> *cancel) {
#ifndef __linux__
  (void)cancel;
  throw std::runtime_error(
      "Live collectors require Linux; use --sim on this platform.");
#else
  double time = now(), elapsed = last ? std::max(.001, time - last) : 0;
  auto delta = [&](std::string key, double value) {
    auto it = counters.find(key);
    double out = it != counters.end() && elapsed
                     ? std::max(0., value - it->second) / elapsed
                     : 0;
    counters[key] = value;
    return out;
  };
  auto &cpu = data["cpu"], &memory = data["memory"], &system = data["system"],
       &network = data["network"], &telemetry = data["telemetry"],
       &kernel = telemetry["kernel"];
  data["time"] = time;
  struct utsname os{};
  uname(&os);
  system["kernel"] = os.release;
  system["hostname"] = os.nodename;
  system["os"] = os.sysname;
  for (auto &line : lines(read_file("/etc/os-release")))
    if (line.rfind("PRETTY_NAME=", 0) == 0) {
      auto value = line.substr(12);
      if (value.size() >= 2 && value.front() == '"' && value.back() == '"')
        value = value.substr(1, value.size() - 2);
      system["os"] = value;
    }
  system["uptime"] = numeric(read_file("/proc/uptime"));
  const char *shell = std::getenv("SHELL");
  system["shell"] = shell ? shell : "";
  Json::Array cores;
  for (auto &line : lines(read_file("/proc/stat"))) {
    auto v = words(line);
    if (v.size() < 2)
      continue;
    if (v[0].rfind("cpu", 0) == 0 && v.size() >= 5) {
      double total = 0;
      for (std::size_t i = 1; i < std::min(v.size(), std::size_t(9)); i++)
        total += numeric(v[i]);
      double idle = numeric(v[4]) + (v.size() > 5 ? numeric(v[5]) : 0),
             dt = delta(v[0] + ".total", total),
             di = delta(v[0] + ".idle", idle),
             used = dt ? ratio((dt - di) / dt) : 0;
      if (v[0] == "cpu") {
        cpu["total"] = used;
        history(cpu["history"], used * 100);
      } else
        cores.emplace_back(used);
    } else if (v[0] == "ctxt") {
      system["contextSwitches"] = numeric(v[1]);
      kernel["contextSwitchRate"] = delta("ctxt", numeric(v[1]));
    } else if (v[0] == "intr")
      kernel["interruptRate"] = delta("intr", numeric(v[1]));
    else if (v[0] == "processes")
      kernel["forkRate"] = delta("forks", numeric(v[1]));
    else if (v[0] == "procs_running")
      kernel["procsRunning"] = numeric(v[1]);
    else if (v[0] == "procs_blocked")
      kernel["procsBlocked"] = numeric(v[1]);
  }
  cpu["cores"] = cores;
  Json::Array sensors, temps;
  std::size_t core = 0;
  double mhz = 0;
  for (auto &line : lines(read_file("/proc/cpuinfo"))) {
    auto colon = line.find(':');
    if (colon == line.npos)
      continue;
    auto key = trim(line.substr(0, colon)),
         value = trim(line.substr(colon + 1));
    if (key == "model name")
      cpu["model"] = value;
    if (key == "cpu MHz") {
      double n = numeric(value);
      mhz += n;
      sensors.push_back(
          Json::Object{{"label", "cpu" + std::to_string(core++) + " Clock"},
                       {"value", fixed(n) + " MHz"}});
    }
  }
  cpu["frequencyGhz"] = core ? mhz / core / 1000 : 0;
  Json::Array load;
  auto averages = words(read_file("/proc/loadavg"));
  for (int i = 0; i < 3 && i < int(averages.size()); i++)
    load.emplace_back(numeric(averages[i]));
  cpu["load"] = load;
  std::map<std::string, double> mem;
  for (auto &line : lines(read_file("/proc/meminfo"))) {
    auto v = words(line);
    if (v.size() > 1)
      mem[v[0]] = numeric(v[1]) * 1024;
  }
  memory["total"] = mem["MemTotal:"];
  memory["available"] = mem["MemAvailable:"];
  memory["used"] = std::max(0., mem["MemTotal:"] - mem["MemAvailable:"]);
  memory["free"] = mem["MemFree:"];
  memory["cached"] = mem["Cached:"];
  memory["buffers"] = mem["Buffers:"];
  memory["swapTotal"] = mem["SwapTotal:"];
  memory["swapUsed"] = std::max(0., mem["SwapTotal:"] - mem["SwapFree:"]);
  history(memory["history"],
          memory["used"].n() / std::max(1., memory["total"].n()) * 100);
  std::error_code ec;
  for (auto device :
       std::filesystem::directory_iterator("/sys/class/hwmon", ec)) {
    auto chip = trim(read_file(device.path().string() + "/name", 256));
    for (auto file : std::filesystem::directory_iterator(device.path(), ec)) {
      auto name = file.path().filename().string();
      if (name.size() < 7 || name.substr(name.size() - 6) != "_input")
        continue;
      std::string prefix = name.substr(0, name.size() - 6),
                  label = trim(read_file(
                      device.path().string() + "/" + prefix + "_label", 256));
      if (label.empty())
        label = chip + " " + prefix;
      auto raw = trim(read_file(file.path().string(), 80));
      if (raw.empty())
        continue;
      double value = numeric(raw);
      if (prefix.rfind("temp", 0) == 0 && value >= -40000 && value <= 150000) {
        double maximum =
            numeric(read_file(device.path().string() + "/" + prefix + "_crit",
                              80)) /
            1000;
        temps.push_back(Json::Object{{"label", label},
                                     {"value", value / 1000},
                                     {"max", maximum > 0 ? maximum : 100}});
      } else if (prefix.rfind("fan", 0) == 0 && value > 0)
        sensors.push_back(
            Json::Object{{"label", label}, {"value", fixed(value) + " RPM"}});
      else if (prefix.rfind("in", 0) == 0)
        sensors.push_back(Json::Object{
            {"label", label}, {"value", fixed(value / 1000, 2) + " V"}});
    }
  }
  data["sensors"] = sensors;
  data["temperatures"] = temps;
  Json::Array interfaces;
  double rx = 0, tx = 0, rxrate = 0, txrate = 0;
  for (auto &line : lines(read_file("/proc/net/dev"))) {
    auto colon = line.find(':');
    if (colon == line.npos)
      continue;
    auto name = trim(line.substr(0, colon));
    auto v = words(line.substr(colon + 1));
    if (v.size() < 16)
      continue;
    double a = numeric(v[0]), b = numeric(v[8]), ar = delta("rx." + name, a),
           br = delta("tx." + name, b);
    Json iface = Json::Object{
        {"name", name},
        {"state",
         trim(read_file("/sys/class/net/" + name + "/operstate", 128))},
        {"ip", ""},
        {"mac", trim(read_file("/sys/class/net/" + name + "/address", 128))},
        {"mtu", numeric(read_file("/sys/class/net/" + name + "/mtu", 128))},
        {"rxTotal", a},
        {"txTotal", b},
        {"rxRate", ar},
        {"txRate", br},
        {"errors", numeric(v[2]) + numeric(v[10])},
        {"drops", numeric(v[3]) + numeric(v[11])}};
    for (auto &old : telemetry["interfaces"].array())
      if (old["name"].s() == name) {
        iface["rxHistory"] = old["rxHistory"];
        iface["txHistory"] = old["txHistory"];
      }
    history(iface["rxHistory"], ar);
    history(iface["txHistory"], br);
    interfaces.push_back(iface);
    if (name != "lo") {
      rx += a;
      tx += b;
      rxrate += ar;
      txrate += br;
    }
  }
  telemetry["interfaces"] = interfaces;
  network["downRate"] = rxrate;
  network["upRate"] = txrate;
  network["downTotal"] = rx;
  network["upTotal"] = tx;
  network["downPeak"] = std::max(network["downPeak"].n(), rxrate);
  network["upPeak"] = std::max(network["upPeak"].n(), txrate);
  history(network["downHistory"], rxrate);
  history(network["upHistory"], txrate);
  Json::Array processes;
  int threads = 0, running = 0, sleeping = 0, stopped = 0, zombie = 0;
  for (auto &line : lines(command(
           {"ps", "-eo", "pid=,comm=,pcpu=,pmem=,rss=,nlwp=,stat=,user=,args="},
           cancel))) {
    auto v = words(line);
    if (v.size() < 8)
      continue;
    std::string cmd;
    for (std::size_t i = 8; i < v.size(); i++) {
      if (!cmd.empty())
        cmd += ' ';
      cmd += v[i];
    }
    auto state = v[6].substr(0, 1);
    running += state == "R";
    stopped += state == "T";
    zombie += state == "Z";
    sleeping += state != "R" && state != "T" && state != "Z";
    threads += int(numeric(v[5]));
    processes.push_back(Json::Object{{"pid", numeric(v[0])},
                                     {"name", v[1]},
                                     {"cpu", numeric(v[2])},
                                     {"mem", numeric(v[3])},
                                     {"rss", numeric(v[4]) * 1024},
                                     {"threads", numeric(v[5])},
                                     {"state", state},
                                     {"user", v[7]},
                                     {"command", cmd}});
  }
  data["processes"] = processes;
  system["processCount"] = int(processes.size());
  system["threadCount"] = threads;
  telemetry["states"] = Json::Object{{"total", int(processes.size())},
                                     {"running", running},
                                     {"sleeping", sleeping},
                                     {"stopped", stopped},
                                     {"zombie", zombie}};
  Json::Array disks, filesystems;
  std::map<std::string, std::pair<double, double>> io;
  for (auto &line : lines(read_file("/proc/diskstats"))) {
    auto v = words(line);
    if (v.size() < 14)
      continue;
    io[v[2]] = {delta("diskr." + v[2], numeric(v[5]) * 512),
                delta("diskw." + v[2], numeric(v[9]) * 512)};
  }
  std::map<std::string, bool> devices;
  for (auto &line : lines(read_file("/proc/mounts"))) {
    auto v = words(line);
    if (v.size() < 3 || devices[v[0]] ||
        !(v[0].rfind("/dev/", 0) == 0 || v[1] == "/"))
      continue;
    struct statvfs stat{};
    if (statvfs(v[1].c_str(), &stat) || !stat.f_blocks)
      continue;
    devices[v[0]] = true;
    double total = double(stat.f_blocks) * stat.f_frsize,
           used = double(stat.f_blocks - stat.f_bfree) * stat.f_frsize;
    std::string name = v[0].substr(v[0].find_last_of('/') + 1);
    Json disk = Json::Object{{"device", name},
                             {"mount", v[1]},
                             {"type", v[2]},
                             {"total", total},
                             {"used", used},
                             {"readRate", io[name].first},
                             {"writeRate", io[name].second}};
    for (auto &old : data["disks"].array())
      if (old["device"].s() == name) {
        disk["readHistory"] = old["readHistory"];
        disk["writeHistory"] = old["writeHistory"];
      }
    history(disk["readHistory"], io[name].first);
    history(disk["writeHistory"], io[name].second);
    disks.push_back(disk);
    filesystems.push_back(
        Json::Object{{"mount", v[1]},
                     {"device", v[0]},
                     {"type", v[2]},
                     {"size", total},
                     {"used", used},
                     {"inodesUsed", double(stat.f_files - stat.f_ffree)},
                     {"inodesTotal", double(stat.f_files)}});
  }
  data["disks"] = disks;
  telemetry["filesystems"] = filesystems;
  auto file_nr = words(read_file("/proc/sys/fs/file-nr"));
  kernel["openFiles"] = file_nr.empty() ? 0 : numeric(file_nr[0]);
  kernel["entropy"] =
      numeric(read_file("/proc/sys/kernel/random/entropy_avail"));
  for (auto &line : lines(read_file("/proc/vmstat"))) {
    auto v = words(line);
    if (v.size() == 2 && v[0] == "pgpgin")
      kernel["pageIn"] = numeric(v[1]);
    if (v.size() == 2 && v[0] == "pgpgout")
      kernel["pageOut"] = numeric(v[1]);
  }
  Json::Array sessions;
  for (auto &line : lines(command({"who"}, cancel))) {
    auto v = words(line);
    if (v.size() < 4)
      continue;
    auto from = v.size() > 4 ? v.back() : "";
    if (from.size() > 1 && from.front() == '(' && from.back() == ')')
      from = from.substr(1, from.size() - 2);
    sessions.push_back(Json::Object{{"user", v[0]},
                                    {"tty", v[1]},
                                    {"from", from},
                                    {"loginAt", v[2] + " " + v[3]},
                                    {"idle", ""}});
  }
  telemetry["sessions"] = sessions;
  history(telemetry["sessionHistory"], double(sessions.size()));
  auto login_rows = [&](std::vector<std::string> args) {
    Json::Array rows;
    for (auto &line : lines(command(args, cancel))) {
      auto v = words(line);
      if (v.size() < 5 || v[0] == "reboot" || v[0] == "wtmp" || v[0] == "btmp")
        continue;
      std::string when;
      for (std::size_t i = 3; i < std::min(v.size(), std::size_t(8)); i++) {
        if (!when.empty())
          when += ' ';
        when += v[i];
      }
      rows.push_back(Json::Object{
          {"user", v[0]},
          {"tty", v[1]},
          {"from", v[2]},
          {"when", when},
          {"status", line.find("still") != line.npos ? "still" : "closed"}});
    }
    return rows;
  };
  telemetry["logins"] = login_rows({"last", "-n", "30", "-w"});
  telemetry["failedLogins"] = login_rows({"lastb", "-n", "20", "-w"});
  for (auto &row : telemetry["failedLogins"].array())
    row["status"] = "failed";
  Json::Array services;
  for (auto &line :
       lines(command({"systemctl", "list-units", "--type=service", "--all",
                      "--no-legend", "--no-pager", "--plain"},
                     cancel))) {
    auto v = words(line);
    if (v.size() < 4 || v[0].find(".service") == v[0].npos)
      continue;
    std::string desc;
    for (std::size_t i = 4; i < v.size(); i++) {
      if (!desc.empty())
        desc += ' ';
      desc += v[i];
    }
    services.push_back(Json::Object{{"name", v[0]},
                                    {"active", v[2]},
                                    {"sub", v[3]},
                                    {"description", desc}});
  }
  telemetry["services"] = services;
  Json::Array connections, listeners, protocols, remotes;
  std::map<std::string, int> protocol_counts, remote_counts;
  int inbound = 0, outbound = 0;
  for (auto &line : lines(command({"ss", "-H", "-tunap"}, cancel))) {
    auto v = words(line);
    if (v.size() < 6)
      continue;
    std::string proto = v[0], state = v[1], local = v[4], remote = v[5],
                process = v.size() > 6 ? v[6] : "";
    auto port = [](const std::string &a) {
      auto colon = a.find_last_of(':');
      return colon == a.npos ? 0 : int(numeric(a.substr(colon + 1)));
    };
    int lp = port(local), rp = port(remote);
    if (state == "LISTEN" || (state == "UNCONN" && rp == 0)) {
      listeners.push_back(Json::Object{{"proto", proto},
                                       {"port", lp},
                                       {"address", local},
                                       {"process", process}});
      continue;
    }
    connections.push_back(Json::Object{{"proto", proto},
                                       {"local", local},
                                       {"remote", remote},
                                       {"state", state},
                                       {"process", process}});
    int service = lp < rp ? lp : rp;
    std::string label = service == 22                       ? "SSH"
                        : service == 80 || service == 8080  ? "HTTP"
                        : service == 443 || service == 8443 ? "HTTPS"
                        : service == 53                     ? "DNS"
                        : service == 5432                   ? "Postgres"
                        : service == 6379                   ? "Redis"
                        : proto == "udp"                    ? "UDP"
                                                            : "TCP";
    protocol_counts[label]++;
    if (lp < rp)
      inbound++;
    else
      outbound++;
    auto colon = remote.find_last_of(':');
    remote_counts[remote.substr(0, colon)]++;
  }
  for (auto &v : protocol_counts)
    protocols.push_back(
        Json::Object{{"protocol", v.first}, {"total", v.second}});
  for (auto &v : remote_counts)
    remotes.push_back(Json::Object{
        {"host", v.first}, {"connections", v.second}, {"protocols", ""}});
  std::sort(remotes.begin(), remotes.end(), [](const Json &a, const Json &b) {
    return a["connections"].n() > b["connections"].n();
  });
  telemetry["connections"] = connections;
  telemetry["listeners"] = listeners;
  telemetry["protocols"] = protocols;
  telemetry["remotes"] = remotes;
  telemetry["inboundConnections"] = inbound;
  telemetry["outboundConnections"] = outbound;
  history(telemetry["connectionHistory"], double(connections.size()));
  auto snmp = lines(read_file("/proc/net/snmp"));
  std::map<std::string, double> netstats;
  for (std::size_t i = 0; i + 1 < snmp.size(); i += 2) {
    auto keys = words(snmp[i]), values = words(snmp[i + 1]);
    for (std::size_t k = 1; k < std::min(keys.size(), values.size()); k++)
      netstats[keys[0] + keys[k]] = numeric(values[k]);
  }
  auto &net = telemetry["net"], &rates = net["rates"];
  net["tcpEstablished"] = netstats["Tcp:CurrEstab"];
  net["tcpOutRsts"] = netstats["Tcp:OutRsts"];
  net["icmpInMsgs"] = netstats["Icmp:InMsgs"];
  net["icmpOutMsgs"] = netstats["Icmp:OutMsgs"];
  const char *in[] = {"Tcp:InSegs",      "Tcp:OutSegs",     "Tcp:PassiveOpens",
                      "Tcp:ActiveOpens", "Udp:InDatagrams", "Udp:OutDatagrams",
                      "Tcp:RetransSegs"},
             *out[] = {"inSegs", "outSegs", "passiveOpens", "activeOpens",
                       "udpIn",  "udpOut",  "retransSegs"};
  for (int i = 0; i < 7; i++)
    rates[out[i]] = delta(in[i], netstats[in[i]]);
  net["retransRatio"] = rates["outSegs"].n()
                            ? rates["retransSegs"].n() / rates["outSegs"].n()
                            : 0;
  history(telemetry["netInHistory"], rates["inSegs"].n());
  history(telemetry["netOutHistory"], rates["outSegs"].n());
  history(telemetry["retransHistory"], net["retransRatio"].n() * 100);
  Json::Array logs, ssh;
  for (auto &line : lines(
           command({"journalctl", "-n", "80", "--no-pager", "-o", "short-iso"},
                   cancel))) {
    auto v = words(line);
    if (v.size() < 4 || line.rfind("--", 0) == 0)
      continue;
    std::string time = v[0].size() >= 19 ? v[0].substr(11, 8) : v[0], message;
    for (std::size_t i = 3; i < v.size(); i++) {
      if (!message.empty())
        message += ' ';
      message += v[i];
    }
    logs.push_back(Json::Object{
        {"time", time},
        {"level", message.find("error") != message.npos ? "ERROR" : "INFO"},
        {"message", message},
        {"meta", v[2]}});
    if (v[2].find("sshd") != v[2].npos) {
      auto words_ = words(message);
      auto from = std::find(words_.begin(), words_.end(), "from"),
           user = std::find(words_.begin(), words_.end(), "for");
      std::string action = message.find("Accepted") != message.npos ? "accepted"
                           : message.find("Failed") != message.npos
                               ? "failed"
                               : "disconnect";
      ssh.push_back(Json::Object{
          {"time", time},
          {"action", action},
          {"user",
           user != words_.end() && user + 1 != words_.end() ? *(user + 1) : ""},
          {"from",
           from != words_.end() && from + 1 != words_.end() ? *(from + 1) : ""},
          {"method", words_.size() > 1 ? words_[1] : ""}});
    }
  }
  data["logs"] = logs;
  telemetry["ssh"] = ssh;

  // SSH is queried separately because it can be absent from the short general
  // journal tail. Parse both ISO and traditional syslog timestamps.
  ssh.clear();
  for (auto &line :
       lines(command({"journalctl", "-u", "ssh", "-u", "sshd", "-n", "100",
                      "--no-pager", "-o", "short-iso"},
                     cancel))) {
    auto marker = line.find("sshd[");
    if (marker == line.npos)
      continue;
    auto colon = line.find(": ", marker);
    if (colon == line.npos)
      continue;
    auto prefix = words(line.substr(0, marker)),
         tokens = words(line.substr(colon + 2));
    if (tokens.empty())
      continue;
    std::string time = prefix.empty()           ? ""
                       : prefix[0].size() >= 19 ? prefix[0].substr(11, 8)
                       : prefix.size() > 2      ? prefix[2]
                                                : "";
    std::string action =
        tokens[0] == "Accepted" ? "accepted"
        : tokens[0] == "Failed" ? "failed"
        : tokens[0] == "Disconnected" || tokens[0] == "Connection"
            ? "disconnect"
            : "";
    if (action.empty())
      continue;
    auto from = std::find(tokens.begin(), tokens.end(), "from"),
         user = std::find(tokens.begin(), tokens.end(), "for");
    std::string username, address;
    if (user != tokens.end() && user + 1 != tokens.end()) {
      auto i = user + 1;
      if (*i == "invalid" && tokens.end() - i > 2)
        i += 2;
      username = *i;
    }
    if (from != tokens.end() && from + 1 != tokens.end())
      address = *(from + 1);
    if (action == "disconnect") {
      auto u = std::find(tokens.begin(), tokens.end(), "user");
      if (u != tokens.end() && tokens.end() - u > 2) {
        username = *(u + 1);
        address = *(u + 2);
      }
    }
    ssh.push_back(Json::Object{{"time", time},
                               {"action", action},
                               {"user", username},
                               {"from", address},
                               {"method", tokens.size() > 1 ? tokens[1] : ""}});
  }
  telemetry["ssh"] = ssh;

  Json::Array gpus;
  for (auto &line :
       lines(command({"nvidia-smi",
                      "--query-gpu=name,utilization.gpu,memory.used,memory."
                      "total,temperature.gpu,power.draw",
                      "--format=csv,noheader,nounits"},
                     cancel))) {
    std::vector<std::string> fields;
    std::istringstream in(line);
    std::string field;
    while (std::getline(in, field, ','))
      fields.push_back(trim(field));
    if (fields.size() < 6)
      continue;
    auto numeric_or_null = [](const std::string &v) -> Json {
      char *end = nullptr;
      double n = std::strtod(v.c_str(), &end);
      return end != v.c_str() && *end == 0 && std::isfinite(n) ? Json(n)
                                                               : Json();
    };
    auto util = numeric_or_null(fields[1]), used = numeric_or_null(fields[2]),
         total = numeric_or_null(fields[3]), temp = numeric_or_null(fields[4]);
    gpus.push_back(Json::Object{
        {"name", fields[0]},
        {"utilization", util.null() ? Json() : Json(util.n() / 100)},
        {"memoryUsed", used.null() ? Json() : Json(used.n() * 1048576)},
        {"memoryTotal", total.null() ? Json() : Json(total.n() * 1048576)},
        {"temperature", temp}});
    sensors.push_back(
        Json::Object{{"label", fields[0]},
                     {"value", util.null() ? "—" : percent(util.n() / 100)}});
    if (!temp.null())
      temps.push_back(
          Json::Object{{"label", fields[0]}, {"value", temp}, {"max", 100}});
  }
  telemetry["gpus"] = gpus;
  data["sensors"] = sensors;
  data["temperatures"] = temps;
  telemetry["power"] = Json();
  bool ac = false;
  for (auto &device :
       std::filesystem::directory_iterator("/sys/class/power_supply", ec)) {
    auto path = device.path().string(),
         type = trim(read_file(path + "/type", 80));
    if (type == "Mains" || type == "USB" || type == "USB_C")
      ac = ac || numeric(read_file(path + "/online", 80)) == 1;
  }
  for (auto &device :
       std::filesystem::directory_iterator("/sys/class/power_supply", ec)) {
    auto path = device.path().string();
    if (trim(read_file(path + "/type", 80)) != "Battery")
      continue;
    auto capacity = trim(read_file(path + "/capacity", 80)),
         draw = trim(read_file(path + "/power_now", 80));
    Json watts = draw.empty() ? Json() : Json(numeric(draw) / 1e6);
    telemetry["power"] = Json::Object{
        {"battery", capacity.empty() ? Json() : Json(numeric(capacity))},
        {"acConnected", ac},
        {"timeRemaining", "—"},
        {"powerDraw", watts}};
    break;
  }
  Json::Array containers;
  for (auto &line :
       lines(command({"docker", "--host", "unix:///var/run/docker.sock", "ps",
                      "--format", "{{json .}}"},
                     cancel))) {
    try {
      auto container = Json::parse(line);
      containers.push_back(Json::Object{{"name", container["Names"]},
                                        {"image", container["Image"]},
                                        {"status", container["Status"]}});
    } catch (const std::exception &) {
    }
  }
  telemetry["containers"] = containers;

  // Access-log samples are bounded. The rate is explicitly described as an
  // estimate in the Traffic screen; a rotation/reset never produces a spike.
  Json http;
  for (auto path : {"/var/log/nginx/access.log", "/var/log/apache2/access.log",
                    "/var/log/httpd/access_log", "/var/log/caddy/access.log"}) {
    if (cancel && cancel->load())
      break;
    auto content = command({"tail", "-n", "300", "--", path}, cancel);
    if (content.empty())
      continue;
    Json::Array recent;
    std::map<std::string, int> classes, paths;
    int upgrades = 0, parsed = 0;
    for (auto &line : lines(content)) {
      if (line.size() > 16384)
        continue;
      std::string client, method, target, time;
      double status = 0, bytes = 0;
      if (!line.empty() && line[0] == '{') {
        try {
          auto record = Json::parse(line);
          client = record.path("request.remote_ip").s("");
          method = record.path("request.method").s("");
          target = record.path("request.uri").s("");
          status = record["status"].n();
          bytes = record["size"].n();
          time = record["ts"].s("");
        } catch (const std::exception &) {
          continue;
        }
      } else {
        auto quote = line.find('"'),
             end = quote == line.npos ? line.npos : line.find('"', quote + 1);
        if (end == line.npos)
          continue;
        auto request = words(line.substr(quote + 1, end - quote - 1)),
             result = words(line.substr(end + 1));
        if (request.size() < 2 || result.size() < 2)
          continue;
        auto begin = line.find('['), close = line.find(']', begin);
        auto fields = words(line.substr(0, quote));
        if (fields.empty())
          continue;
        client = fields[0];
        method = request[0];
        target = request[1];
        status = numeric(result[0]);
        bytes = numeric(result[1]);
        if (begin != line.npos && close != line.npos) {
          auto stamp = line.substr(begin + 1, close - begin - 1);
          auto colon = stamp.find(':');
          time = colon != stamp.npos ? stamp.substr(colon + 1, 8) : stamp;
        }
      }
      if (method.empty() || target.empty() || status < 100 || status > 599)
        continue;
      // Routes, not request secrets: never display query strings or fragments.
      target = target.substr(0, target.find_first_of("?#"));
      parsed++;
      upgrades += status == 101;
      classes[std::to_string(int(status) / 100) + "xx"]++;
      paths[target]++;
      recent.push_back(Json::Object{{"time", time},
                                    {"method", method},
                                    {"path", target},
                                    {"status", int(status)},
                                    {"client", client},
                                    {"bytes", bytes}});
    }
    if (!parsed)
      continue;
    Json::Array status_classes, top_paths;
    for (auto &item : classes)
      status_classes.push_back(
          Json::Object{{"class", item.first}, {"count", item.second}});
    for (auto &item : paths)
      top_paths.push_back(
          Json::Object{{"path", item.first}, {"count", item.second}});
    std::stable_sort(top_paths.begin(), top_paths.end(),
                     [](const Json &a, const Json &b) {
                       return a["count"].n() > b["count"].n();
                     });
    std::reverse(recent.begin(), recent.end());
    if (recent.size() > 50)
      recent.resize(50);
    auto size = std::filesystem::file_size(path, ec);
    double rps = ec ? 0
                    : delta(std::string("http:") + path, double(size)) /
                          std::max(1., double(content.size()) / parsed);
    http =
        Json::Object{{"source", path},        {"requestsPerSecond", rps},
                     {"upgrades", upgrades},  {"statusClasses", status_classes},
                     {"topPaths", top_paths}, {"recent", recent}};
    if (telemetry["http"]["source"].s("") == path)
      http["history"] = telemetry["http"]["history"];
    history(http["history"], rps);
    break;
  }
  telemetry["http"] = http;
  last = time;
#endif
}
} // namespace demo
