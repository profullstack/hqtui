/**
 * A deterministic fake system. Same seed, same sequence — which is what makes
 * benchmarks and CI snapshots reproducible.
 */

export interface SimulationOptions {
  seed?: number;
  /** Number of CPU cores to simulate. */
  cores?: number;
  /** Samples of history to retain per series. */
  history?: number;
}

export interface ProcessSample {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  rss: number;
  threads: number;
  user: string;
  command: string;
  state: string;
}

import { type Telemetry, emptyTelemetry } from "./system/telemetry.ts";
import { updateTelemetry } from "./system/simulated-telemetry.ts";

export type { Telemetry };

export interface SystemSample {
  time: number;
  /** Everything beyond classic CPU/memory/disk monitoring. */
  telemetry: Telemetry;
  cpu: {
    total: number;
    cores: number[];
    history: number[];
    load: [number, number, number];
    model: string;
    frequencyGhz: number;
  };
  memory: {
    total: number;
    used: number;
    available: number;
    cached: number;
    buffers: number;
    free: number;
    history: number[];
    swapTotal: number;
    swapUsed: number;
  };
  disks: {
    device: string;
    mount: string;
    type: string;
    total: number;
    used: number;
    readRate: number;
    writeRate: number;
    readHistory: number[];
    writeHistory: number[];
    iops: [number, number];
    temperature: number;
  }[];
  network: {
    interface: string;
    speed: string;
    ip: string;
    mac: string;
    downRate: number;
    upRate: number;
    downHistory: number[];
    upHistory: number[];
    downTotal: number;
    upTotal: number;
    downPeak: number;
    upPeak: number;
  };
  processes: ProcessSample[];
  temperatures: { label: string; value: number; max: number }[];
  sensors: { label: string; value: string }[];
  system: {
    os: string;
    kernel: string;
    hostname: string;
    shell: string;
    terminal: string;
    uptime: number;
    processCount: number;
    threadCount: number;
    contextSwitches: number;
  };
  logs: { time: string; level: string; message: string; meta: string }[];
}

/** Mulberry32: tiny, fast, and good enough for smooth-looking fake data. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROCESS_NAMES: [string, string, string][] = [
  ["bun", "dev", "bun server.ts"],
  ["node", "dev", "node index.js"],
  ["postgres", "postgres", "postgres -D /var/lib/postgresql/data"],
  ["redis-server", "redis", "redis-server *:6379"],
  ["docker", "root", "dockerd -H unix:///var/run/docker.sock"],
  ["nginx", "www-data", "nginx: worker process"],
  ["python", "dev", "python worker.py"],
  ["systemd", "root", "/sbin/init"],
  ["chrome", "dev", "chrome --type=renderer"],
  ["code", "dev", "code --unity-launch"],
  ["ssh", "dev", "ssh deploy@prod"],
  ["rustc", "dev", "rustc --edition 2021 src/main.rs"],
];

const LOG_TEMPLATES: [string, string, string][] = [
  ["INFO", "Server started on http://localhost:3000", "service: api"],
  ["INFO", "Database connection established", "service: db"],
  ["WARN", "Cache miss for key: user:48231", "service: cache"],
  ["INFO", "Background job \"cleanup\" completed in 120ms", "service: job"],
  ["ERROR", "Failed to fetch user profile", "service: api"],
  ["WARN", "Retrying in 2 seconds (attempt 2/3)", "service: api"],
  ["INFO", "New websocket connection", "service: ws"],
  ["INFO", "User authenticated successfully", "service: auth"],
  ["DEBUG", "Response time: 142ms", "service: api"],
  ["INFO", "Migration 0042_add_index applied", "service: db"],
];

function push(history: number[], value: number, limit: number): void {
  history.push(value);
  if (history.length > limit) history.shift();
}

/**
 * Drives a plausible-looking machine: correlated cores, memory drift, network
 * bursts, temperatures that lag CPU load, and process churn.
 */
export class SystemSimulation {
  private random: () => number;
  private tick = 0;
  private historyLimit: number;
  private state: SystemSample;
  private phase: number[];

