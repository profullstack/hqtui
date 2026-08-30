import type { Telemetry } from "./telemetry.ts";

/**
 * Simulated telemetry so `--sim` populates every screen, and so CI snapshots
 * of the traffic and session views are deterministic.
 */

const USERS = ["anthony", "deploy", "ci", "root", "postgres"];
const HOSTS = ["10.0.4.17", "203.0.113.42", "198.51.100.9", "192.168.1.42", "172.16.0.8"];
const PATHS = ["/", "/api/health", "/api/users", "/assets/app.js", "/docs", "/api/ws", "/login", "/api/metrics"];
const AGENTS = ["nginx", "sshd", "systemd", "cron", "kernel", "dockerd"];
const UNITS = [
  ["nginx", "active", "running", "A high performance web server"],
  ["postgresql", "active", "running", "PostgreSQL RDBMS"],
  ["redis-server", "active", "running", "Advanced key-value store"],
  ["ssh", "active", "running", "OpenBSD Secure Shell server"],
  ["cron", "active", "running", "Regular background program processing"],
  ["docker", "active", "running", "Docker Application Container Engine"],
  ["systemd-resolved", "active", "running", "Network Name Resolution"],
  ["backup", "failed", "failed", "Nightly backup job"],
  ["telemetry-agent", "inactive", "dead", "Vendor telemetry collector"],
];
const PROTOCOLS = ["HTTPS", "HTTP", "SSH", "Postgres", "Redis", "DNS", "SMTP", "ephemeral"];

function push(history: number[], value: number, limit = 240): void {
  history.push(value);
  if (history.length > limit) history.shift();
}

function clock(offsetSeconds = 0): string {
  return new Date(Date.now() - offsetSeconds * 1000).toTimeString().slice(0, 8);
}

