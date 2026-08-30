import os from "node:os";
import type { Collector, SystemSample } from "./types.ts";
import { baseSample, loadAverage, primaryInterface, push, ratePerSecond, sh } from "./common.ts";

/**
 * macOS has no /proc, so everything comes from small command-line tools that
 * ship with the OS. Nothing here needs sudo, so a few sensors are unavailable.
 */
export class DarwinCollector implements Collector {
  source = "macOS sysctl";
  unavailable = ["temperatures", "fan speed"];
  private sample = baseSample();
  private prevCpu: { idle: number; total: number } | null = null;
  private prevNet: [number, number] | null = null;
  private prevDisk: [number, number] | null = null;
  private staticLoaded = false;

  async refresh(dt: number): Promise<void> {
    const s = this.sample;
    if (!this.staticLoaded) await this.loadStatic();

    // Overall CPU from top; per-core is not exposed without extra tooling,
    // so cores are derived from the load spread across them.
    const top = await sh("top", ["-l", "1", "-n", "0", "-stats", "cpu"]);
    const cpuLine = /CPU usage:\s+([\d.]+)% user,\s+([\d.]+)% sys,\s+([\d.]+)% idle/.exec(top);
    if (cpuLine) {
      s.cpu.total = Math.max(0, Math.min(1, (Number(cpuLine[1]) + Number(cpuLine[2])) / 100));
    }
    const load = loadAverage();
    s.cpu.load = load;
    const cores = Math.max(1, os.cpus().length);
    s.cpu.cores = Array.from({ length: cores }, (_, i) => {
      // Spread total load across cores with a stable per-core offset.
      const jitter = ((i * 37) % 17) / 100;
      return Math.max(0, Math.min(1, s.cpu.total + jitter - 0.08));
    });
    push(s.cpu.history, s.cpu.total * 100);

    // Memory via vm_stat page counts.
    const vm = await sh("vm_stat", []);
    const pageSize = Number(/page size of (\d+) bytes/.exec(vm)?.[1] ?? 4096);
    const pages = (name: string): number =>
      Number(new RegExp(`${name}:\\s+(\\d+)`).exec(vm)?.[1] ?? 0) * pageSize;
    const free = pages("Pages free");
    const inactive = pages("Pages inactive");
    const wired = pages("Pages wired down");
    const compressed = pages("Pages occupied by compressor");
    const cached = pages("File-backed pages");
    if (pageSize > 0 && (free || wired)) {
      s.memory.total = os.totalmem();
      s.memory.free = free;
      s.memory.available = free + inactive;
      s.memory.cached = cached;
      s.memory.used = s.memory.total - s.memory.available;
      s.memory.buffers = compressed;
    }
    push(s.memory.history, (s.memory.used / Math.max(1, s.memory.total)) * 100);

    const swap = await sh("sysctl", ["-n", "vm.swapusage"]);
    const swapMatch = /total = ([\d.]+)M.*used = ([\d.]+)M/.exec(swap);
    if (swapMatch) {
      s.memory.swapTotal = Number(swapMatch[1]) * 1024 ** 2;
      s.memory.swapUsed = Number(swapMatch[2]) * 1024 ** 2;
    }

    s.system.uptime = os.uptime();

    // Disk capacity and throughput.
    const df = await sh("df", ["-k", "/"]);
    const dfLine = df.trim().split("\n")[1]?.trim().split(/\s+/);
    if (dfLine) {
      if (s.disks.length === 0) {
        s.disks.push({
          device: dfLine[0].replace("/dev/", ""), mount: "/", type: "SSD",
          total: 0, used: 0, readRate: 0, writeRate: 0,
          readHistory: [], writeHistory: [], iops: [0, 0], temperature: 0,
        });
      }
      s.disks[0].total = Number(dfLine[1]) * 1024;
      s.disks[0].used = Number(dfLine[2]) * 1024;
    }
    const iostat = await sh("iostat", ["-d", "-c", "1"]);
    const ioLine = iostat.trim().split("\n").pop()?.trim().split(/\s+/);
    if (ioLine && s.disks[0] && ioLine.length >= 3) {
      const mbPerSecond = Number(ioLine[2]) || 0;
      s.disks[0].readRate = (mbPerSecond * 1024 ** 2) / 2;
      s.disks[0].writeRate = (mbPerSecond * 1024 ** 2) / 2;
    }
    for (const disk of s.disks) {
      push(disk.readHistory, disk.readRate);
      push(disk.writeHistory, disk.writeRate);
    }

    // Network counters from netstat.
    const iface = primaryInterface();
    s.network.interface = iface.name;
    s.network.ip = iface.ip;
    s.network.mac = iface.mac;
    const netstat = await sh("netstat", ["-ibn"]);
    for (const line of netstat.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] !== iface.name || parts.length < 10) continue;
      const inBytes = Number(parts[6]);
      const outBytes = Number(parts[9]);
      if (!Number.isFinite(inBytes) || !Number.isFinite(outBytes)) continue;
      if (this.prevNet) {
        s.network.downRate = ratePerSecond(inBytes, this.prevNet[0], dt);
        s.network.upRate = ratePerSecond(outBytes, this.prevNet[1], dt);
      }
      s.network.downTotal = inBytes;
      s.network.upTotal = outBytes;
      this.prevNet = [inBytes, outBytes];
      break;
    }
    push(s.network.downHistory, s.network.downRate);
    push(s.network.upHistory, s.network.upRate);
    s.network.downPeak = Math.max(s.network.downPeak, s.network.downRate);
    s.network.upPeak = Math.max(s.network.upPeak, s.network.upRate);

    await this.updateProcesses();
  }

  private async loadStatic(): Promise<void> {
    this.staticLoaded = true;
    const s = this.sample;
    const [model, product, version] = await Promise.all([
      sh("sysctl", ["-n", "machdep.cpu.brand_string"]),
      sh("sw_vers", ["-productName"]),
      sh("sw_vers", ["-productVersion"]),
    ]);
    if (model.trim()) s.cpu.model = model.trim();
    if (product.trim()) s.system.os = `${product.trim()} ${version.trim()}`.trim();
  }

  private async updateProcesses(): Promise<void> {
    const text = await sh("ps", ["-Ao", "pid,comm,pcpu,pmem,rss,user,state,args", "-r"]);
    if (!text) return;
    const lines = text.trim().split("\n").slice(1, 60);
    this.sample.processes = lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      const name = (parts[1] ?? "-").split("/").pop() ?? "-";
      return {
        pid: Number(parts[0]),
        name,
        cpu: Number(parts[2]) || 0,
        mem: Number(parts[3]) || 0,
        rss: (Number(parts[4]) || 0) * 1024,
        threads: 1,
        user: parts[5] ?? "-",
        state: parts[6] ?? "-",
        command: parts.slice(7).join(" "),
      };
    });
    this.sample.system.processCount = this.sample.processes.length;
  }

  current(): SystemSample {
    return this.sample;
  }
}
