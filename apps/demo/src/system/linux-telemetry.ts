import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import { sh, push } from "./common.ts";
import type {
  Connection, Container, Filesystem, Interface, JournalEntry, KernelStats,
  Listener, LoginEvent, ProcessStates, PowerStats, ServiceUnit, Session, Telemetry, GpuStats,
} from "./telemetry.ts";

/**
 * Prefix for every sysfs path. Empty in production; tests point it at a
 * fixture tree, because the hwmon layout cannot be exercised on a machine that
 * has no sensors — which includes every virtual machine.
 */
const SYSFS = process.env.HQTUI_SYSFS_ROOT ?? "";

async function read(path: string): Promise<string> {
  try {
    return await readFile(path.startsWith("/sys") ? SYSFS + path : path, "utf8");
  } catch {
    return "";
  }
}

async function list(path: string): Promise<string[]> {
  try {
    return await readdir(path.startsWith("/sys") ? SYSFS + path : path);
  } catch {
    return [];
  }
}

/** `who -u`: who is logged in right now, and how idle they are. */
export async function sessions(): Promise<Session[]> {
  const text = await sh("who", ["-u"]);
  if (!text) return [];
  return text.trim().split("\n").filter(Boolean).map((line) => {
    const parts = line.trim().split(/\s+/);
    return {
      user: parts[0] ?? "-",
      tty: parts[1] ?? "-",
      loginAt: `${parts[2] ?? ""} ${parts[3] ?? ""}`.trim(),
      idle: parts[4] ?? ".",
      what: parts[5] ?? "",
      // `who -u` puts the origin host in parentheses at the end when there is one.
      from: /\(([^)]+)\)/.exec(line)?.[1] ?? "local",
    };
  });
}

function parseLastLine(line: string, status: LoginEvent["status"]): LoginEvent | null {
  if (!line.trim() || /^(wtmp|btmp|reboot|$)/.test(line)) return null;
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const stillLoggedIn = /still logged in/.test(line);
  return {
    user: parts[0],
    tty: parts[1],
    from: /^\d+\.\d+\.\d+\.\d+$/.test(parts[2]) || parts[2].includes(".") ? parts[2] : "local",
    when: parts.slice(-7, -3).join(" ") || parts.slice(3, 7).join(" "),
    status: stillLoggedIn ? "still" : status,
  };
}

/** Successful logins from wtmp. */
export async function logins(limit = 20): Promise<LoginEvent[]> {
  const text = await sh("last", ["-n", String(limit), "-w"]);
  if (!text) return [];
  return text.split("\n").map((l) => parseLastLine(l, "ok")).filter((e): e is LoginEvent => e !== null);
}

/** Failed logins from btmp. Usually root-only, so an empty list is normal. */
export async function failedLogins(limit = 15): Promise<LoginEvent[]> {
  const text = await sh("lastb", ["-n", String(limit), "-w"]);
  if (!text) return [];
  return text.split("\n").map((l) => parseLastLine(l, "failed")).filter((e): e is LoginEvent => e !== null);
}

function splitAddress(address: string): { host: string; port: string } {
  const index = address.lastIndexOf(":");
  if (index === -1) return { host: address, port: "" };
  return { host: address.slice(0, index), port: address.slice(index + 1) };
}

interface Sockets {
  connections: Connection[];
  listeners: Listener[];
}

/** `ss -tunap`: established connections and listening sockets. */
export async function sockets(): Promise<Sockets> {
  const text = await sh("ss", ["-tunap"]);
  if (!text) return { connections: [], listeners: [] };

  const connections: Connection[] = [];
  const listeners: Listener[] = [];
  for (const line of text.trim().split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [proto, state, , , local, remote] = parts;
    const process = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    const label = process ? `${process[1]}/${process[2]}` : "-";
    if (state === "LISTEN") {
      const { host, port } = splitAddress(local);
      listeners.push({ proto, address: host, port, process: label });
    } else if (state === "ESTAB" || proto.startsWith("udp")) {
      connections.push({ proto, local, remote: remote ?? "-", state, process: label });
    }
  }
  return { connections, listeners };
}