/** Fill in every telemetry section with plausible, drifting values. */
export function updateTelemetry(t: Telemetry, random: () => number, tick: number, cpu: number): void {
  // --- sessions -------------------------------------------------------------
  if (t.sessions.length === 0) {
    t.sessions = [
      { user: "anthony", tty: "pts/0", from: "10.0.4.17", loginAt: "09:14", idle: ".", what: "bun run dev" },
      { user: "deploy", tty: "pts/1", from: "203.0.113.42", loginAt: "11:02", idle: "00:04", what: "tail -f app.log" },
      { user: "anthony", tty: "pts/2", from: "10.0.4.17", loginAt: "11:40", idle: "00:12", what: "psql" },
    ];
    t.logins = Array.from({ length: 18 }, (_, i) => ({
      user: USERS[i % USERS.length],
      tty: `pts/${i % 4}`,
      from: HOSTS[i % HOSTS.length],
      when: `Aug ${20 + (i % 9)} ${String(7 + (i % 12)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}`,
      status: i < 3 ? "still" : "ok",
    }));
    t.failedLogins = Array.from({ length: 6 }, (_, i) => ({
      user: ["root", "admin", "test", "oracle", "ubuntu", "git"][i],
      tty: "ssh",
      from: `185.${100 + i}.${20 + i * 3}.${9 + i}`,
      when: `Aug 30 0${i}:${String((i * 11) % 60).padStart(2, "0")}`,
      status: "failed",
    }));
  }
  push(t.sessionHistory, t.sessions.length + (random() < 0.1 ? 1 : 0));

  // --- sockets and protocols ------------------------------------------------
  const connectionCount = Math.round(40 + cpu * 60 + random() * 15);
  t.protocols = PROTOCOLS.map((protocol, i) => {
    const weight = [0.42, 0.12, 0.06, 0.1, 0.07, 0.08, 0.03, 0.12][i];
    const total = Math.max(0, Math.round(connectionCount * weight * (0.7 + random() * 0.6)));
    const inbound = protocol === "HTTPS" || protocol === "HTTP" || protocol === "SSH"
      ? Math.round(total * 0.75)
      : Math.round(total * 0.15);
    return { protocol, inbound, outbound: total - inbound, total };
  }).sort((a, b) => b.total - a.total);

  t.inboundConnections = t.protocols.reduce((a, p) => a + p.inbound, 0);
  t.outboundConnections = t.protocols.reduce((a, p) => a + p.outbound, 0);
  push(t.connectionHistory, t.inboundConnections + t.outboundConnections);

  t.remotes = HOSTS.map((host, i) => ({
    host,
    connections: Math.max(1, Math.round((8 - i) * (0.6 + random()))),
    protocols: [PROTOCOLS[i % PROTOCOLS.length], PROTOCOLS[(i + 3) % PROTOCOLS.length]].join(", "),
  })).sort((a, b) => b.connections - a.connections);

  t.connections = t.remotes.slice(0, 12).map((remote, i) => ({
    proto: i % 5 === 0 ? "udp" : "tcp",
    local: `10.0.0.7:${40000 + i * 13}`,
    remote: `${remote.host}:${[443, 443, 22, 5432, 6379][i % 5]}`,
    state: "ESTAB",
    process: ["bun/1261", "node/8437", "sshd/1024", "postgres/2217", "redis/1555"][i % 5],
  }));

  t.listeners = [
    { proto: "tcp", address: "0.0.0.0", port: "443", process: "nginx/981" },
    { proto: "tcp", address: "0.0.0.0", port: "80", process: "nginx/981" },
    { proto: "tcp", address: "0.0.0.0", port: "22", process: "sshd/1024" },
    { proto: "tcp", address: "127.0.0.1", port: "5432", process: "postgres/2217" },
    { proto: "tcp", address: "127.0.0.1", port: "6379", process: "redis/1555" },
    { proto: "tcp", address: "0.0.0.0", port: "3000", process: "bun/1261" },
    { proto: "udp", address: "0.0.0.0", port: "53", process: "resolved/712" },
  ];

  // --- kernel network counters ---------------------------------------------
  const inSegs = 4000 + cpu * 12000 + random() * 2500;
  const outSegs = 3500 + cpu * 11000 + random() * 2200;
  const retrans = Math.max(0, outSegs * (0.001 + random() * 0.004));
  t.net.tcpInSegs += inSegs;
  t.net.tcpOutSegs += outSegs;
  t.net.tcpRetransSegs += retrans;
  t.net.tcpEstablished = t.inboundConnections + t.outboundConnections;
  t.net.tcpPassiveOpens += Math.round(random() * 12);
  t.net.tcpActiveOpens += Math.round(random() * 8);
  t.net.tcpOutRsts += Math.round(random() * 3);
  t.net.udpInDatagrams += Math.round(200 + random() * 400);
  t.net.udpOutDatagrams += Math.round(180 + random() * 350);
  t.net.icmpInMsgs += Math.round(random() * 2);
  t.net.icmpOutMsgs += Math.round(random() * 2);
  t.net.rates = {
    inSegs,
    outSegs,
    retrans,
    passiveOpens: random() * 12,
    activeOpens: random() * 8,
    udpIn: 200 + random() * 400,
    udpOut: 180 + random() * 350,
  };
  t.net.retransRatio = retrans / Math.max(1, outSegs);
  push(t.netInHistory, inSegs);
  push(t.netOutHistory, outSegs);
  push(t.retransHistory, retrans);

  // --- ssh ------------------------------------------------------------------
  if (t.ssh.length === 0 || (tick % 40 === 0 && random() < 0.7)) {
    const failed = random() < 0.45;
    t.ssh.push({
      time: clock(),
      action: failed ? (random() < 0.5 ? "failed" : "invalid") : "accepted",
      user: failed ? ["root", "admin", "test", "oracle"][Math.floor(random() * 4)] : USERS[Math.floor(random() * 3)],
      from: failed ? `185.${Math.floor(random() * 255)}.${Math.floor(random() * 255)}.${Math.floor(random() * 255)}` : HOSTS[Math.floor(random() * 3)],
      method: failed ? "password" : "publickey",
    });
    if (t.ssh.length > 40) t.ssh.shift();
  }

  // --- http -----------------------------------------------------------------
  const requestsPerSecond = 18 + cpu * 90 + random() * 25;
  if (!t.http) {
    t.http = {
      source: "/var/log/nginx/access.log",
      requestsPerSecond,
      total: 0,
      statusClasses: [],
      topPaths: [],
      topClients: [],
      methods: [],
      upgrades: 0,
      recent: [],
      history: [],
    };
  }
  const http = t.http;
  http.requestsPerSecond = requestsPerSecond;
  http.total += Math.round(requestsPerSecond);
  push(http.history, requestsPerSecond);
  http.upgrades += random() < 0.15 ? 1 : 0;
  http.statusClasses = [
    { class: "2xx", count: Math.round(http.total * 0.86) },
    { class: "3xx", count: Math.round(http.total * 0.06) },
    { class: "4xx", count: Math.round(http.total * 0.06) },
    { class: "5xx", count: Math.round(http.total * 0.015) },
    { class: "1xx", count: http.upgrades },
  ];
  http.topPaths = PATHS.map((path, i) => ({
    path,
    count: Math.round(http.total * [0.3, 0.18, 0.14, 0.12, 0.09, 0.07, 0.06, 0.04][i]),
  }));
  http.topClients = HOSTS.map((client, i) => ({ client, count: Math.round(http.total * (0.3 - i * 0.05)) }));
  http.methods = [
    { method: "GET", count: Math.round(http.total * 0.78) },
    { method: "POST", count: Math.round(http.total * 0.16) },
    { method: "PUT", count: Math.round(http.total * 0.04) },
    { method: "DELETE", count: Math.round(http.total * 0.02) },
  ];
  if (tick % 3 === 0) {
    const roll = random();
    http.recent.unshift({
      time: clock(),
      method: roll < 0.8 ? "GET" : roll < 0.95 ? "POST" : "DELETE",
      path: PATHS[Math.floor(random() * PATHS.length)],
      status: roll < 0.86 ? "200" : roll < 0.92 ? "304" : roll < 0.98 ? "404" : "500",
      client: HOSTS[Math.floor(random() * HOSTS.length)],
      bytes: Math.round(200 + random() * 24000),
    });
    if (http.recent.length > 40) http.recent.pop();
  }

  // --- services, containers, filesystems ------------------------------------
  if (t.services.length === 0) {
    t.services = UNITS.map(([name, active, sub, description]) => ({ name, active, sub, description }));
    t.containers = [
      { id: "9f2c1a4b7e33", name: "api", image: "hqtui/api:1.4.2", status: "Up 2 hours", cpu: "12.4%", memory: "184 MiB" },
      { id: "3ab7f0912cd5", name: "worker", image: "hqtui/worker:1.4.2", status: "Up 2 hours", cpu: "6.1%", memory: "96 MiB" },
      { id: "77e10cc4a9b2", name: "postgres", image: "postgres:16", status: "Up 5 days", cpu: "3.8%", memory: "412 MiB" },
      { id: "1cd8e5b60f47", name: "redis", image: "redis:7-alpine", status: "Up 5 days", cpu: "0.7%", memory: "34 MiB" },
    ];
    t.filesystems = [
      { mount: "/", device: "/dev/nvme0n1p2", type: "ext4", size: 512 * 1024 ** 3, used: 136 * 1024 ** 3, inodesUsed: 1_240_000, inodesTotal: 32_000_000 },
      { mount: "/home", device: "/dev/nvme0n1p3", type: "ext4", size: 980 * 1024 ** 3, used: 622 * 1024 ** 3, inodesUsed: 4_100_000, inodesTotal: 61_000_000 },
      { mount: "/data", device: "/dev/sda1", type: "xfs", size: 2 * 1024 ** 4, used: 1.02 * 1024 ** 4, inodesUsed: 812_000, inodesTotal: 210_000_000 },
      { mount: "/boot", device: "/dev/nvme0n1p1", type: "vfat", size: 512 * 1024 ** 2, used: 148 * 1024 ** 2, inodesUsed: 0, inodesTotal: 0 },
    ];
    t.gpus = [{
      name: "NVIDIA RTX A2000", utilization: 0.34, memoryUsed: 2.1 * 1024 ** 3,
      memoryTotal: 6 * 1024 ** 3, temperature: 52, power: 34.5,
    }];
    t.power = { battery: 96, charging: false, timeRemaining: "Full", powerDraw: 14.2, acConnected: true };
  }
  t.gpus[0].utilization = Math.max(0.02, Math.min(1, cpu * 0.8 + random() * 0.2));
  t.gpus[0].temperature = 44 + t.gpus[0].utilization * 26;
  if (t.power) t.power.powerDraw = 8 + cpu * 22;

  // --- kernel counters ------------------------------------------------------
  t.kernel.contextSwitchRate = 3000 + cpu * 18000 + random() * 1500;
  t.kernel.interruptRate = 2000 + cpu * 9000 + random() * 900;
  t.kernel.forkRate = 4 + cpu * 60 + random() * 8;
  t.kernel.contextSwitches += t.kernel.contextSwitchRate / 10;
  t.kernel.interrupts += t.kernel.interruptRate / 10;
  t.kernel.forks += t.kernel.forkRate / 10;
  t.kernel.procsRunning = Math.max(1, Math.round(cpu * 14));
  t.kernel.procsBlocked = random() < 0.15 ? 1 : 0;
  t.kernel.entropy = Math.round(3000 + random() * 800);
  t.kernel.openFiles = Math.round(2000 + cpu * 3000);
  t.kernel.maxFiles = 9_223_372;
  t.kernel.pageIn += Math.round(random() * 400);
  t.kernel.pageOut += Math.round(random() * 300);

  t.states = {
    running: t.kernel.procsRunning,
    sleeping: 240 + Math.round(random() * 20),
    stopped: 0,
    zombie: random() < 0.08 ? 1 : 0,
    total: 0,
  };
  t.states.total = t.states.running + t.states.sleeping + t.states.stopped + t.states.zombie;

  // --- interfaces -----------------------------------------------------------
  if (t.interfaces.length === 0) {
    t.interfaces = [
      { name: "eth0", ip: "10.0.0.7", mac: "ac:de:48:00:11:22", state: "up", mtu: 1500, rxRate: 0, txRate: 0, rxTotal: 0, txTotal: 0, rxHistory: [], txHistory: [], errors: 0, drops: 0 },
      { name: "wg0", ip: "100.84.2.19", mac: "00:00:00:00:00:00", state: "up", mtu: 1280, rxRate: 0, txRate: 0, rxTotal: 0, txTotal: 0, rxHistory: [], txHistory: [], errors: 0, drops: 0 },
    ];
  }
  t.interfaces.forEach((iface, i) => {
    const scale = i === 0 ? 1 : 0.25;
    iface.rxRate = Math.max(0, (6e6 + Math.sin(tick / 30 + i) * 3e6 + random() * 4e6) * scale);
    iface.txRate = Math.max(0, (1.8e6 + Math.sin(tick / 20 + i) * 1e6 + random() * 1.5e6) * scale);
    iface.rxTotal += iface.rxRate / 10;
    iface.txTotal += iface.txRate / 10;
    push(iface.rxHistory, iface.rxRate);
    push(iface.txHistory, iface.txRate);
  });

  // --- journal --------------------------------------------------------------
  if (tick % 8 === 0) {
    const level = random() < 0.06 ? "ERROR" : random() < 0.16 ? "WARN" : random() < 0.3 ? "DEBUG" : "INFO";
    const unit = AGENTS[Math.floor(random() * AGENTS.length)];
    const messages: Record<string, string[]> = {
      nginx: ["client closed connection while waiting for request", `${Math.round(random() * 400)} requests served`, "upstream timed out"],
      sshd: ["Accepted publickey for anthony", "Connection closed by authenticating user root", "Received disconnect"],
      systemd: ["Started Daily apt download activities", "Reloading nginx configuration", "Reached target Timers"],
      cron: ["(anthony) CMD (run-parts /etc/cron.hourly)", "pam_unix(cron:session): session opened"],
      kernel: ["TCP: request_sock_TCP: Possible SYN flooding", "EXT4-fs: mounted filesystem with ordered data mode"],
      dockerd: ["container start", "health check passed", "image pull complete"],
    };
    const pool = messages[unit] ?? ["event"];
    t.journal.push({
      time: clock(),
      level,
      unit,
      message: pool[Math.floor(random() * pool.length)],
    });
    if (t.journal.length > 200) t.journal.shift();
  }
}