  constructor(options: SimulationOptions = {}) {
    this.random = makeRandom(options.seed ?? 1337);
    this.historyLimit = options.history ?? 240;
    const cores = options.cores ?? 12;
    this.phase = Array.from({ length: cores }, () => this.random() * Math.PI * 2);

    const totalMemory = 16 * 1024 ** 3;
    this.state = {
      time: 0,
      telemetry: emptyTelemetry(),
      cpu: {
        total: 0.18,
        cores: new Array(cores).fill(0.15),
        history: [],
        load: [0.74, 0.62, 0.58],
        model: "Intel(R) Core(TM) i7-1260P 12th Gen",
        frequencyGhz: 2.1,
      },
      memory: {
        total: totalMemory,
        used: totalMemory * 0.42,
        available: totalMemory * 0.58,
        cached: totalMemory * 0.25,
        buffers: totalMemory * 0.07,
        free: totalMemory * 0.33,
        history: [],
        swapTotal: 2 * 1024 ** 3,
        swapUsed: 1.24 * 1024 ** 3,
      },
      disks: [
        {
          device: "nvme0n1", mount: "/", type: "SSD",
          total: 512 * 1024 ** 3, used: 136 * 1024 ** 3,
          readRate: 0, writeRate: 0, readHistory: [], writeHistory: [],
          iops: [2100, 1300], temperature: 43,
        },
        {
          device: "sda1", mount: "/data", type: "HDD",
          total: 2 * 1024 ** 4, used: 1.02 * 1024 ** 4,
          readRate: 0, writeRate: 0, readHistory: [], writeHistory: [],
          iops: [180, 90], temperature: 38,
        },
      ],
      network: {
        interface: "en0", speed: "1 Gb/s", ip: "192.168.1.42", mac: "ac:de:48:00:11:22",
        downRate: 0, upRate: 0, downHistory: [], upHistory: [],
        downTotal: 12.6 * 1024 ** 3, upTotal: 3.2 * 1024 ** 3,
        downPeak: 0, upPeak: 0,
      },
      processes: [],
      temperatures: [],
      sensors: [],
      system: {
        os: "Ubuntu 24.04 LTS",
        kernel: "6.8.0-31-generic",
        hostname: "devbox",
        shell: "bash 5.2.21",
        terminal: "hqtui",
        uptime: 9254,
        processCount: 243,
        threadCount: 981,
        contextSwitches: 52100,
      },
      logs: [],
    };

    // Seed history so the first frame is already a real graph, not a flat line.
    for (let i = 0; i < this.historyLimit; i++) this.update(0.1);
  }

  get cores(): number {
    return this.state.cpu.cores.length;
  }

