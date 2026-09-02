import { execFile } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import type { SystemSample } from "../simulation.ts";
import { emptyTelemetry } from "./telemetry.ts";

const run = promisify(execFile);

/**
 * Run a command, returning "" instead of throwing when it is unavailable.
 *
 * Whatever it managed to write is kept even when it exits non-zero. `df` exits
 * 1 if any single mount is unreadable while still reporting every other one, so
 * discarding stdout on failure zeroed the capacity of every disk on the machine
 * whenever one stale automount or a departed removable drive was listed.
 */
export async function sh(command: string, args: string[], timeout = 4000): Promise<string> {
  try {
    const { stdout } = await run(command, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const partial = (error as { stdout?: string }).stdout;
    return typeof partial === "string" ? partial : "";
  }
}

/**
 * The last `bytes` of a file, as text.
 *
 * Log files are read for their tail, and reading one whole to keep 40 lines is
 * a habit that only shows up in production: a brute-forced auth.log reaching a
 * few hundred MB blocks the event loop for the better part of a second on every
 * refresh, and above the maximum string length it throws and the panel silently
 * empties.
 */
export async function tailFile(path: string, bytes = 256 * 1024): Promise<string> {
  try {
    const info = await stat(path);
    if (info.size === 0) return "";
    const handle = await open(path, "r");
    try {
      const length = Math.min(bytes, info.size);
      const buffer = Buffer.alloc(length);
      // `bytesRead` matters: the file can be rotated or truncated between the
      // stat and the read, and the untouched tail of the buffer is NUL bytes.
      const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, info.size - length));
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

/**
 * A process name from its command line.
 *
 * `ps -o comm` is not usable for this: Linux truncates it to 15 bytes and it
 * may contain spaces (Firefox ships "Web Content", "Isolated Web Co"), which
 * shifts every whitespace-split column after it; macOS emits the full path
 * truncated to 16 characters, so the tail is a fragment rather than a name.
 * argv[0] has neither problem.
 */
export function processName(args: string): string {
  const argv0 = args.trim().split(/\s+/)[0] ?? "";
  // Kernel threads are already bracketed names, not paths.
  if (argv0.startsWith("[")) return argv0;
  return argv0.split("/").pop() || argv0 || "-";
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
