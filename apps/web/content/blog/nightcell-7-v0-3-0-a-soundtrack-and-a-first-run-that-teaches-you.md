---
title: "NIGHTCELL 7 v0.3.0: a soundtrack, and a first run that teaches you"
date: "2026-09-23"
description: "NIGHTCELL 7 v0.3.0 adds a 20-track album by Þrøngva, a first-run briefing and a coach that teaches each control when you do it."
canonical: "https://dev.profullstack.com/~anthony/blog/182-post.html"
author: Anthony Ettinger
---

NIGHTCELL 7 v0.3.0 is out. The game has a soundtrack now: *After the Winter of Want* by Þrøngva, twenty tracks of our own music. New players also get a proper first run, with a briefing that tells you whose side you are on and a coach that teaches the controls one at a time.

## Who this is for

Anyone playing the free sandbox, in the browser or on the desktop client. Nothing here costs money.

## What changed

- **A 20-track album.** *After the Winter of Want* by Þrøngva plays shuffled in the yard, one track after another. It is our own music, made for the game, not licensed from anyone. The tracks stream when they are needed, so they add nothing to the download you wait for before your first match.
- **A briefing on the deploy gate.** The first time you play, the gate tells you which side you are deploying with and whose story it belongs to: the NIGHTCELL program Rook runs, or the service Leila serves. It explains that the yard is squad Team Deathmatch against bots, while the campaigns are one-person stories.
- **A coach for the controls.** Once you deploy, a coach walks you through nine controls in order: move, look, sprint, crouch, jump, fire, reload, switch weapons, throw a frag. A step only completes when you actually do it, never on a timer, and dying pauses it instead of counting the respawn as progress. You can skip it, and it does not come back once you have finished or skipped it.
- **A cast page.** [nightcell7.com/characters](https://nightcell7.com/characters) introduces the two protagonists and the institutions behind them, from the same data the in-game briefing uses.
- **Music that plays in every browser.** The file server behind the game never decoded URLs, so any file with a space or an accented letter in its name was answered with a web page instead. It now decodes paths and answers byte-range requests, which Safari needs before it will play audio at all.
- **More ways to install.** Releases now reach Homebrew, Scoop and the AUR on their own, and are submitted to WinGet, where the first version is waiting for Microsoft's review.

## How to use it

Open [nightcell7.com/play](https://nightcell7.com/play). The briefing and coach appear on your first run. Turn your volume up in the yard for the album. The desktop builds for macOS, Windows and Linux are at [nightcell7.com/downloads](https://nightcell7.com/downloads), along with the one-line Homebrew, Scoop and AUR installs (`yay -S nightcell7-bin` on Arch).

https://github.com/profullstack/nightcell7/releases/tag/v0.3.0
