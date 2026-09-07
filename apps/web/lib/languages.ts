export type Language = {
  name: string;
  id: string;
  description: string;
  href: string;
  /** Runnable full demo; see the docs for each port's parity status. */
  demo: string;
  /** Interactive ten-screen demo. Native demos default to live Linux metrics. */
  interactiveDemo: string;
  snapshotDemo?: string;
  /** Same latest-source demo with a pinned mise-managed toolchain. */
  miseDemo: string;
  native: boolean;
  binding?: boolean;
};

/** Optional developer checkout; public demo commands do not require it. */
export const CLONE = "git clone https://github.com/profullstack/hqtui";
export const LAUNCHER = "https://hqtui.com/demo.sh";
export function latestDemo(language: string, mise = false): string {
  if (!["typescript", "rust", "go", "python", "zig", "cpp", "ruby", "php", "perl"].includes(language)) throw new Error("Unsupported demo language");
  return `curl -fsSL ${LAUNCHER} | sh -s -- --${mise ? "mise" : "system"} ${language}`;
}

export const LANGUAGES: readonly Language[] = [
  ...([['Ruby', 'ruby'], ['PHP', 'php'], ['Perl', 'perl']] as const).map(([name, id]) => ({
    name, id, href: `/docs#${id}`,
    description: `${name} bindings with a batched widget API. The shared C/C++ demo engine runs inside your language runtime; not an independent port.`,
    demo: latestDemo(id), interactiveDemo: latestDemo(id),
    snapshotDemo: `${latestDemo(id)} --snapshot`, miseDemo: latestDemo(id, true),
    native: true, binding: true,
  })),
  {
    name: "C++",
    id: "cpp",
    description: "Native C++17 demo over the shared C renderer. Experimental library API; requires GCC/Clang and CMake.",
    href: "/docs#cpp",
    demo: latestDemo("cpp"),
    snapshotDemo: `${latestDemo("cpp")} --snapshot`,
    interactiveDemo: latestDemo("cpp"),
    miseDemo: latestDemo("cpp", true),
    native: true,
  },
  {
    name: "TypeScript",
    id: "typescript",
    description: "The reference implementation. Runs on Bun, Node and Deno.",
    href: "/docs#install",
    demo: latestDemo("typescript"),
    interactiveDemo: `${latestDemo("typescript")} --sim`,
    miseDemo: `${latestDemo("typescript", true)} --sim`,
    native: false,
  },
  {
    name: "Rust",
    id: "rust",
    description: "Native Rust with explicit ownership and interaction IDs.",
    href: "/docs#rust",
    demo: latestDemo("rust"),
    snapshotDemo: `${latestDemo("rust")} --snapshot`,
    interactiveDemo: latestDemo("rust"),
    miseDemo: latestDemo("rust", true),
    native: true,
  },
  {
    name: "Go",
    id: "go",
    description: "Native Go with callbacks that close over your application state.",
    href: "/docs#go",
    demo: latestDemo("go"),
    snapshotDemo: `${latestDemo("go")} --snapshot`,
    interactiveDemo: latestDemo("go"),
    miseDemo: latestDemo("go", true),
    native: true,
  },
  {
    name: "Python",
    id: "python",
    description: "Native Python with callbacks and compact array-backed cell storage.",
    href: "/docs#python",
    demo: latestDemo("python"),
    snapshotDemo: `${latestDemo("python")} --snapshot`,
    interactiveDemo: latestDemo("python"),
    miseDemo: latestDemo("python", true),
    native: true,
  },
  {
    name: "Zig",
    id: "zig",
    description: "Native Zig 0.16 with explicit context and arena-managed frames.",
    href: "/docs#zig",
    demo: latestDemo("zig"),
    snapshotDemo: `${latestDemo("zig")} --snapshot`,
    interactiveDemo: latestDemo("zig"),
    miseDemo: latestDemo("zig", true),
    native: true,
  },
];

/**
 * The native ports, derived rather than listed again. The docs and the homepage
 * showed the same commands from two arrays before this, which is one edit away
 * from telling visitors two different things.
 */
export const PORTS: readonly Language[] = LANGUAGES.filter((language) => language.native);
