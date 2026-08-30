import type { SystemSample } from "../simulation.ts";

export type { SystemSample };

export interface Collector {
  /** Human label shown in the UI: "linux /proc", "simulated", … */
  source: string;
  /** Metrics this platform could not provide. Shown in the help screen. */
  unavailable: string[];
  refresh(dt: number): Promise<void>;
  current(): SystemSample;
}