/** systemd units that are loaded, with failures first. */
export async function services(limit = 60): Promise<ServiceUnit[]> {
  const text = await sh("systemctl", [
    "list-units", "--type=service", "--all", "--no-pager", "--no-legend", "--plain",
  ]);
  if (!text) return [];
  const units = text.trim().split("\n").map((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) return null;
    return {
      name: parts[0].replace(/\.service$/, ""),
      active: parts[2],
      sub: parts[3],
      description: parts.slice(4).join(" "),
    };
  }).filter((u): u is ServiceUnit => u !== null);

  const rank = (unit: ServiceUnit) =>
    unit.active === "failed" ? 0 : unit.active === "active" ? 1 : 2;
  units.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return units.slice(0, limit);
}

/** Running docker containers, when docker is reachable without a password. */
export async function containers(): Promise<Container[]> {
  const text = await sh("docker", [
    "ps", "--no-trunc", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}",
  ], 3000);
  if (!text) return [];
  return text.trim().split("\n").filter(Boolean).map((line) => {
    const [id, name, image, status] = line.split("\t");
    return { id: (id ?? "").slice(0, 12), name: name ?? "-", image: image ?? "-", status: status ?? "-", cpu: "-", memory: "-" };
  });
}

interface Counters {
  [name: string]: [number, number];
}
const previousInterfaces: Counters = {};

