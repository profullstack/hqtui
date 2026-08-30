import type { Collector, SystemSample } from "./types.ts";
import { createSystemSimulation, type SimulationOptions } from "../simulation.ts";

export type { Collector, SystemSample };

/** Wraps the deterministic simulation in the Collector interface. */
class SimulationCollector implements Collector {
  source = "simulated";
  unavailable: string[] = [];
  private simulation;

  constructor(options: SimulationOptions) {
    this.simulation = createSystemSimulation(options);
  }

  async refresh(dt: number): Promise<void> {
    this.simulation.update(dt);
  }

  current(): SystemSample {
    return this.simulation.current();
  }
}

export interface SourceOptions extends SimulationOptions {
  /** Read the real machine. Falls back to the simulation if unsupported. */
  real?: boolean;
}

/**
 * Real metrics on Linux, macOS and Windows; a deterministic simulation
 * everywhere else (and whenever `real` is off).
 */
export async function createCollector(options: SourceOptions = {}): Promise<Collector> {
  if (!options.real) return new SimulationCollector(options);

  try {
    if (process.platform === "linux") {
      const { LinuxCollector } = await import("./linux.ts");
      return new LinuxCollector();
    }
    if (process.platform === "darwin") {
      const { DarwinCollector } = await import("./darwin.ts");
      return new DarwinCollector();
    }
    if (process.platform === "win32") {
      const { WindowsCollector } = await import("./win32.ts");
      return new WindowsCollector();
    }
  } catch {
    // Fall through to the simulation rather than failing to start.
  }
  const fallback = new SimulationCollector(options);
  fallback.source = `simulated (${process.platform} not supported)`;
  return fallback;
}
