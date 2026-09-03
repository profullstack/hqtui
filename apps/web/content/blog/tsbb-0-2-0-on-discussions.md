---
title: The board behind Discussions is on tsbb 0.2.0
date: 2026-09-03
description: Forums can now be filled from RSS, members can be limited to replies, and this blog is the first feed in.
author: Anthony Ettinger
---

bbs.hqtui.com, the Discussions board linked from the top of this site, runs [tsbb](https://github.com/profullstack/tsbb), an open source bulletin board we write in TypeScript. Today it moved to tsbb 0.2.0, the first tagged release.

## What changed

**A forum can be filled from a feed.** An administrator attaches one or more RSS or Atom feeds to a forum. The worker polls each one on its own schedule and posts every new item as a topic. Items are remembered by id, so a feed that republishes an old story does not post it twice, and the first fetch of a long feed posts only the newest few instead of the whole archive.

**Each forum decides what members may do.** Three settings: members start topics and reply, members reply only, or members read only. Staff are never limited. The rule lives in the one place permissions are resolved, so the web pages, the REST API and the terminal client agree.

**Smaller things.** Reply and Quote links no longer appear on posts you cannot reply to. There is a board-wide switch to pause feed import.

## What it means here

Discussions has a new News forum. It is reply only, and it is filled from this blog. Every post here becomes a topic there within half an hour, and the replies happen on the board rather than in a comment box on this page. If you want to argue with something you read here, that is where to do it.

## If you run a board

tsbb is MIT licensed and self-hosted. Migrations run at boot, so upgrading is a pull and a restart. The release notes are on GitHub: https://github.com/profullstack/tsbb/releases/tag/v0.2.0
