---
title: "TUI Weekly: The Terminal Is the Product: Profullstack’s TUI Releases"
date: "2026-11-13"
description: "Profullstack publishes this show, and this week’s lineup includes our own terminal tools. We compare the workflows that benefit from a TUI with the ones that work better as commands, scripts, or persistent SSH sessions."
canonical: "https://tuiweekly.bl0ggers.com/blog/2026-11-11-terminal-roundup-f"
author: Anthony Ettinger
---

Profullstack publishes this show, so let’s say it plainly at the start: these are our own products. This week’s releases include tools with terminal interfaces, tools built around terminal work, and products that pair a TUI with a CLI, API, desktop app, or agent interface. The listings are on pwamart.com/publishers/profullstack: https://pwamart.com/publishers/profullstack. The useful question isn’t whether a product has a TUI. It’s what the terminal lets someone see or do more clearly.

## When the screen is the workflow

HQTUI is a TypeScript library for building terminal interfaces. Its pitch is btop-grade dashboards, a one-import API, dark by default, and zero runtime dependencies. Its site also describes implementations in Rust, Go, Python, and Zig. That’s the building block; the more interesting question is where an interface earns its space. https://hqtui.com/?utm_source=gitblog&utm_medium=blog&utm_campaign=launch-announcement

ThreatCrush describes real-time threat feeds, vulnerability tracking, attack surface monitoring, and threat actor intelligence, with a CLI, TUI dashboard, and desktop app. For monitoring, a screen that keeps several signals visible can make sense. But Rootkey would ask what the dashboard reveals about each alert: where it came from, what it can access, and what action is being proposed. The record names the monitoring surfaces; it doesn’t establish how every alert is validated. https://threatcrush.com/

LogicSRC has a different kind of terminal job. It describes open standards and schemas for human and AI agent coordination. Its TUI has panes for live transcripts, policy events, model use, evidence, and scorecards. A credential-sharing panel reviews key diffs, providers, approval prompts, fingerprints, and failure states without showing raw secrets. That’s a strong direction for an interface: make decisions and evidence visible, while keeping the sensitive value out of view. https://logicsrc.com/

Then there’s the work where a TUI is useful, but a command matters just as much. myna posts to social networks from the terminal. Its site describes timelines, mentions, engagement, and a history of what landed. The scheduler can send while the TUI is open, or `myna run` can run as a daemon. Each TUI slash command is also a subcommand, so the same work can go into a script or cron job. Cha0spunk’s audience question is practical: can someone start with one post, then keep the workflow when they need to automate it? https://mynaposter.com/

wx93 pairs short links, stats, QR codes, aliases, and an API with a CLI TUI and MCP server. Its site says OAuth 2.1 sign-in can happen from the terminal, and an agent with no account can pay per call using x402. It also says analytics count people and bots separately and never store IP addresses. That’s a lot of surfaces around a fairly concrete job: create links and inspect their use. https://wx93.me/

## Where the terminal belongs

Some terminal workflows are mostly about getting work done from wherever you are. P2P One, the c0mpute network, shows commands for submitting a transcode job or an inference chat, alongside an interactive `c0mpute tui` dashboard. That makes a useful comparison: commands express a specific job, while a dashboard can help when there’s more state to inspect. The product describes a network where people run jobs, sell unused compute, and pay only for verified work. https://c0mpute.com/

For telehealth and practice management, tleehealth lists a CLI and TUI alongside its API, MCP, PWA, and desktop surfaces. The examples include checking today’s schedule by location, inviting a provider, and exporting a monthly superbill as CSV. That’s concrete office work. Its site says agents have scoped roles and enter the same audit log as people; Rootkey would want the permission boundaries and audit trail to stay easy to understand from every surface. https://tleehealth.pwa.pit.world/

DiskPush’s TUI is attached to a risky kind of maintenance: cleaning up disk space. The site says its Cleaner rechecks guards as it goes, considers logs, build output in idle projects, and abandoned partial files, and only reports databases, backups, and volumes. It describes the clean command as a dry run unless `--apply` is used. Here, an interface that shows candidates and consequences can matter more than a flashy dashboard. The command should still be reviewable before it removes anything. https://diskpush.com/

readm3 makes a case for a small terminal reader beside the editor: it works with Markdown, sharing, and version history across browser, CLI, API, and MCP. The site says its terminal UI uses HQTUI and renders CommonMark and GFM. It also says the TUI is for reading and that `$EDITOR` remains the editor. That division feels sensible: use the terminal to read a document in context, and keep your preferred editing tool. https://readm3.com/

Other listings connect the terminal to continuity or a particular audience. HQTerm describes persistent terminal sessions over plain SSH that survive sleep and network changes and run across machines. moshcode puts coding-agent sessions on a phone, with one-tap approvals and a live terminal. tsbb has a terminal skin and `tsbb-tui` for reading and posting over SSH. QryptChat describes a terminal client with TUI, CLI, and MCP surfaces for its messaging product. https://hqterm.sh/index.html https://app.moshcode.sh/ https://tsbb.pwa.pit.world/ https://qrypt.chat/

The list keeps going: seo.rank offers a CLI and TUI for page audits, and family.ancestry lists an ancestry CLI and terminal UI alongside its other surfaces. deadman.switch lists a terminal check-in command and TUI for its crypto dead-man’s switch. Each is a different task; being terminal-accessible doesn’t make their trust or permission questions interchangeable. https://seo.rank.pit.world/ https://family.ancestry.pit.world/ https://deadman.switch.pit.world/

## A useful rule of thumb

Riotcoder’s technical test is whether a TUI makes live state easier to scan, compare, or act on. Cha0spunk’s is whether people can adopt it without getting trapped in a special interface when they need scripts, SSH, or a phone. Rootkey’s is whether permissions, evidence, and consequences stay visible where the action happens. A good terminal workflow might be a dashboard, a single command, or a persistent session. The right shape depends on the task.

### Sponsors

HQTerm keeps SSH sessions alive across disconnects and preserves terminal escape sequences and images. HQTUI is a TypeScript library for building terminal interfaces.

## Sponsors

This episode is supported by [HQTerm](https://hqterm.sh), which keeps SSH sessions alive across disconnects and preserves terminal escape sequences and images, and HQTUI, a TypeScript library for building terminal interfaces ([HQTUI](https://hqtui.com/?utm_source=gitblog&utm_medium=blog&utm_campaign=launch-announcement)). Sponsor messages are separate from the editorial coverage.

This is from [TUI Weekly](https://tuiweekly.bl0ggers.com/blog/2026-11-11-terminal-roundup-f), the weekly terminal roundup with a podcast episode.
