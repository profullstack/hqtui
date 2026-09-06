export const LANGUAGES = [
  { name: "TypeScript", id: "typescript", description: "The reference implementation. Runs on Bun, Node and Deno.", href: "/docs#install" },
  { name: "Rust", id: "rust", description: "Native Rust with explicit ownership and interaction IDs.", href: "/docs#rust" },
  { name: "Go", id: "go", description: "Native Go with callbacks that close over your application state.", href: "/docs#go" },
  { name: "Python", id: "python", description: "Native Python with callbacks and compact array-backed cell storage.", href: "/docs#python" },
  { name: "Zig", id: "zig", description: "Native Zig 0.16 with explicit context and arena-managed frames.", href: "/docs#zig" },
] as const;

export const PORTS = [
  { name: "Rust", id: "rust", command: "cargo run --example screenshot" },
  { name: "Go", id: "go", command: "go run ./examples/screenshot" },
  { name: "Python", id: "python", command: "python3 -m examples.screenshot" },
  { name: "Zig", id: "zig", command: "zig build run-screenshot" },
] as const;
