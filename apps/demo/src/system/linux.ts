import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import type { Collector, SystemSample } from "./types.ts";
import { baseSample, loadAverage, primaryInterface, push, ratePerSecond, sh } from "./common.ts";
import type { Interface } from "./telemetry.ts";
import * as telemetry from "./linux-telemetry.ts";
import * as traffic from "./linux-traffic.ts";

async function read(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

interface CpuTimes {
  idle: number;
  total: number;
}

function parseCpuTimes(text: string): CpuTimes[] {
  const out: CpuTimes[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("cpu")) continue;
    const parts = line.trim().split(/\s+/);
    const values = parts.slice(1).map(Number);
    if (values.length < 4) continue;
    const idle = values[3] + (values[4] ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    out.push({ idle, total });
  }
  return out;
}

function parseMeminfo(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const match = /^(\w+):\s+(\d+)/.exec(line);
    if (match) out[match[1]] = Number(match[2]) * 1024;
  }
  return out;
}

/** Reads everything from /proc and /sys — no external commands, no privileges. */
export class LinuxCollector implements Collector {
  source = "linux /proc";
  unavailable: string[] = [];
  private sample = baseSample();
  private prevCpu: CpuTimes[] = [];
  private prevDisk = new Map<string, [number, number]>();
  private prevNet: [number, number] | null = null;
  private sectorSize = 512;
  private mounts: { device: string; mount: string }[] = [];
  private ticks = 0;
  private interfaceHistory = new Map<string, Interface>();

  async refresh(dt: number): Promise<void> {
    const s = this.sample;
    const [stat, meminfo, uptime, diskstats, netdev] = await Promise.all([
      read("/proc/stat"),
      read("/proc/meminfo"),
      read("/proc/uptime"),
      read("/proc/diskstats"),
      read("/proc/net/dev"),
    ]);

    // CPU — deltas against the previous reading.
    const times = parseCpuTimes(stat);
    if (this.prevCpu.length === times.length && times.length > 0) {
      const usage = times.map((now, i) => {
        const prev = this.prevCpu[i];
        const totalDelta = now.total - prev.total;
        const idleDelta = now.idle - prev.idle;
        if (totalDelta <= 0) return 0;
        return Math.max(0, Math.min(1, 1 - idleDelta / totalDelta));
      });
      s.cpu.total = usage[0];
      s.cpu.cores = usage.slice(1);
      if (s.cpu.cores.length === 0) s.cpu.cores = [s.cpu.total];
    }
    this.prevCpu = times;
    push(s.cpu.history, s.cpu.total * 100);
    s.cpu.load = loadAverage();
    const cpus = os.cpus();
    s.cpu.model = cpus[0]?.model?.trim() ?? s.cpu.model;
    s.cpu.frequencyGhz = (cpus.reduce((a, c) => a + c.speed, 0) / Math.max(1, cpus.length)) / 1000;

    // Context switches and process/thread counts.
    const ctxt = /^ctxt (\d+)/m.exec(stat);
    if (ctxt) s.system.contextSwitches = Number(ctxt[1]);
    const procs = /^procs_running (\d+)/m.exec(stat);
    if (procs) s.system.threadCount = Number(procs[1]);

    // Memory.
    const mem = parseMeminfo(meminfo);
    if (mem.MemTotal) {
      s.memory.total = mem.MemTotal;
      s.memory.free = mem.MemFree ?? 0;
      s.memory.available = mem.MemAvailable ?? mem.MemFree ?? 0;
      s.memory.cached = mem.Cached ?? 0;
      s.memory.buffers = mem.Buffers ?? 0;
      s.memory.used = mem.MemTotal - s.memory.available;
      s.memory.swapTotal = mem.SwapTotal ?? 0;
      s.memory.swapUsed = (mem.SwapTotal ?? 0) - (mem.SwapFree ?? 0);
    }
    push(s.memory.history, (s.memory.used / Math.max(1, s.memory.total)) * 100);

    if (uptime) s.system.uptime = Number(uptime.split(" ")[0]);

    // Disks: throughput from /proc/diskstats, capacity from `df`.
    if (this.mounts.length === 0) await this.loadMounts();
    const stats = new Map<string, [number, number]>();
    for (const line of diskstats.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 14) continue;
      const name = parts[2];
      if (/^(loop|ram|dm-|sr)/.test(name)) continue;
      stats.set(name, [Number(parts[5]) * this.sectorSize, Number(parts[9]) * this.sectorSize]);
    }

