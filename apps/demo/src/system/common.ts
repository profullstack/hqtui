import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import type { SystemSample } from "../simulation.ts";
import { emptyTelemetry } from "./telemetry.ts";

const run = promisify(execFile);

/** Run a command, returning "" instead of throwing when it is unavailable. */
export async function sh(command: string, args: string[], timeout = 4000): Promise<string> {
  try {
    const { stdout } = await run(command, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    return "";
  }
}

export function push(history: number[], value: number, limit = 240): void {
  history.push(value);
  if (history.length > limit) history.shift();
}

export function ratePerSecond(current: number, previous: number, dt: number): number {
  if (previous <= 0 || dt <= 0 || current < previous) return 0;
  return (current - previous) / dt;
}

/** An empty sample pre-filled from `os`, so every platform starts consistent. */
export function baseSample(): SystemSample {
  const cpus = os.cpus();
  const total = os.totalmem();
  return {
    time: 0,
    telemetry: emptyTelemetry(),
    cpu: {
      total: 0,
      cores: new Array(Math.max(1, cpus.length)).fill(0),
      history: [],
      load: [0, 0, 0],
      model: cpus[0]?.model?.trim() ?? "Unknown CPU",
      frequencyGhz: (cpus[0]?.speed ?? 0) / 1000,
    },
    memory: {
      total,
      used: total - os.freemem(),
      available: os.freemem(),
      cached: 0,
      buffers: 0,
      free: os.freemem(),
      history: [],
      swapTotal: 0,
      swapUsed: 0,
    },
    disks: [],
    network: {
      interface: "-",
      speed: "-",
      ip: "-",
      mac: "-",
      downRate: 0,
      upRate: 0,
      downHistory: [],
      upHistory: [],
      downTotal: 0,
      upTotal: 0,
      downPeak: 0,
      upPeak: 0,
    },
    processes: [],
    temperatures: [],
    sensors: [],
    system: {
      os: `${os.type()} ${os.release()}`,
      kernel: os.release(),
      hostname: os.hostname(),
      shell: (process.env.SHELL ?? process.env.ComSpec ?? "-").split("/").pop() ?? "-",
      terminal: process.env.TERM_PROGRAM ?? process.env.TERM ?? "-",
      uptime: os.uptime(),
      processCount: 0,
      threadCount: 0,
      contextSwitches: 0,
    },
    logs: [],
  };
}

/** Primary non-loopback interface, for the network panel header. */
export function primaryInterface(): { name: string; ip: string; mac: string } {
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return { name, ip: address.address, mac: address.mac };
      }
    }
  }
  return { name: "-", ip: "-", mac: "-" };
}

export function loadAverage(): [number, number, number] {
  const [a, b, c] = os.loadavg();
  return [a, b, c];
}
