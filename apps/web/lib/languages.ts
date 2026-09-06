export type Language = {
  name: string;
  id: string;
  description: string;
  href: string;
  /**
   * A runnable demo, exactly as it should be pasted. Every one of these renders
   * the reference dashboard, and every one is checked by hand before it ships —
   * a copy button makes a wrong command worse, not better.
   */
  demo: string;
  /** Whether `demo` assumes {@link CLONE} has been run first. */
  needsCheckout: boolean;
};

/** The four native ports run from a checkout; nothing is published yet. */
export const CLONE = "git clone https://github.com/profullstack/hqtui";

export const LANGUAGES: readonly Language[] = [
  {
    name: "TypeScript",
    id: "typescript",
    description: "The reference implementation. Runs on Bun, Node and Deno.",
    href: "/docs#install",
    demo: "bunx @profullstack/hqtui-demo",
    needsCheckout: false,
  },
  {
    name: "Rust",
    id: "rust",
    description: "Native Rust with explicit ownership and interaction IDs.",
    href: "/docs#rust",
    demo: "cd hqtui/ports/rust\ncargo run --example screenshot",
    needsCheckout: true,
  },
  {
    name: "Go",
    id: "go",
    description: "Native Go with callbacks that close over your application state.",
    href: "/docs#go",
    demo: "cd hqtui/ports/go\ngo run ./examples/screenshot",
    needsCheckout: true,
  },
  {
    name: "Python",
    id: "python",
    description: "Native Python with callbacks and compact array-backed cell storage.",
    href: "/docs#python",
    demo: "cd hqtui/ports/python\npython3 -m examples.screenshot",
    needsCheckout: true,
  },
  {
    name: "Zig",
    id: "zig",
    description: "Native Zig 0.16 with explicit context and arena-managed frames.",
    href: "/docs#zig",
    demo: "cd hqtui/ports/zig\nzig build run-screenshot",
    needsCheckout: true,
  },
];

/**
 * The native ports, derived rather than listed again. The docs and the homepage
 * showed the same commands from two arrays before this, which is one edit away
 * from telling visitors two different things.
 */
export const PORTS: readonly Language[] = LANGUAGES.filter((language) => language.needsCheckout);