    if (s.disks.length === 0) {
      for (const mount of this.mounts.slice(0, 4)) {
        s.disks.push({
          device: mount.device,
          mount: mount.mount,
          type: "disk",
          total: 0, used: 0,
          readRate: 0, writeRate: 0, readHistory: [], writeHistory: [],
          iops: [0, 0], temperature: 0,
        });
      }
    }
    for (const disk of s.disks) {
      const base = disk.device.replace(/p?\d+$/, "");
      const now = stats.get(disk.device) ?? stats.get(base);
      if (now) {
        const prev = this.prevDisk.get(disk.device);
        if (prev) {
          disk.readRate = ratePerSecond(now[0], prev[0], dt);
          disk.writeRate = ratePerSecond(now[1], prev[1], dt);
        }
        this.prevDisk.set(disk.device, now);
      }
      push(disk.readHistory, disk.readRate);
      push(disk.writeHistory, disk.writeRate);
      disk.iops = [Math.round(disk.readRate / 4096), Math.round(disk.writeRate / 4096)];
    }
    await this.updateCapacity();

    // Network.
    const iface = primaryInterface();
    s.network.interface = iface.name;
    s.network.ip = iface.ip;
    s.network.mac = iface.mac;
    for (const line of netdev.split("\n")) {
      const match = /^\s*([\w.-]+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/.exec(line);
      if (!match || match[1] !== iface.name) continue;
      const now: [number, number] = [Number(match[2]), Number(match[3])];
      if (this.prevNet) {
        s.network.downRate = ratePerSecond(now[0], this.prevNet[0], dt);
        s.network.upRate = ratePerSecond(now[1], this.prevNet[1], dt);
      }
      s.network.downTotal = now[0];
      s.network.upTotal = now[1];
      this.prevNet = now;
    }
    push(s.network.downHistory, s.network.downRate);
    push(s.network.upHistory, s.network.upRate);
    s.network.downPeak = Math.max(s.network.downPeak, s.network.downRate);
    s.network.upPeak = Math.max(s.network.upPeak, s.network.upRate);
    const speed = await read(`/sys/class/net/${iface.name}/speed`);
    s.network.speed = speed.trim() && Number(speed) > 0 ? `${Number(speed) / 1000} Gb/s` : "-";

    await Promise.all([this.updateProcesses(), this.updateTemperatures()]);
    await this.updateTelemetry(dt);
  }

