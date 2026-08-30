import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * hwmon parsing cannot be exercised on a machine with no sensors, and every
 * virtual machine is such a machine. These tests build a fake sysfs tree so the
 * layout is covered on hardware nobody here has.
 */

const root = mkdtempSync(join(tmpdir(), "hqtui-sysfs-"));

function write(path: string, contents: string): void {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, contents);
}

// A laptop-shaped tree: coretemp with labelled cores, a fan, a voltage rail
// and a power reading, plus an older chip that keeps its inputs in device/.
write("sys/class/hwmon/hwmon0/name", "coretemp\n");
write("sys/class/hwmon/hwmon0/temp1_input", "52000\n");
write("sys/class/hwmon/hwmon0/temp1_label", "Package id 0\n");
write("sys/class/hwmon/hwmon0/temp1_crit", "100000\n");
write("sys/class/hwmon/hwmon0/temp2_input", "49000\n");
write("sys/class/hwmon/hwmon0/temp2_label", "Core 0\n");
// Out of range readings are rejected rather than drawn as a 900 degree core.
write("sys/class/hwmon/hwmon0/temp3_input", "900000\n");
write("sys/class/hwmon/hwmon0/temp4_input", "0\n");

write("sys/class/hwmon/hwmon1/name", "nct6775\n");
write("sys/class/hwmon/hwmon1/fan1_input", "2140\n");
write("sys/class/hwmon/hwmon1/fan1_label", "CPU Fan\n");
write("sys/class/hwmon/hwmon1/fan2_input", "0\n");
write("sys/class/hwmon/hwmon1/in0_input", "1104\n");
write("sys/class/hwmon/hwmon1/in0_label", "Vcore\n");
write("sys/class/hwmon/hwmon1/power1_average", "14300000\n");
write("sys/class/hwmon/hwmon1/curr1_input", "2500\n");

write("sys/class/hwmon/hwmon2/name", "legacy\n");
write("sys/class/hwmon/hwmon2/device/temp1_input", "41000\n");

write("sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq", "2900000\n");
write("sys/devices/system/cpu/cpu1/cpufreq/scaling_cur_freq", "3100000\n");

process.env.HQTUI_SYSFS_ROOT = join(root, "sys").replace(/\/sys$/, "");

const telemetry = await import("../src/system/linux-telemetry.ts");

test("temperatures are read from hwmon with their labels", async () => {
  const temps = await telemetry.temperatures();
  const labels = temps.map((t) => t.label);
  assert.ok(labels.includes("Package id 0"), `got ${labels.join(", ")}`);
  assert.ok(labels.includes("Core 0"));
  assert.equal(temps.find((t) => t.label === "Package id 0")?.value, 52);
});

test("the critical temperature becomes the bar maximum", async () => {
  const temps = await telemetry.temperatures();
  assert.equal(temps.find((t) => t.label === "Package id 0")?.max, 100);
  // No crit file: fall back to 100 rather than dividing by zero.
  assert.equal(temps.find((t) => t.label === "Core 0")?.max, 100);
});

test("implausible readings are dropped", async () => {
  const temps = await telemetry.temperatures();
  assert.ok(temps.every((t) => t.value > 0 && t.value <= 150));
});

test("the older device/ layout is still found", async () => {
  const temps = await telemetry.temperatures();
  assert.ok(temps.some((t) => t.value === 41), "expected the legacy chip's 41C");
});

test("fans, voltages, power and current are read independently of temperature", async () => {
  const sensors = await telemetry.hardwareSensors();
  const byLabel = new Map(sensors.map((s) => [s.label, s.value]));
  assert.equal(byLabel.get("CPU Fan"), "2140 RPM");
  assert.equal(byLabel.get("Vcore"), "1.10 V");
  assert.ok([...byLabel.values()].includes("14.3 W"), "expected the power reading");
  assert.ok([...byLabel.values()].includes("2.50 A"), "expected the current reading");
});

test("a stopped fan is not reported as a sensor", async () => {
  const sensors = await telemetry.hardwareSensors();
  assert.ok(!sensors.some((s) => s.value === "0 RPM"));
});

test("cpu clock speeds come from cpufreq", async () => {
  const clocks = await telemetry.cpuFrequencies();
  assert.equal(clocks[0]?.value, "2.90 GHz");
  assert.equal(clocks[1]?.value, "3.10 GHz");
  assert.ok(clocks.every((c) => c.kind === "frequency"));
});

test("cleanup", () => {
  rmSync(root, { recursive: true, force: true });
});