/** Every network interface with its own throughput history. */
export async function interfaces(dt: number, history: Map<string, Interface>): Promise<Interface[]> {
  const netdev = await read("/proc/net/dev");
  if (!netdev) return [];
  const addresses = os.networkInterfaces();
  const out: Interface[] = [];

  for (const line of netdev.split("\n").slice(2)) {
    const match = /^\s*([\w.@-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const name = match[1];
    if (name === "lo") continue;
    const values = match[2].trim().split(/\s+/).map(Number);
    const [rxBytes, , rxErrs, rxDrop] = values;
    const txBytes = values[8];
    const txErrs = values[10] ?? 0;
    const txDrop = values[11] ?? 0;

    const previous = previousInterfaces[name];
    const rxRate = previous && rxBytes >= previous[0] ? (rxBytes - previous[0]) / dt : 0;
    const txRate = previous && txBytes >= previous[1] ? (txBytes - previous[1]) / dt : 0;
    previousInterfaces[name] = [rxBytes, txBytes];

    const address = (addresses[name] ?? []).find((a) => a.family === "IPv4");
    const existing = history.get(name);
    const entry: Interface = {
      name,
      ip: address?.address ?? "-",
      mac: address?.mac ?? "-",
      state: (await read(`/sys/class/net/${name}/operstate`)).trim() || "unknown",
      mtu: Number((await read(`/sys/class/net/${name}/mtu`)).trim()) || 0,
      rxRate,
      txRate,
      rxTotal: rxBytes,
      txTotal: txBytes,
      rxHistory: existing?.rxHistory ?? [],
      txHistory: existing?.txHistory ?? [],
      errors: (rxErrs ?? 0) + txErrs,
      drops: (rxDrop ?? 0) + txDrop,
    };
    push(entry.rxHistory, rxRate);
    push(entry.txHistory, txRate);
    history.set(name, entry);
    out.push(entry);
  }
  return out;
}

/** Mounted filesystems with capacity and inode usage. */
export async function filesystems(): Promise<Filesystem[]> {
  const [sizes, inodes] = await Promise.all([
    sh("df", ["-kPT", "-x", "tmpfs", "-x", "devtmpfs", "-x", "squashfs", "-x", "overlay"]),
    sh("df", ["-iP", "-x", "tmpfs", "-x", "devtmpfs", "-x", "squashfs", "-x", "overlay"]),
  ]);
  if (!sizes) return [];

  const inodeByMount = new Map<string, [number, number]>();
  for (const line of inodes.trim().split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    inodeByMount.set(parts[parts.length - 1], [Number(parts[2]), Number(parts[1])]);
  }

  return sizes.trim().split("\n").slice(1).map((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) return null;
    const mount = parts[parts.length - 1];
    const [inodesUsed, inodesTotal] = inodeByMount.get(mount) ?? [0, 0];
    return {
      device: parts[0],
      type: parts[1],
      size: Number(parts[2]) * 1024,
      used: Number(parts[3]) * 1024,
      mount,
      inodesUsed,
      inodesTotal,
    };
  }).filter((f): f is Filesystem => f !== null).slice(0, 8);
}

let previousKernel: { ctxt: number; intr: number; forks: number; at: number } | null = null;

/** Kernel counters: context switches, interrupts, forks, entropy, fd usage. */
export async function kernel(dt: number): Promise<KernelStats> {
  const [stat, vmstat, entropy, fileNr] = await Promise.all([
    read("/proc/stat"),
    read("/proc/vmstat"),
    read("/proc/sys/kernel/random/entropy_avail"),
    read("/proc/sys/fs/file-nr"),
  ]);

  const number = (source: string, pattern: RegExp): number => Number(pattern.exec(source)?.[1] ?? 0);
  const ctxt = number(stat, /^ctxt (\d+)/m);
  const intr = Number(/^intr (\d+)/m.exec(stat)?.[1] ?? 0);
  const forks = number(stat, /^processes (\d+)/m);

  let contextSwitchRate = 0;
  let interruptRate = 0;
  let forkRate = 0;
  if (previousKernel && dt > 0) {
    contextSwitchRate = Math.max(0, (ctxt - previousKernel.ctxt) / dt);
    interruptRate = Math.max(0, (intr - previousKernel.intr) / dt);
    forkRate = Math.max(0, (forks - previousKernel.forks) / dt);
  }
  previousKernel = { ctxt, intr, forks, at: Date.now() };

  const fd = fileNr.trim().split(/\s+/).map(Number);
  return {
    contextSwitches: ctxt,
    contextSwitchRate,
    interrupts: intr,
    interruptRate,
    forks,
    forkRate,
    procsRunning: number(stat, /^procs_running (\d+)/m),
    procsBlocked: number(stat, /^procs_blocked (\d+)/m),
    entropy: Number(entropy.trim()) || 0,
    openFiles: fd[0] ?? 0,
    maxFiles: fd[2] ?? 0,
    bootTime: number(stat, /^btime (\d+)/m),
    pageIn: number(vmstat, /^pgpgin (\d+)/m),
    pageOut: number(vmstat, /^pgpgout (\d+)/m),
    swapIn: number(vmstat, /^pswpin (\d+)/m),
    swapOut: number(vmstat, /^pswpout (\d+)/m),
  };
}

/**
 * Why this host reports no thermal hardware. A hypervisor does not pass the
 * physical machine's sensors through, so on a guest there is no package to
 * install and no configuration to fix — the hardware simply is not there.
 */
export async function sensorDiagnosis(): Promise<string> {
  const virt = (await sh("systemd-detect-virt", [], 3000)).trim();
  if (virt && virt !== "none") {
    return `virtualised (${virt}) — hypervisors do not expose thermal hardware to guests`;
  }
  const hasSensorsDetect = (await sh("which", ["sensors-detect"], 2000)).trim();
  if (!hasSensorsDetect) {
    return "no sensor chips found — install lm-sensors and run `sudo sensors-detect --auto`";
  }
  return "lm-sensors found no supported chips on this machine";
}

export interface SensorReading {
  label: string;
  value: string;
  /** Where it came from, so the UI can explain an empty panel. */
  kind: "fan" | "voltage" | "power" | "current" | "battery" | "gpu" | "frequency";
}

/** Directories that may hold sensor files, including the older device/ layout. */
async function hwmonDirs(): Promise<{ dir: string; chip: string }[]> {
  const out: { dir: string; chip: string }[] = [];
  {
    for (const entry of await list("/sys/class/hwmon")) {
      const base = `/sys/class/hwmon/${entry}`;
      const chip = (await read(`${base}/name`)).trim() || (await read(`${base}/device/name`)).trim() || entry;
      out.push({ dir: base, chip });
      // Kernels before ~4.x put the inputs one level down.
      const nested = `${base}/device`;
      const files = await list(nested);
      if (files.some((f) => /^(temp|fan|in|power|curr)\d+_input$/.test(f))) {
        out.push({ dir: nested, chip });
      }
    }
  }
  return out;
}

async function labelled(dir: string, entry: string, chip: string, fallback: string): Promise<string> {
  const label = (await read(`${dir}/${entry.replace("_input", "_label").replace("_average", "_label")}`)).trim();
  if (label) return label;
  return chip ? `${chip} ${fallback}` : fallback;
}

/** Temperatures from hwmon and, when that is empty, the thermal zones. */
export async function temperatures(): Promise<{ label: string; value: number; max: number }[]> {
  const out: { label: string; value: number; max: number }[] = [];

  for (const { dir, chip } of await hwmonDirs()) {
    for (const entry of await list(dir)) {
      if (!/^temp\d+_input$/.test(entry)) continue;
      const value = Number(await read(`${dir}/${entry}`)) / 1000;
      if (!Number.isFinite(value) || value <= 0 || value > 150) continue;
      const max = Number(await read(`${dir}/${entry.replace("_input", "_crit")}`)) / 1000;
      out.push({
        label: await labelled(dir, entry, chip, entry.replace("_input", "")),
        value,
        max: Number.isFinite(max) && max > 0 ? max : 100,
      });
    }
  }

  // Thermal zones are present on many machines that expose no hwmon at all.
  if (out.length === 0) {
    {
      for (const zone of await list("/sys/class/thermal")) {
        if (!zone.startsWith("thermal_zone")) continue;
        const value = Number(await read(`/sys/class/thermal/${zone}/temp`)) / 1000;
        if (!Number.isFinite(value) || value <= 0 || value > 150) continue;
        const type = (await read(`/sys/class/thermal/${zone}/type`)).trim();
        out.push({ label: type || zone, value, max: 100 });
      }
    }
  }

  // lm-sensors reaches chips the sysfs walk can miss, and names them properly.
  if (out.length === 0) {
    const json = await sh("sensors", ["-j"], 4000);
    if (json) {
      try {
        const parsed = JSON.parse(json) as Record<string, Record<string, Record<string, number>>>;
        for (const [chip, features] of Object.entries(parsed)) {
          for (const [feature, values] of Object.entries(features)) {
            if (typeof values !== "object" || values === null) continue;
            const input = Object.entries(values).find(([key]) => /_input$/.test(key) && key.startsWith("temp"));
            if (!input) continue;
            const value = Number(input[1]);
            if (!Number.isFinite(value) || value <= 0 || value > 150) continue;
            out.push({ label: `${chip.split("-")[0]} ${feature}`, value, max: 100 });
          }
        }
      } catch {
        // Older lm-sensors without -j support.
      }
    }
  }

  return out.slice(0, 12);
}

/**
 * Hardware sensors other than temperature: fans, voltage rails, power draw and
 * current. These are independent of the temperature probes, so a machine with
 * no thermal sensors can still report fans, and vice versa.
 */
export async function hardwareSensors(): Promise<SensorReading[]> {
  const out: SensorReading[] = [];

  for (const { dir, chip } of await hwmonDirs()) {
    for (const entry of (await list(dir)).sort()) {
      const raw = Number(await read(`${dir}/${entry}`));
      if (!Number.isFinite(raw)) continue;

      if (/^fan\d+_input$/.test(entry)) {
        if (raw <= 0) continue;
        out.push({
          label: await labelled(dir, entry, chip, entry.replace("_input", "").replace("fan", "Fan ")),
          value: `${Math.round(raw)} RPM`,
          kind: "fan",
        });
      } else if (/^in\d+_input$/.test(entry)) {
        if (raw <= 0) continue;
        out.push({
          label: await labelled(dir, entry, chip, entry.replace("_input", "")),
          value: `${(raw / 1000).toFixed(2)} V`,
          kind: "voltage",
        });
      } else if (/^power\d+_(average|input)$/.test(entry)) {
        if (raw <= 0) continue;
        out.push({
          label: await labelled(dir, entry, chip, entry.replace(/_(average|input)$/, "")),
          value: `${(raw / 1e6).toFixed(1)} W`,
          kind: "power",
        });
      } else if (/^curr\d+_input$/.test(entry)) {
        if (raw <= 0) continue;
        out.push({
          label: await labelled(dir, entry, chip, entry.replace("_input", "")),
          value: `${(raw / 1000).toFixed(2)} A`,
          kind: "current",
        });
      }
      if (out.length >= 14) return out;
    }
  }
  return out;
}

/** Current clock speed per core, which every Linux host reports. */
export async function cpuFrequencies(): Promise<SensorReading[]> {
  const out: SensorReading[] = [];
  {
    const cpus = (await list("/sys/devices/system/cpu"))
      .filter((entry) => /^cpu\d+$/.test(entry))
      .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
    for (const cpu of cpus.slice(0, 4)) {
      const khz = Number((await read(`/sys/devices/system/cpu/${cpu}/cpufreq/scaling_cur_freq`)).trim());
      if (!Number.isFinite(khz) || khz <= 0) continue;
      out.push({ label: `${cpu} clock`, value: `${(khz / 1e6).toFixed(2)} GHz`, kind: "frequency" });
    }
  }

  if (out.length === 0) {
    // /proc/cpuinfo still reports a measured MHz where cpufreq is missing.
    const info = await read("/proc/cpuinfo");
    const speeds = [...info.matchAll(/^cpu MHz\s*:\s*([\d.]+)/gm)].map((m) => Number(m[1]));
    speeds.slice(0, 4).forEach((mhz, i) => {
      if (Number.isFinite(mhz) && mhz > 0) {
        out.push({ label: `cpu${i} clock`, value: `${(mhz / 1000).toFixed(2)} GHz`, kind: "frequency" });
      }
    });
  }
  return out;
}

/** GPU stats, when the NVIDIA tools are installed. */
export async function gpus(): Promise<GpuStats[]> {
  const text = await sh("nvidia-smi", [
    "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
    "--format=csv,noheader,nounits",
  ], 3000);
  if (!text) return [];
  return text.trim().split("\n").filter(Boolean).map((line) => {
    const [name, utilization, used, total, temperature, power] = line.split(",").map((v) => v.trim());
    return {
      name,
      utilization: Number(utilization) / 100,
      memoryUsed: Number(used) * 1024 ** 2,
      memoryTotal: Number(total) * 1024 ** 2,
      temperature: Number(temperature),
      power: Number(power),
    };
  });
}

/** Battery and AC state from /sys/class/power_supply. */
export async function power(): Promise<PowerStats | null> {
  try {
    const supplies = await readdir("/sys/class/power_supply");
    let battery: PowerStats | null = null;
    let acConnected = false;

    for (const supply of supplies) {
      const base = `/sys/class/power_supply/${supply}`;
      const type = (await read(`${base}/type`)).trim();
      if (type === "Mains") {
        acConnected = (await read(`${base}/online`)).trim() === "1";
        continue;
      }
      if (type !== "Battery") continue;
      const capacity = Number((await read(`${base}/capacity`)).trim());
      const status = (await read(`${base}/status`)).trim();
      const currentNow = Number((await read(`${base}/current_now`)).trim());
      const voltageNow = Number((await read(`${base}/voltage_now`)).trim());
      battery = {
        battery: Number.isFinite(capacity) ? capacity : 0,
        charging: status === "Charging",
        timeRemaining: status,
        powerDraw: Number.isFinite(currentNow * voltageNow) ? (currentNow * voltageNow) / 1e12 : 0,
        acConnected,
      };
    }
    if (battery) battery.acConnected = acConnected;
    return battery;
  } catch {
    return null;
  }
}

const LEVELS = ["EMERG", "ALERT", "CRIT", "ERROR", "WARN", "NOTICE", "INFO", "DEBUG"];

/** Recent journald entries, falling back to syslog and then dmesg. */
export async function journal(limit = 60): Promise<JournalEntry[]> {
  const text = await sh("journalctl", [
    "-n", String(limit), "--no-pager", "--output=json", "--output-fields=MESSAGE,PRIORITY,_SYSTEMD_UNIT,SYSLOG_IDENTIFIER",
  ], 5000);

  if (text) {
    const entries: JournalEntry[] = [];
    for (const line of text.trim().split("\n")) {
      if (!line.startsWith("{")) continue;
      try {
        const row = JSON.parse(line) as Record<string, string>;
        const micros = Number(row.__REALTIME_TIMESTAMP ?? 0);
        const time = micros
          ? new Date(micros / 1000).toTimeString().slice(0, 8)
          : new Date().toTimeString().slice(0, 8);
        entries.push({
          time,
          level: LEVELS[Number(row.PRIORITY ?? 6)] ?? "INFO",
          unit: (row._SYSTEMD_UNIT ?? row.SYSLOG_IDENTIFIER ?? "-").replace(/\.service$/, ""),
          message: String(row.MESSAGE ?? "").slice(0, 200),
        });
      } catch {
        // Skip malformed lines rather than losing the whole log.
      }
    }
    if (entries.length) return entries;
  }

  for (const path of ["/var/log/syslog", "/var/log/messages"]) {
    const raw = await read(path);
    if (!raw) continue;
    return raw.trim().split("\n").slice(-limit).map((line) => {
      const match = /^(\w+\s+\d+\s+[\d:]+)\s+\S+\s+([^:[]+)/.exec(line);
      return {
        time: (match?.[1] ?? "").slice(-8),
        level: /error|fail/i.test(line) ? "ERROR" : /warn/i.test(line) ? "WARN" : "INFO",
        unit: (match?.[2] ?? "system").trim(),
        message: line.slice(match?.[0]?.length ?? 0).replace(/^[:\s]+/, "").slice(0, 200),
      };
    });
  }

  const dmesg = await sh("dmesg", ["--time-format", "iso", "-l", "err,warn,info"], 3000);
  if (!dmesg) return [];
  return dmesg.trim().split("\n").slice(-limit).map((line) => ({
    time: (/T(\d{2}:\d{2}:\d{2})/.exec(line)?.[1]) ?? "",
    level: /error/i.test(line) ? "ERROR" : /warn/i.test(line) ? "WARN" : "INFO",
    unit: "kernel",
    message: line.replace(/^\S+\s+/, "").slice(0, 200),
  }));
}

/** Process counts by state, straight from /proc. */
export async function processStates(): Promise<ProcessStates> {
  const text = await sh("ps", ["-eo", "state", "--no-headers"]);
  const states: ProcessStates = { running: 0, sleeping: 0, stopped: 0, zombie: 0, total: 0 };
  if (!text) return states;
  for (const raw of text.trim().split("\n")) {
    const state = raw.trim()[0];
    states.total++;
    if (state === "R") states.running++;
    else if (state === "S" || state === "D" || state === "I") states.sleeping++;
    else if (state === "T" || state === "t") states.stopped++;
    else if (state === "Z") states.zombie++;
  }
  return states;
}

export type { Telemetry };