  /**
   * Cheap counters every tick; anything that shells out runs on a slower
   * cadence so the dashboard never stalls waiting on `systemctl` or `last`.
   */
  private async updateTelemetry(dt: number): Promise<void> {
    const t = this.sample.telemetry;
    this.ticks++;

    // Every tick: pure /proc reads.
    const [kernel, interfaces] = await Promise.all([
      telemetry.kernel(dt),
      telemetry.interfaces(dt, this.interfaceHistory),
    ]);
    t.kernel = kernel;
    t.interfaces = interfaces;

    // TCP/UDP/ICMP counters are a single /proc read, so every tick.
    t.net = await traffic.counters();
    push(t.netInHistory, t.net.rates.inSegs);
    push(t.netOutHistory, t.net.rates.outSegs);
    push(t.retransHistory, t.net.rates.retrans);
    this.sample.system.contextSwitches = kernel.contextSwitches;

    // Every other tick: one cheap command each.
    if (this.ticks % 2 === 1) {
      const [sockets, states] = await Promise.all([telemetry.sockets(), telemetry.processStates()]);
      t.connections = sockets.connections;
      t.listeners = sockets.listeners;
      t.states = states;
      push(t.connectionHistory, sockets.connections.length);

      const split = traffic.breakdown(sockets.connections, sockets.listeners);
      t.protocols = split.protocols;
      t.remotes = split.remotes;
      t.inboundConnections = split.inbound;
      t.outboundConnections = split.outbound;
      this.sample.system.processCount = states.total;
    }

    // Every 5 ticks: sessions, journal and filesystems.
    if (this.ticks % 5 === 1) {
      const [sessions, journal, filesystems] = await Promise.all([
        telemetry.sessions(),
        telemetry.journal(80),
        telemetry.filesystems(),
      ]);
      t.sessions = sessions;
      t.journal = journal;
      t.filesystems = filesystems;
      push(t.sessionHistory, sessions.length);
      // The dashboard log panel reads sample.logs, so mirror the real journal in.
      this.sample.logs = journal.map((entry) => ({
        time: entry.time,
        level: entry.level,
        message: entry.message,
        meta: entry.unit,
      }));
    }

    // Every 15 ticks: the slow ones.
    if (this.ticks % 15 === 1) {
      const [services, containers, logins, failed, gpus, power] = await Promise.all([
        telemetry.services(),
        telemetry.containers(),
        telemetry.logins(20),
        telemetry.failedLogins(15),
        telemetry.gpus(),
        telemetry.power(),
      ]);
      t.services = services;
      t.containers = containers;
      t.logins = logins;
      t.failedLogins = failed;
      t.gpus = gpus;
      t.power = power;
      const [ssh, http] = await Promise.all([traffic.sshEvents(40), traffic.http()]);
      t.ssh = ssh;
      t.http = http;
      if (!http && !this.unavailable.includes("http access logs")) {
        this.unavailable.push("http access logs");
      }
      if (gpus.length === 0 && !this.unavailable.includes("gpu")) this.unavailable.push("gpu");
      if (!power && !this.unavailable.includes("battery")) this.unavailable.push("battery");
    }
  }

  private async loadMounts(): Promise<void> {
    const text = await read("/proc/mounts");
    const seen = new Set<string>();
    for (const line of text.split("\n")) {
      const [device, mount, type] = line.split(" ");
      if (!device?.startsWith("/dev/")) continue;
      if (!["ext4", "xfs", "btrfs", "zfs", "f2fs", "ext3", "vfat", "apfs", "overlay"].includes(type)) continue;
      const name = device.replace("/dev/", "");
      if (seen.has(name)) continue;
      seen.add(name);
      this.mounts.push({ device: name, mount });
    }
    if (this.mounts.length === 0) this.mounts.push({ device: "root", mount: "/" });
  }

  private async updateCapacity(): Promise<void> {
    const text = await sh("df", ["-kP", ...this.sample.disks.map((d) => d.mount)]);
    const lines = text.trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const mount = parts[parts.length - 1];
      const disk = this.sample.disks.find((d) => d.mount === mount);
      if (!disk) continue;
      disk.total = Number(parts[1]) * 1024;
      disk.used = Number(parts[2]) * 1024;
    }
  }

  private async updateProcesses(): Promise<void> {
    const text = await sh("ps", ["-eo", "pid,comm,pcpu,pmem,rss,nlwp,user,state,args", "--sort=-pcpu"]);
    if (!text) {
      if (!this.unavailable.includes("processes")) this.unavailable.push("processes");
      return;
    }
    const lines = text.trim().split("\n").slice(1, 60);
    this.sample.processes = lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: Number(parts[0]),
        name: parts[1] ?? "-",
        cpu: Number(parts[2]) || 0,
        mem: Number(parts[3]) || 0,
        rss: (Number(parts[4]) || 0) * 1024,
        threads: Number(parts[5]) || 1,
        user: parts[6] ?? "-",
        state: parts[7] ?? "-",
        command: parts.slice(8).join(" "),
      };
    });
    this.sample.system.processCount = this.sample.processes.length;
  }

  private async updateTemperatures(): Promise<void> {
    const out = await telemetry.temperatures();
    if (out.length === 0 && !this.unavailable.includes("temperatures")) {
      this.unavailable.push("temperatures");
    } else if (out.length > 0) {
      this.unavailable = this.unavailable.filter((u) => u !== "temperatures");
    }
    this.sample.temperatures = out;
    this.sample.sensors = out.slice(0, 6).map((t) => ({ label: t.label, value: `${t.value.toFixed(1)} °C` }));
  }

  current(): SystemSample {
    return this.sample;
  }
}
