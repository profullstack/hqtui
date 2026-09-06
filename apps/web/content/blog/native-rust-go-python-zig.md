---
title: HQTUI now speaks Rust, Go, Python and Zig
date: 2026-09-06
description: Four native implementations join TypeScript, with standard-library-only runtimes and shared fixtures that check rendering cell for cell.
author: Profullstack
---

HQTUI now has native implementations in **Rust, Go, Python and Zig**, alongside the TypeScript reference. [PR #35](https://github.com/profullstack/hqtui/pull/35) merged all four ports on September 6. Each includes a terminal layer, app loop, builder API, widgets, themes, input handling and a headless renderer for testing.

The ports run in their own languages. They require no Node runtime, and their runtime dependencies are limited to each language's standard library.

## Pick your language

- [TypeScript](/docs#install): the reference implementation, running on Bun, Node and Deno.
- [Rust](/docs#rust): explicit ownership, with interaction IDs that let your app handle control events.
- [Go](/docs#go): callbacks that close over application state, with pointers for optional values.
- [Python](/docs#python): callbacks and compact arrays for the framebuffer's cell planes.
- [Zig](/docs#zig): explicit context pointers and two frame/event arenas. Requires Zig 0.16.

The [language setup guide](/docs#languages) has commands to run a dashboard from each port's source directory. Each also includes a minimal hello example and an interactive dashboard. The existing TypeScript package remains available as `@profullstack/hqtui` on npm.

## The same screen, checked across languages

The [shared conformance corpus](https://github.com/profullstack/hqtui/tree/main/ports/conformance) records expected output from the TypeScript implementation. Each port replays those fixtures and checks cells, colors and escape bytes.

The corpus covers thirteen groups, including Unicode widths, layout, framebuffer writes, diff encoding, themes, borders, Braille rasterization and input parsing. It includes 53 widget scenes and 10 complete screen layouts. Testing the complete layout catches errors that an individually sized widget cannot reveal.

All four ports include a screenshot example that renders the same dashboard, apart from its port label, without requiring an interactive terminal.

## What carries over, and what differs

The rendering model carries across languages: describe the screen, compute layout, draw into a framebuffer and emit the changes. Your application still owns its state.

Interaction and terminal handling follow each language's facilities. Rust and Zig report interactions through IDs; Go and Python offer callbacks. Platform support and terminal setup differ by port. For example, Rust uses the system `stty` command to manage terminal modes. The individual READMEs document these details and show the idiomatic API.

The [port roadmap](https://github.com/profullstack/hqtui/blob/main/ports/TARGETS.md) identifies C as the next candidate. C is planned; the implementations available now are TypeScript, Rust, Go, Python and Zig.

[Choose your language](/docs#languages), explore the [source](https://github.com/profullstack/hqtui/tree/main/ports), or discuss what you are building on the [HQTUI board](https://bbs.hqtui.com/).
