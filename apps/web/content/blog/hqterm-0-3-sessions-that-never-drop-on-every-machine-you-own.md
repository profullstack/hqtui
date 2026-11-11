---
title: "hqterm 0.3: sessions that never drop, on every machine you own"
date: "2026-11-11"
description: "hqterm 0.3: persistent, shareable terminal sessions over plain ssh that survive sleep and network changes, with Linux, macOS and Windows hosts and Tailscale built in."
canonical: "https://dev.profullstack.com/~anthony/blog/225-post.html"
author: Anthony Ettinger
---

I close my laptop on one network and open it on another all day. mosh kept my shell alive through that, but it drops every image, and I live in terminal apps that draw them. tmux keeps sessions but makes me reattach by hand. So we built hqterm.

## What it does

`hqterm` lists your hosts (from `~/.ssh/config`, ones you add, and your Tailscale machines) and their sessions. Click one and you are in. Under it, `hqsh` keeps the session alive on the host and reconnects on its own when the network comes back. It replays exactly the output you missed: no gaps, no repeats.

It rides on plain ssh, so your keys, agent, ProxyJump and known_hosts all just work. There is no new port and no UDP to open.

## New in 0.3

- **Real services on every OS.** On Linux each session is a systemd user unit (`hqsh-main.service`), with lingering on so it survives logout. On macOS it is a launchd job. Windows hosts work too: sessions run on ConPTY, started outside the ssh connection's job so a disconnect does not kill them.
- **Tailscale, when you have it.** If the host is on your tailnet, hqsh connects over it and falls back to the normal route if that fails. Your ssh config still decides the user, port and keys.
- **A Windows installer.** `irm https://hqterm.sh/install.ps1 | iex`, no admin rights.
- **Shared sessions.** Attach from two machines at once, let someone watch with `--read-only`, or take a session over with `--steal`.

## Try it

```
curl -fsSL https://hqterm.sh/install | sh                    # your machine
curl -fsSL https://hqterm.sh/install | sh -s -- --server     # each server
hqterm
```

There is also a desktop app for Linux, with tabs, split panes that reattach on launch, and full images and HD emoji: `hqterm desktop`.

Everything else is in the docs: https://hqterm.sh/docs

hqterm and hqsh are free and MIT-licensed: https://github.com/profullstack/hqterm
