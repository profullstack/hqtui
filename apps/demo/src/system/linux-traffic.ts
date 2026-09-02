import { readFile, stat } from "node:fs/promises";
import { sh, tailFile } from "./common.ts";

/**
 * Protocol-level visibility without root: socket classification, kernel
 * TCP/UDP counters, sshd auth events from the journal, and HTTP access logs.
 * Packet inspection would need privileges; none of this does.
 */

async function read(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

const PORT_PROTOCOLS: Record<string, string> = {
  "20": "FTP", "21": "FTP", "22": "SSH", "23": "Telnet", "25": "SMTP",
  "53": "DNS", "67": "DHCP", "68": "DHCP", "80": "HTTP", "110": "POP3",
  "111": "RPC", "123": "NTP", "143": "IMAP", "161": "SNMP", "389": "LDAP",
  "443": "HTTPS", "445": "SMB", "465": "SMTPS", "514": "Syslog", "587": "SMTP",
  "631": "IPP", "636": "LDAPS", "993": "IMAPS", "995": "POP3S",
  "1194": "OpenVPN", "1433": "MSSQL", "1521": "Oracle", "2049": "NFS",
  "2379": "etcd", "3000": "HTTP-dev", "3306": "MySQL", "3389": "RDP",
  "4000": "HTTP-dev", "5000": "HTTP-dev", "5432": "Postgres", "5672": "AMQP",
  "5900": "VNC", "6379": "Redis", "8000": "HTTP-alt", "8080": "HTTP-alt",
  "8443": "HTTPS-alt", "9000": "HTTP-alt", "9090": "Prometheus",
  "9200": "Elasticsearch", "11211": "Memcached", "27017": "MongoDB",
  "41641": "Tailscale", "51820": "WireGuard",
};

export interface ProtocolBucket {
  protocol: string;
  inbound: number;
  outbound: number;
  total: number;
}

export interface RemoteHost {
  host: string;
  connections: number;
  protocols: string;
}

function portOf(address: string): string {
  const index = address.lastIndexOf(":");
  return index === -1 ? "" : address.slice(index + 1);
}

function hostOf(address: string): string {
  const index = address.lastIndexOf(":");
  return index === -1 ? address : address.slice(0, index);
}

export function classify(port: string): string {
  return PORT_PROTOCOLS[port] ?? (Number(port) >= 32768 ? "ephemeral" : `port ${port}`);
}

export interface SocketBreakdown {
  protocols: ProtocolBucket[];
  remotes: RemoteHost[];
  inbound: number;
  outbound: number;
}

/**
 * Split live sockets by protocol. A connection whose *local* port is a known
 * service is inbound; otherwise the remote port names the service we called.
 */
export function breakdown(
  connections: { local: string; remote: string; proto: string }[],
  listeners: { port: string }[],
): SocketBreakdown {
  const listening = new Set(listeners.map((l) => l.port));
  const buckets = new Map<string, ProtocolBucket>();
  const remotes = new Map<string, { count: number; protocols: Set<string> }>();
  let inbound = 0;
  let outbound = 0;

  for (const connection of connections) {
    const localPort = portOf(connection.local);
    const remotePort = portOf(connection.remote);
    const isInbound = listening.has(localPort);
    const protocol = classify(isInbound ? localPort : remotePort);

    const bucket = buckets.get(protocol) ?? { protocol, inbound: 0, outbound: 0, total: 0 };
    if (isInbound) {
      bucket.inbound++;
      inbound++;
    } else {
      bucket.outbound++;
      outbound++;
    }
    bucket.total++;
    buckets.set(protocol, bucket);

    const host = hostOf(connection.remote);
    if (host && host !== "*" && host !== "0.0.0.0") {
      const entry = remotes.get(host) ?? { count: 0, protocols: new Set<string>() };
      entry.count++;
      entry.protocols.add(protocol);
      remotes.set(host, entry);
    }
  }

  return {
    protocols: [...buckets.values()].sort((a, b) => b.total - a.total),
    remotes: [...remotes.entries()]
      .map(([host, entry]) => ({
        host,
        connections: entry.count,
        protocols: [...entry.protocols].slice(0, 3).join(", "),
      }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, 12),
    inbound,
    outbound,
  };
}

export interface NetCounters {
  tcpActiveOpens: number;
  tcpPassiveOpens: number;
  tcpEstablished: number;
  tcpInSegs: number;
  tcpOutSegs: number;
  tcpRetransSegs: number;
  tcpInErrs: number;
  tcpOutRsts: number;
  udpInDatagrams: number;
  udpOutDatagrams: number;
  udpInErrors: number;
  icmpInMsgs: number;
  icmpOutMsgs: number;
  /** Per-second rates, computed between refreshes. */
  rates: {
    inSegs: number;
    outSegs: number;
    retrans: number;
    passiveOpens: number;
    activeOpens: number;
    udpIn: number;
    udpOut: number;
  };
  /** Retransmits as a share of outbound segments. */
  retransRatio: number;
}

function parseSnmp(text: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const lines = text.trim().split("\n");
  for (let i = 0; i < lines.length - 1; i += 2) {
    const [headerName, ...headers] = lines[i].split(/\s+/);
    const [valueName, ...values] = lines[i + 1].split(/\s+/);
    if (headerName !== valueName) continue;
    const section = headerName.replace(":", "");
    out[section] = {};
    headers.forEach((key, index) => {
      out[section][key] = Number(values[index] ?? 0);
    });
  }
  return out;
}

let previousCounters: { values: NetCounters; at: number } | null = null;

/** TCP/UDP/ICMP counters from /proc/net/snmp, with rates. */
export async function counters(): Promise<NetCounters> {
  const snmp = parseSnmp(await read("/proc/net/snmp"));
  const tcp = snmp.Tcp ?? {};
  const udp = snmp.Udp ?? {};
  const icmp = snmp.Icmp ?? {};

  const values: NetCounters = {
    tcpActiveOpens: tcp.ActiveOpens ?? 0,
    tcpPassiveOpens: tcp.PassiveOpens ?? 0,
    tcpEstablished: tcp.CurrEstab ?? 0,
    tcpInSegs: tcp.InSegs ?? 0,
    tcpOutSegs: tcp.OutSegs ?? 0,
    tcpRetransSegs: tcp.RetransSegs ?? 0,
    tcpInErrs: tcp.InErrs ?? 0,
    tcpOutRsts: tcp.OutRsts ?? 0,
    udpInDatagrams: udp.InDatagrams ?? 0,
    udpOutDatagrams: udp.OutDatagrams ?? 0,
    udpInErrors: udp.InErrors ?? 0,
    icmpInMsgs: icmp.InMsgs ?? 0,
    icmpOutMsgs: icmp.OutMsgs ?? 0,
    rates: { inSegs: 0, outSegs: 0, retrans: 0, passiveOpens: 0, activeOpens: 0, udpIn: 0, udpOut: 0 },
    retransRatio: 0,
  };

  const now = Date.now();
  if (previousCounters) {
    const dt = Math.max(0.001, (now - previousCounters.at) / 1000);
    const previous = previousCounters.values;
    const delta = (a: number, b: number) => Math.max(0, (a - b) / dt);
    values.rates = {
      inSegs: delta(values.tcpInSegs, previous.tcpInSegs),
      outSegs: delta(values.tcpOutSegs, previous.tcpOutSegs),
      retrans: delta(values.tcpRetransSegs, previous.tcpRetransSegs),
      passiveOpens: delta(values.tcpPassiveOpens, previous.tcpPassiveOpens),
      activeOpens: delta(values.tcpActiveOpens, previous.tcpActiveOpens),
      udpIn: delta(values.udpInDatagrams, previous.udpInDatagrams),
      udpOut: delta(values.udpOutDatagrams, previous.udpOutDatagrams),
    };
  }
  previousCounters = { values, at: now };
  values.retransRatio = values.tcpOutSegs > 0 ? values.tcpRetransSegs / values.tcpOutSegs : 0;
  return values;
}

export interface SshEvent {
  time: string;
  action: "accepted" | "failed" | "invalid" | "disconnect";
  user: string;
  from: string;
  method: string;
}

/** sshd authentication events, straight out of the journal. */
export async function sshEvents(limit = 40): Promise<SshEvent[]> {
  const text = await sh("journalctl", [
    "-u", "ssh", "-u", "sshd", "-n", String(limit * 2), "--no-pager", "--output=short-iso",
  ], 5000);
  // Tailed, not read whole: this file grows without bound under a brute force.
  const source = text || (await tailFile("/var/log/auth.log"));
  if (!source) return [];

  const events: SshEvent[] = [];
  for (const line of source.trim().split("\n")) {
    if (!/sshd/.test(line)) continue;
    const time = (/T(\d{2}:\d{2}:\d{2})/.exec(line)?.[1]) ?? (/(\d{2}:\d{2}:\d{2})/.exec(line)?.[1]) ?? "";

    let match = /Accepted (\S+) for (\S+) from (\S+)/.exec(line);
    if (match) {
      events.push({ time, action: "accepted", user: match[2], from: match[3], method: match[1] });
      continue;
    }
    match = /Failed (\S+) for (?:invalid user )?(\S+) from (\S+)/.exec(line);
    if (match) {
      events.push({
        time,
        action: /invalid user/.test(line) ? "invalid" : "failed",
        user: match[2],
        from: match[3],
        method: match[1],
      });
      continue;
    }
    match = /Disconnected from (?:authenticating )?user (\S+) (\S+)/.exec(line);
    if (match) {
      events.push({ time, action: "disconnect", user: match[1], from: match[2], method: "-" });
    }
  }
  return events.slice(-limit);
}

export interface HttpStats {
  /** Which log file these came from. */
  source: string;
  requestsPerSecond: number;
  total: number;
  statusClasses: { class: string; count: number }[];
  topPaths: { path: string; count: number }[];
  topClients: { client: string; count: number }[];
  methods: { method: string; count: number }[];
  /** HTTP 101 responses: WebSocket and other protocol upgrades. */
  upgrades: number;
  recent: { time: string; method: string; path: string; status: string; client: string; bytes: number }[];
  history: number[];
}

const ACCESS_LOGS = [
  "/var/log/nginx/access.log",
  "/var/log/apache2/access.log",
  "/var/log/httpd/access_log",
  "/var/log/caddy/access.log",
];

const COMBINED =
  /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) (\d+|-)/;

let previousLog: { path: string; size: number; at: number } | null = null;
const requestHistory: number[] = [];

/** Parse the tail of an HTTP access log into live request statistics. */
export async function http(tailBytes = 256 * 1024): Promise<HttpStats | null> {
  let path = "";
  let size = 0;
  for (const candidate of ACCESS_LOGS) {
    try {
      const info = await stat(candidate);
      if (info.size > 0) {
        path = candidate;
        size = info.size;
        break;
      }
    } catch {
      // Not present, or not readable by this user.
    }
  }
  if (!path) return null;

  // Shares `tailFile`'s handling of a rotation between the stat and the read,
  // which otherwise leaves the tail of the buffer as NUL bytes — and those flow
  // into `split("\n")` and into the request-rate denominator below.
  const text = await tailFile(path, tailBytes);
  if (!text) return null;

  const lines = text.split("\n").slice(1).filter(Boolean);
  const statusClasses = new Map<string, number>();
  const paths = new Map<string, number>();
  const clients = new Map<string, number>();
  const methods = new Map<string, number>();
  const recent: HttpStats["recent"] = [];
  let upgrades = 0;

  for (const line of lines) {
    const match = COMBINED.exec(line);
    if (!match) continue;
    const [, client, stamp, method, requestPath, status, sizeField] = match;
    const cls = `${status[0]}xx`;
    statusClasses.set(cls, (statusClasses.get(cls) ?? 0) + 1);
    // Query strings explode the cardinality; group by path.
    const bare = requestPath.split("?")[0].slice(0, 60);
    paths.set(bare, (paths.get(bare) ?? 0) + 1);
    clients.set(client, (clients.get(client) ?? 0) + 1);
    methods.set(method, (methods.get(method) ?? 0) + 1);
    if (status === "101") upgrades++;
    recent.push({
      time: (/:(\d{2}:\d{2}:\d{2})/.exec(stamp)?.[1]) ?? "",
      method,
      path: bare,
      status,
      client,
      bytes: Number(sizeField) || 0,
    });
  }

  // Requests per second from how much the file grew since the last read.
  let requestsPerSecond = 0;
  const now = Date.now();
  if (previousLog && previousLog.path === path && size > previousLog.size) {
    const grew = size - previousLog.size;
    const averageLine = text.length / Math.max(1, lines.length);
    const seconds = Math.max(0.001, (now - previousLog.at) / 1000);
    requestsPerSecond = grew / Math.max(1, averageLine) / seconds;
  }
  previousLog = { path, size, at: now };
  requestHistory.push(requestsPerSecond);
  if (requestHistory.length > 240) requestHistory.shift();

  const top = (map: Map<string, number>, n: number) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  return {
    source: path,
    requestsPerSecond,
    total: lines.length,
    statusClasses: top(statusClasses, 6).map(([cls, count]) => ({ class: cls, count })),
    topPaths: top(paths, 10).map(([p, count]) => ({ path: p, count })),
    topClients: top(clients, 8).map(([client, count]) => ({ client, count })),
    methods: top(methods, 6).map(([method, count]) => ({ method, count })),
    upgrades,
    recent: recent.slice(-40).reverse(),
    history: [...requestHistory],
  };
}
