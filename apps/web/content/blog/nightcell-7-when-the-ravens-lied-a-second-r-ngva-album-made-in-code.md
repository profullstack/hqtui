---
title: "NIGHTCELL 7: When the Ravens Lied, a second Þrøngva album made in code"
date: "2026-09-23"
description: "Twelve new Viking metal and hip-hop tracks for NIGHTCELL 7, every note synthesised from a lyric sheet by a numpy script."
canonical: "https://dev.profullstack.com/~anthony/blog/183-post.html"
author: Anthony Ettinger
---

NIGHTCELL 7 has a second soundtrack album: *When the Ravens Lied* by Þrøngva, twelve new tracks in the same drop-D Viking metal and hip-hop style as *After the Winter of Want*. They are in the game now, next to the first album's twenty.

## Who this is for

Anyone playing the free sandbox, in the browser or on the desktop client. Nothing here costs money.

## What the album is about

Odin sends two ravens out every morning and believes what they bring back. On this album somebody has taught them to lie. Forged smoke and forged voices tell two halls that the other one struck first, and a merchant sells spears to both sides. It is the game's MIRAGE plot told as a saga. No real country is named, and neither side is the villain: the lie is, and so is whoever profits from it. The last track, "True Dawn", answers the episode title, FALSE DAWN.

1. Huginn Brings the Word
2. Who Fired First
3. Loki's Mirror
4. Merchant of the Long Knife
5. Ledger of Ash
6. Heimdall Does Not Sleep
7. Same Rain on Both Shields
8. Lower the Spear
9. Muninn Remembers
10. Longship Bounce
11. Not Our Ragnarök
12. True Dawn

## How it was made

Every note is synthesised by a Python script with numpy and ffmpeg. Nothing is sampled, and no AI audio model or music service was used. The script reads a lyric sheet that gives each section a tempo and a direction ("male baritone half-rap, drop-D riff with pockets of silence") and arranges it. It plays a riff with the kick doubling the guitar, boom-bap or 808 drums on the hip-hop tracks, and choir, strings, tagelharpa, a throat-singing drone and horns. It also adds the wind, rain and ravens the sheet asks for.

The voice is the honest limit. It is formant synthesis, one note per syllable on that syllable's vowel, so it follows the rhythm of the lyrics without being words you can make out. The lyrics ship inside every MP3's tags, and the repo has paste-ready sheets for a sung version later.

Nobody listened to the first render, because the session that made it cannot hear. A spectrogram and an energy count showed 73% of the energy below 150 Hz, which is mud, so the mix was rebalanced before all twelve tracks were rendered. Each one is a 320 kbps, 48 kHz MP3 at about -10 LUFS.

## How to use it

Open [nightcell7.com/play](https://nightcell7.com/play) and turn your volume up in the yard. Both albums play shuffled, one track after another, and stream as they are needed, so they add nothing to the download before your first match. The lyric sheet and the synthesiser are in the repo at [github.com/profullstack/nightcell7](https://github.com/profullstack/nightcell7/tree/main/docs/music/when-the-ravens-lied).
