/** Everything the demo can observe beyond classic CPU/memory/disk monitoring. */

export interface Session {
  user: string;
  tty: string;
  from: string;
  loginAt: string;
  idle: string;
  what: string;
}

export interface LoginEvent {
  user: string;
  tty: string;
  from: string;
  when: string;
  status: "ok" | "failed" | "still";
}

export interface Connection {
  proto: string;
  local: string;
  remote: string;
  state: string;
  process: string;
}

export interface Listener {
  proto: string;
  address: string;
  port: string;
  process: string;
}

export interface ServiceUnit {
  name: string;
  active: string;
  sub: string;
  description: string;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  cpu: string;
  memory: string;
}

export interface Interface {
  name: string;
  ip: string;
  mac: string;
  state: string;
  mtu: number;
  rxRate: number;
  txRate: number;
  rxTotal: number;
  txTotal: number;
  rxHistory: number[];
  txHistory: number[];
  errors: number;
  drops: number;
}

export interface Filesystem {
  mount: string;
  device: string;
  type: string;
  size: number;
  used: number;
  inodesUsed: number;
  inodesTotal: number;
}

export interface KernelStats {
  contextSwitches: number;
  contextSwitchRate: number;
  interrupts: number;
  interruptRate: number;
  forks: number;
  forkRate: number;
  procsRunning: number;
  procsBlocked: number;
  entropy: number;
  openFiles: number;
  maxFiles: number;
  bootTime: number;
  pageIn: number;
  pageOut: number;
  swapIn: number;
  swapOut: number;
}

export interface GpuStats {
  name: string;
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
  temperature: number;
  power: number;
}

export interface PowerStats {
  battery: number;
  charging: boolean;
  timeRemaining: string;
  powerDraw: number;
  acConnected: boolean;
}

export interface JournalEntry {
  time: string;
  level: string;
  unit: string;
  message: string;
}

export interface ProcessStates {
  running: number;
  sleeping: number;
  stopped: number;
  zombie: number;
  total: number;
}

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

export interface SshEvent {
  time: string;
  action: "accepted" | "failed" | "invalid" | "disconnect";
  user: string;
  from: string;
  method: string;
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
  rates: {
    inSegs: number;
    outSegs: number;
    retrans: number;
    passiveOpens: number;
    activeOpens: number;
    udpIn: number;
    udpOut: number;
  };
  retransRatio: number;
}

export interface HttpStats {
  source: string;
  requestsPerSecond: number;
  total: number;
  statusClasses: { class: string; count: number }[];
  topPaths: { path: string; count: number }[];
  topClients: { client: string; count: number }[];
  methods: { method: string; count: number }[];
  upgrades: number;
  recent: { time: string; method: string; path: string; status: string; client: string; bytes: number }[];
  history: number[];
}

/** Optional telemetry: absent sections mean "this platform cannot see it". */
export interface Telemetry {
  sessions: Session[];
  logins: LoginEvent[];
  failedLogins: LoginEvent[];
  connections: Connection[];
  listeners: Listener[];
  services: ServiceUnit[];
  containers: Container[];
  interfaces: Interface[];
  filesystems: Filesystem[];
  kernel: KernelStats;
  gpus: GpuStats[];
  power: PowerStats | null;
  journal: JournalEntry[];
  states: ProcessStates;
  /** Connection counts by state, for the sparkline. */
  connectionHistory: number[];
  sessionHistory: number[];
  /** Live sockets grouped by protocol. */
  protocols: ProtocolBucket[];
  remotes: RemoteHost[];
  inboundConnections: number;
  outboundConnections: number;
  net: NetCounters;
  netInHistory: number[];
  netOutHistory: number[];
  retransHistory: number[];
  ssh: SshEvent[];
  http: HttpStats | null;
  /** True when the process can see privileged sources. */
  privileged: boolean;
}

export function emptyTelemetry(): Telemetry {
  return {
    sessions: [],
    logins: [],
    failedLogins: [],
    connections: [],
    listeners: [],
    services: [],
    containers: [],
    interfaces: [],
    filesystems: [],
    kernel: {
      contextSwitches: 0, contextSwitchRate: 0, interrupts: 0, interruptRate: 0,
      forks: 0, forkRate: 0, procsRunning: 0, procsBlocked: 0, entropy: 0,
      openFiles: 0, maxFiles: 0, bootTime: 0, pageIn: 0, pageOut: 0, swapIn: 0, swapOut: 0,
    },
    gpus: [],
    power: null,
    journal: [],
    states: { running: 0, sleeping: 0, stopped: 0, zombie: 0, total: 0 },
    connectionHistory: [],
    sessionHistory: [],
    protocols: [],
    remotes: [],
    inboundConnections: 0,
    outboundConnections: 0,
    net: {
      tcpActiveOpens: 0, tcpPassiveOpens: 0, tcpEstablished: 0, tcpInSegs: 0,
      tcpOutSegs: 0, tcpRetransSegs: 0, tcpInErrs: 0, tcpOutRsts: 0,
      udpInDatagrams: 0, udpOutDatagrams: 0, udpInErrors: 0,
      icmpInMsgs: 0, icmpOutMsgs: 0,
      rates: { inSegs: 0, outSegs: 0, retrans: 0, passiveOpens: 0, activeOpens: 0, udpIn: 0, udpOut: 0 },
      retransRatio: 0,
    },
    netInHistory: [],
    netOutHistory: [],
    retransHistory: [],
    ssh: [],
    http: null,
    privileged: typeof process.getuid === "function" ? process.getuid() === 0 : false,
  };
}
