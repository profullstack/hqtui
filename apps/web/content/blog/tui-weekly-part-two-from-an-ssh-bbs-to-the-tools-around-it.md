---
title: "TUI Weekly: Part Two: From an SSH BBS to the Tools Around It"
date: "2026-11-14"
description: "A tour of Profullstack’s own products, starting with AgentBBS over SSH and moving through search, feeds, messaging, remote control, and more. The question for each: does it need a terminal UI, a command, or an agent tool?"
canonical: "https://tuiweekly.bl0ggers.com/blog/2026-11-12-terminal-roundup-b"
author: Anthony Ettinger
---

Disclosure: Profullstack publishes this show, and every product discussed here is our own. This is part two of our own-apps episode. We’re staying with this installment’s products and asking a practical question: which ones deserve a terminal UI, which should stay a command or API, and which make more sense as an agent tool?

## Start with AgentBBS over SSH

[AgentBBS](https://bbs.profullstack.com/) is described as a 1980s-style bulletin board system reborn over SSH for humans and AI agents. Its listing names an arcade, IRC, Usenet, mail, git, a Linux pod, and a personal homepage. That combination makes it the most immediately legible terminal experience in this group: you connect to a place, not just a command that returns a result.

A BBS also invites a useful question about shared spaces. What should be easy to discover in a terminal, and what should remain private or permissioned? The listing gives us the ingredients, but not the access rules or implementation details, so those are questions for the discussion rather than claims about the product.

## Where should agent-facing surfaces live?

[vu1nz](https://vu1nz.com/) is listed as an open-source CI/CD workflow and software package supply-chain security scanner, with an offline feature and an HTTP MCP endpoint. The supplied record doesn’t specify a CLI or API. That distinction matters in a real workflow: a person investigating a build may want a command they can run beside the logs, while an agent may benefit from an MCP connection. We shouldn’t promise either workflow beyond the surface the listing confirms.

[r4ck](https://r4ck.dev/) is a server search engine built for agents. Here the listing is unusually explicit about surfaces: a `r4ck` command, an API at `https://r4ck.dev/api/v1`, and HTTP MCP at `https://r4ck.dev/mcp`. It also names W3BS as a package route. I’d ask whether a human needs a full-screen search UI, or whether a command that fits into a shell pipeline plus an agent interface covers the useful cases.

[NicheDB](https://nichedb.dev/) describes itself as an open, ever-growing database of real-time data: sources in, feeds out. Its record lists a `nichedb` command, an API at `https://nichedb.dev/api/v1`, and HTTP MCP at `https://nichedb.dev/mcp`. That’s a strong set of ways to connect, though the listing doesn’t tell us which sources or feed controls are available. In a terminal workflow, I’d want to inspect what a feed represents before wiring it into automation.

[airdpx](https://airdpx.com/) gives a model a screen, pointer, and keyboard to use a machine like a person. Its description says there’s no API, no scripts, and no software on the far side; the record doesn’t specify a CLI or MCP endpoint. That makes it a useful contrast with command-shaped tools: screen-and-input control can reach workflows that don’t expose an interface, but it also deserves careful discussion of scope and trust.

## Commands for concrete jobs

[CoinPay](https://coinpayportal.com/) is described as a non-custodial payment gateway for crypto e-commerce payments. The listing names a `coinpay` CLI distributed through W3BS; it doesn’t specify an API or MCP surface. [SMSHub](https://smshub.dev/) sends and receives SMS with multi-provider support for Twilio, Telnyx, and real SIM numbers. Its listing includes the `smshub-cli` command, an API at `https://smshub.dev/api/v1`, and authenticated HTTP MCP at `https://smshub.dev/api/mcp`. It also provides the stdio invocation `npx -y @profullstack/smshub mcp`. Payment and messaging are good places to ask what a command can safely do, what needs confirmation, and what an agent should see.

[MeshHook](https://meshhook.com/) is listed simply as webhook workflows; the record doesn’t specify CLI, API, or MCP details. [sh1pt](https://sh1pt.com/) describes building, promoting, scaling, and iterating across every store and channel, and lists a `sh1pt` command through W3BS. [W3BS](https://w3bs.org/) is for inspecting the open Web for humans, agents, and devices. Its listing includes a CLI installer, an API at `https://w3bs.org/api/v1`, and HTTP MCP at `https://w3bs.org/mcp`. [BufferOverride](https://bufferoverride.com/) describes version-aware technical answers with recorded provenance and independent verification; its listed surfaces are the `bo` command, an API at `https://bufferoverride.com/api/v1`, and HTTP MCP at `https://bufferoverride.com/mcp`.

## Close on the boundary cases

[group.call](https://group.call.pit.world/) is a party line for people and AI agents: make a room, get a four-digit code, and everyone dials one number. Its record has an installer but no command name. [PairUX](https://pairux.com/) describes open-source, real-time screen sharing with simultaneous remote mouse and keyboard control, plus a `pairux` command. [nixamp](https://nixamp.com/) is a Winamp-shaped player for your own files and a remote for a nixamp on another machine. Its listing gives a CLI, API, authenticated HTTP MCP, and desktop downloads for macOS, Windows, Linux AppImage, and Debian/Ubuntu.

[media2markdown](https://media2markdown.pwa.pit.world/) turns video, audio, or books into chaptered Markdown for AI; its record lists an API and an installer, but no command name or MCP endpoint. [auto.hacker](https://auto.hacker.pit.world/) is described as authorized, non-destructive website pentesting for sites whose ownership has been proven; the record doesn’t specify CLI, API, or MCP surfaces.

That’s the range: a social space over SSH, commands for focused jobs, agent-facing connections, and products whose listing leaves the surface open. Which of these deserves a terminal UI, which should be a command, and which belongs in an agent tool?

## Sponsors

HQTerm keeps SSH sessions alive across disconnects and preserves terminal escape sequences and images. HQTUI is a TypeScript library for building terminal interfaces. These are sponsors of the show, not producers of the products discussed above.

## Sponsors

This episode is supported by [HQTerm](https://hqterm.sh), which keeps SSH sessions alive across disconnects and preserves terminal escape sequences and images, and HQTUI, a TypeScript library for building terminal interfaces ([HQTUI](https://hqtui.com/?utm_source=gitblog&utm_medium=blog&utm_campaign=launch-announcement)). Sponsor messages are separate from the editorial coverage.

This is from [TUI Weekly](https://tuiweekly.bl0ggers.com/blog/2026-11-12-terminal-roundup-b), the weekly terminal roundup with a podcast episode.
