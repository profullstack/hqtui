import os from "node:os";
import type { Collector, SystemSample } from "./types.ts";
import { baseSample, loadAverage, primaryInterface, push, ratePerSecond, sh } from "./common.ts";

/** One PowerShell round-trip per refresh; CIM covers CPU, memory, disk and net. */
async function powershell(script: string): Promise<unknown> {
  const out = await sh("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `${script} | ConvertTo-Json -Compress -Depth 4`,
  ], 8000);
  if (!out.trim()) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];
  return [value as T];
}

export class WindowsCollector implements Collector {
  source = "Windows CIM";
  unavailable = ["per-core detail", "temperatures"];
  private sample = baseSample();
  private prevNet: [number, number] | null = null;

  async refresh(dt: number): Promise<void> {
    const s = this.sample;

    const cpu = await powershell(
      "Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Select-Object Name,PercentProcessorTime",
    );
    const entries = asArray<{ Name: string; PercentProcessorTime: number }>(cpu);
    const cores = entries.filter((e) => e.Name !== "_Total");
    const total = entries.find((e) => e.Name === "_Total");
    if (total) s.cpu.total = Math.max(0, Math.min(1, Number(total.PercentProcessorTime) / 100));
    if (cores.length > 0) {
      s.cpu.cores = cores.map((c) => Math.max(0, Math.min(1, Number(c.PercentProcessorTime) / 100)));
    }
    push(s.cpu.history, s.cpu.total * 100);
    s.cpu.load = loadAverage();

    const mem = await powershell(
      "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory,TotalVirtualMemorySize,FreeVirtualMemory,Caption,Version,NumberOfProcesses",
    ) as Record<string, number | string> | null;
    if (mem) {
      const totalBytes = Number(mem.TotalVisibleMemorySize) * 1024;
      const freeBytes = Number(mem.FreePhysicalMemory) * 1024;
      s.memory.total = totalBytes;
      s.memory.free = freeBytes;
      s.memory.available = freeBytes;
      s.memory.used = totalBytes - freeBytes;
      s.memory.swapTotal = Number(mem.TotalVirtualMemorySize) * 1024;
      s.memory.swapUsed = s.memory.swapTotal - Number(mem.FreeVirtualMemory) * 1024;
      s.system.os = `${mem.Caption ?? "Windows"}`.trim();
      s.system.processCount = Number(mem.NumberOfProcesses) || 0;
    }
    push(s.memory.history, (s.memory.used / Math.max(1, s.memory.total)) * 100);
    s.system.uptime = os.uptime();

    const disks = await powershell(
      "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,Size,FreeSpace",
    );
    const diskRows = asArray<{ DeviceID: string; Size: number; FreeSpace: number }>(disks);
    if (s.disks.length === 0) {
      for (const row of diskRows.slice(0, 4)) {
        s.disks.push({
          device: row.DeviceID, mount: row.DeviceID, type: "disk",
          total: 0, used: 0, readRate: 0, writeRate: 0,
          readHistory: [], writeHistory: [], iops: [0, 0], temperature: 0,
        });
      }
    }
    for (const disk of s.disks) {
      const row = diskRows.find((r) => r.DeviceID === disk.device);
      if (!row) continue;
      disk.total = Number(row.Size) || 0;
      disk.used = disk.total - (Number(row.FreeSpace) || 0);
      push(disk.readHistory, disk.readRate);
      push(disk.writeHistory, disk.writeRate);
    }

    const iface = primaryInterface();
    s.network.interface = iface.name;
    s.network.ip = iface.ip;
    s.network.mac = iface.mac;
    const net = await powershell(
      "Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface | Select-Object BytesReceivedPersec,BytesSentPersec",
    );
    const netRows = asArray<{ BytesReceivedPersec: number; BytesSentPersec: number }>(net);
    if (netRows.length > 0) {
      const received = netRows.reduce((a, r) => a + Number(r.BytesReceivedPersec || 0), 0);
      const sent = netRows.reduce((a, r) => a + Number(r.BytesSentPersec || 0), 0);
      if (this.prevNet) {
        s.network.downRate = ratePerSecond(received, this.prevNet[0], dt);
        s.network.upRate = ratePerSecond(sent, this.prevNet[1], dt);
      }
      s.network.downTotal = received;
      s.network.upTotal = sent;
      this.prevNet = [received, sent];
    }
    push(s.network.downHistory, s.network.downRate);
    push(s.network.upHistory, s.network.upRate);
    s.network.downPeak = Math.max(s.network.downPeak, s.network.downRate);
    s.network.upPeak = Math.max(s.network.upPeak, s.network.upRate);

    const processes = await powershell(
      "Get-Process | Sort-Object CPU -Descending | Select-Object -First 40 Id,ProcessName,CPU,WorkingSet,Threads",
    );
    const rows = asArray<{ Id: number; ProcessName: string; CPU: number; WorkingSet: number; Threads: unknown }>(processes);
    const totalMemory = Math.max(1, s.memory.total);
    s.processes = rows.map((row) => ({
      pid: Number(row.Id),
      name: String(row.ProcessName),
      cpu: Number(row.CPU) || 0,
      mem: ((Number(row.WorkingSet) || 0) / totalMemory) * 100,
      rss: Number(row.WorkingSet) || 0,
      threads: Array.isArray(row.Threads) ? row.Threads.length : 1,
      user: "-",
      state: "R",
      command: String(row.ProcessName),
    }));
  }

  current(): SystemSample {
    return this.sample;
  }
}
