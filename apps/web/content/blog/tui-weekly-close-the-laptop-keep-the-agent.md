---
title: "TUI Weekly: Close the Laptop, Keep the Agent"
date: "2026-11-11"
description: "Phone terminals, web terminals that survive a reboot, one contract for where agent sessions open, and the tools that decide what your agent is allowed to do."
canonical: "https://tuiweekly.bl0ggers.com/blog/2026-11-11-terminal-roundup"
author: Anthony Ettinger
---

You start a coding agent, close the laptop and walk away. A good share of this week's terminal releases are built around what happens next: the agent stops to ask a question while you're nowhere near a keyboard. Here is what shipped, what each project says it does, and the questions we'd want answered first. These come from each project's README and package listing. We haven't installed or tested them.

## Terminals that follow you

**[Pocket Terminal 7.4.0](https://www.npmjs.com/package/pocket-terminal/v/7.4.0)** puts your computer's terminal on your phone. Per its README, it works from any network and keeps working with the laptop asleep and the lid closed. `npx pocket-terminal run claude` (or `codex`, `gemini`, any command) runs a session in your window and live on your phone. A Claude Code mode connects to the official hooks, so permission prompts reach your phone as Allow/Deny when you're away. The README says phone and computer talk directly, end-to-end encrypted, with no server to run and no account.

The pitch is clear, and so is the risk. An Allow button on a lock screen approves a code change you're reading on a five-inch display. Before installing, we'd want to know how a phone is paired and revoked, and what a paired phone can do besides answer prompts. The README also mentions opening `localhost:3000` and moving files.

**[Code Remote 0.3.15](https://www.npmjs.com/package/coderemote/v/0.3.15)** is the computer side of an iOS app. You get files, git, a shell that survives the phone sleeping, and an agent chat view for Claude Code and Codex. The trade-off is stated up front: traffic goes over a Microsoft Dev Tunnel, and the first run asks you to sign in with GitHub. Some teams will like that their existing identity can revoke access, and others won't want the extra party. The package has a `postinstall` script (a node-pty fix), so read it first. The license is AGPL-3.0-or-later.

**[westerm 0.4.3](https://www.npmjs.com/package/@pistacrab/westerm/v/0.4.3)** is a web terminal on `127.0.0.1:4317` whose sessions survive closing the window, restarting the program and rebooting. The README describes saving and restoring sessions (`westerm stop` saves every session), which is a different promise from a process that keeps running. The packaging is clean: zero dependencies and no install scripts, with every platform's binary bundled, for about 20 MB.

Also new: [Crow Term 0.1.0-alpha.6](https://www.npmjs.com/package/@andespindola/crow-term), a native terminal with persistent sessions, and [celeritty 1.3.2](https://www.npmjs.com/package/celeritty/v/1.3.2), a web terminal that uses alacritty_terminal compiled to WebAssembly and renders with WebGPU.

## Where agent sessions should open

**[@osdlc/agent-seat 0.7.3](https://www.npmjs.com/package/@osdlc/agent-seat/v/0.7.3)** is the most interesting library of the week. Tools that start agents for a person need to put each session somewhere visible. Agent Seat defines one contract across nine hosts (terminal, tmux, WezTerm, cmux, herdr, Orca, otty, VS Code, JetBrains) and five harnesses (claude, codex, cursor, pi, opencode), and any host runs any harness. Hosts support only the parts their app can do. Asking for a missing part raises an error naming the host and the part, "never a silent fallback to another host." That is the right default, because silent fallbacks are where surprises come from.

Others went the opposite way and built terminals for agents. [Termoil](https://github.com/Black-Rainbow-Labs/Termoil) is written from scratch in Rust, with 894 themes and an MCP server for agents. What that server exposes is the first thing we'd check. [t1k](https://github.com/erango/t1k) is a native macOS terminal for running many agents at once. [xscapes](https://github.com/donlucasx/xscapes) shows ASCII scenes that react to an agent's event stream.

## Who decides, and what it costs

**[mu 0.3.10](https://www.npmjs.com/package/mu-agent/v/0.3.10)**, built on pi, hands an agent's yes/no calls to a small judge model at 41 decision points: does this output matter, does this command need permission, is the work done. Each point can be `off`, `shadow` (asked and logged, not acted on) or `active`. Shadow mode is how anything that makes security decisions should be adopted: run it next to a human, compare the logs, then switch it on.

**[opencode-tui-usage 2.7.0](https://www.npmjs.com/package/opencode-tui-usage/v/2.7.0)** adds a sidebar with tokens, prompt cache, cost and sub-agent usage. It supports English and USD only, and says so.

**[trackfw 11.6.0](https://www.npmjs.com/package/trackfw/v/11.6.0)** traces every change through ADR, requirement and roadmap as plain Markdown in the repo, and checks the chain in pre-commit and CI. Its guard hooks block an agent's raw `git commit` and `git push` in favor of governed commands, and they flag credentials in tool payloads. It ships as one Go binary. Windows support is partial, per the README.

**[codechart 0.9.0](https://www.npmjs.com/package/codechart/v/0.9.0)** turns an agent's change summary into a diff-style map of what's new, changed and removed, which the README says is checked against your code. That check decides whether it's a review tool or just a prettier summary.

Licenses deserve a look before anything goes into a product. Code Remote is AGPL. [brito-cli 0.13.2](https://www.npmjs.com/package/brito-cli/v/0.13.2), a coding agent with a code knowledge graph and memory, is PolyForm Noncommercial. Crow Term points to its own LICENSE file.

## Lightning round

[splice-cli 0.1.0](https://www.npmjs.com/package/splice-cli/v/0.1.0) turns one JSON document into an ffmpeg render, and `splice doctor` checks your encoders first. [tonedial 0.1.15](https://www.npmjs.com/package/tonedial/v/0.1.15) gives your agent a personality across 12 tone axes. [document-cli 5.12.172](https://www.npmjs.com/package/document-cli/v/5.12.172) is an Ink TUI for converting between dozens of document formats. [express-terminal-monitor 1.0.6](https://www.npmjs.com/package/express-terminal-monitor/v/1.0.6) is a flicker-free latency dashboard in your terminal.

## Sponsors

This episode is supported by [HQTerm](https://hqterm.sh), which keeps SSH sessions alive across disconnects and preserves terminal escape sequences and images, and HQTUI, a TypeScript library for building terminal interfaces ([HQTUI](https://hqtui.com/?utm_source=gitblog&utm_medium=blog&utm_campaign=launch-announcement)). Sponsor messages are separate from the editorial coverage.

This is from [TUI Weekly](https://tuiweekly.bl0ggers.com/blog/2026-11-11-terminal-roundup), the weekly terminal roundup with a podcast episode.