  /** Advance the simulation by `dt` seconds. */
  update(dt = 0.1): SystemSample {
    this.tick++;
    const t = this.tick * dt;
    const s = this.state;
    s.time = t;

    // CPU: a slow wave, a fast wave, occasional spikes, per-core jitter.
    const wave = 0.28 + Math.sin(t / 7) * 0.12 + Math.sin(t / 1.7) * 0.05;
    const spike = this.random() < 0.02 ? this.random() * 0.5 : 0;
    let coreSum = 0;
    s.cpu.cores = s.cpu.cores.map((prev, i) => {
      const target = Math.max(0.02, Math.min(1, wave + Math.sin(t / 3 + this.phase[i]) * 0.18 + spike + (this.random() - 0.5) * 0.1));
      const next = prev + (target - prev) * 0.35;
      coreSum += next;
      return next;
    });
    s.cpu.total = coreSum / s.cpu.cores.length;
    push(s.cpu.history, s.cpu.total * 100, this.historyLimit);
    s.cpu.load = [
      s.cpu.load[0] + (s.cpu.total * 4 - s.cpu.load[0]) * 0.02,
      s.cpu.load[1] + (s.cpu.load[0] - s.cpu.load[1]) * 0.01,
      s.cpu.load[2] + (s.cpu.load[1] - s.cpu.load[2]) * 0.005,
    ];
    s.cpu.frequencyGhz = 1.6 + s.cpu.total * 2.4;

    // Memory drifts slowly and follows CPU a little.
    const memTarget = s.memory.total * (0.38 + s.cpu.total * 0.12 + Math.sin(t / 23) * 0.03);
    s.memory.used += (memTarget - s.memory.used) * 0.05;
    s.memory.cached = s.memory.total * (0.24 + Math.sin(t / 31) * 0.02);
    s.memory.buffers = s.memory.total * 0.07;
    s.memory.available = s.memory.total - s.memory.used;
    s.memory.free = s.memory.total - s.memory.used - s.memory.cached - s.memory.buffers;
    push(s.memory.history, (s.memory.used / s.memory.total) * 100, this.historyLimit);
    s.memory.swapUsed = Math.max(0, s.memory.swapUsed + (this.random() - 0.5) * 1024 ** 2);

    // Disks: bursty reads and writes.
    for (const disk of s.disks) {
      const burst = this.random() < 0.08 ? this.random() * 80e6 : 0;
      const base = disk.type === "SSD" ? 24e6 : 3e6;
      disk.readRate = Math.max(0, base * (0.5 + this.random()) + burst);
      disk.writeRate = Math.max(0, base * 0.6 * (0.4 + this.random()) + burst * 0.4);
      push(disk.readHistory, disk.readRate, this.historyLimit);
      push(disk.writeHistory, disk.writeRate, this.historyLimit);
      disk.used = Math.min(disk.total, disk.used + disk.writeRate * dt * 0.001);
      disk.iops = [
        Math.round(disk.readRate / 12000),
        Math.round(disk.writeRate / 14000),
      ];
      disk.temperature = 36 + (disk.type === "SSD" ? 8 : 2) + s.cpu.total * 6 + this.random();
    }

    // Network: correlated bursts, download heavier than upload.
    const burst = this.random() < 0.05 ? this.random() * 60e6 : 0;
    s.network.downRate = Math.max(0, 6e6 + Math.sin(t / 4) * 3e6 + this.random() * 4e6 + burst);
    s.network.upRate = Math.max(0, 1.6e6 + Math.sin(t / 6) * 1e6 + this.random() * 1.5e6 + burst * 0.3);
    push(s.network.downHistory, s.network.downRate, this.historyLimit);
    push(s.network.upHistory, s.network.upRate, this.historyLimit);
    s.network.downTotal += s.network.downRate * dt;
    s.network.upTotal += s.network.upRate * dt;
    s.network.downPeak = Math.max(s.network.downPeak, s.network.downRate);
    s.network.upPeak = Math.max(s.network.upPeak, s.network.upRate);

    // Processes churn a little and re-sort by CPU.
    if (s.processes.length === 0) {
      s.processes = PROCESS_NAMES.map(([name, user, command], i) => ({
        pid: 1000 + Math.floor(this.random() * 48000),
        name,
        cpu: this.random() * 30,
        mem: this.random() * 8,
        rss: this.random() * 400 * 1024 ** 2,
        threads: 1 + Math.floor(this.random() * 30),
        user,
        command,
        state: this.random() > 0.7 ? "R" : "S",
      }));
    }
    for (const process of s.processes) {
      process.cpu = Math.max(0, Math.min(100, process.cpu + (this.random() - 0.5) * 6));
      process.mem = Math.max(0.1, Math.min(40, process.mem + (this.random() - 0.5) * 0.4));
      process.rss = Math.max(4 * 1024 ** 2, process.rss + (this.random() - 0.5) * 8 * 1024 ** 2);
      if (this.random() < 0.01) process.state = process.state === "R" ? "S" : "R";
    }
    s.processes.sort((a, b) => b.cpu - a.cpu);

    // Temperatures lag CPU load rather than tracking it instantly.
    const packageTemp = 42 + s.cpu.total * 30;
    if (s.temperatures.length === 0) {
      s.temperatures = [
        { label: "CPU Package", value: packageTemp, max: 100 },
        ...s.cpu.cores.slice(0, 6).map((_, i) => ({ label: `CPU Core #${i + 1}`, value: packageTemp, max: 100 })),
        { label: "GPU Package", value: 45, max: 100 },
        { label: "SSD (nvme0n1)", value: 43, max: 85 },
      ];
    }
    s.temperatures.forEach((entry, i) => {
      const target = i === 0
        ? packageTemp
        : entry.label.startsWith("CPU Core")
          ? 40 + s.cpu.cores[i - 1] * 26
          : entry.label.startsWith("GPU")
            ? 42 + s.cpu.total * 14
            : 40 + s.disks[0].temperature * 0.15;
      entry.value += (target - entry.value) * 0.08;
    });

    s.sensors = [
      { label: "Fan Speed 1", value: `${Math.round(1800 + s.cpu.total * 1400)} RPM` },
      { label: "Fan Speed 2", value: `${Math.round(1700 + s.cpu.total * 1300)} RPM` },
      { label: "Battery", value: `${Math.round(96 + Math.sin(t / 60) * 3)}%` },
      { label: "CPU Voltage", value: `${(0.85 + s.cpu.total * 0.25).toFixed(2)} V` },
      { label: "CPU Power", value: `${(6 + s.cpu.total * 22).toFixed(1)} W` },
      { label: "GPU Power", value: `${(4 + s.cpu.total * 9).toFixed(1)} W` },
    ];

    updateTelemetry(s.telemetry, this.random, this.tick, s.cpu.total);
    s.system.processCount = s.telemetry.states.total;
    s.system.threadCount = 940 + Math.round(s.cpu.total * 120);

    s.system.uptime += dt;
    s.system.threadCount = 940 + Math.round(s.cpu.total * 120);
    s.system.contextSwitches = Math.round(48000 + s.cpu.total * 20000);

    // A new log line every so often.
    if (this.tick % 12 === 0) {
      const [level, message, meta] = LOG_TEMPLATES[Math.floor(this.random() * LOG_TEMPLATES.length)];
      s.logs.push({ time: new Date().toTimeString().slice(0, 8), level, message, meta });
      if (s.logs.length > 200) s.logs.shift();
    }

    return s;
  }

  current(): SystemSample {
    return this.state;
  }
}

export function createSystemSimulation(options: SimulationOptions = {}): SystemSimulation {
  return new SystemSimulation(options);
}
