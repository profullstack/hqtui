---
title: "qc: qrypt.chat in your terminal"
date: "2026-11-11"
description: "qrypt.chat's terminal client: a post-quantum chat app, a CLI and an MCP server in one command, plus our own emoji picker."
canonical: "https://dev.profullstack.com/~anthony/blog/217-post.html"
author: Anthony Ettinger
---

qrypt.chat has a terminal client now. Install it and run one command:

```sh
npm install -g @profullstack/qryptchat
qc
```

The first run opens your browser to sign in. After that you get a full-screen chat app: your chats down the left with unread counts, the conversation on the right, typing indicators, and a live badge that tells you when the stream drops. It is built on hqtui, so the mouse works too. One click opens a chat and the wheel scrolls.

## Encryption stays on your machine

qc uses the same ML-KEM-1024 code as the web app. Every message is encrypted once per person in the chat, on the machine running qc, so the server only ever stores ciphertext.

Getting your keys into a terminal was the interesting part. `qc login` generates a one-time ML-KEM-1024 key and opens qrypt.chat with it. You approve in the browser, and the browser seals your keys to that one-time key before anything leaves the page. Both sides show the same confirmation code, so you can tell the browser is approving your terminal and not someone else's. The sign-in itself is OAuth 2.1 with PKCE, and qc gets a session of its own rather than a copy of the browser's. Over SSH, `qc login --oob` gives you a code to paste instead.

## Scripts and agents

The same command does more than the chat screen:

```sh
qc chats
qc read alice -n 20
qc send ops "deploy done"
qc listen --json
```

`qc mcp` runs it as an MCP server with three tools: list your chats, read one, send a message. An agent can talk in an encrypted chat without the server ever seeing the words.

## Emoji, ours

Ctrl+E opens an emoji picker drawn with OpenEmoji, our own set of all 3,963 emoji. You can search it, it remembers your recent picks, and `:rocket:` works when you type it. The picker went into hqtui 0.8.0 as a widget any TUI can use. The same set is in the qrypt.chat web composer, and it is on by default in tsbb 0.8.0, where every post box gets a picker and every post draws its emoji with the set.

qc is MIT licensed and lives in the qrypt.chat repo on GitHub.
