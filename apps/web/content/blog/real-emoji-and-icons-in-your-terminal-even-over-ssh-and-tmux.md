---
title: "Real emoji and icons in your terminal, even over SSH and tmux"
date: "2026-11-11"
description: "qc and hqtui 0.9.0 draw our OpenEmoji and OpenIcon artwork as real images in Kitty and Ghostty, even over SSH and tmux."
canonical: "https://dev.profullstack.com/~anthony/blog/228-post.html"
author: Anthony Ettinger
---

Terminal apps have always drawn emoji with whatever font the terminal happens to have. Our chat client for qrypt.chat, `qc`, now draws our own OpenEmoji and OpenIcon artwork as actual images, in color and at full resolution, right inside the chat.

It works in Kitty and Ghostty, and it keeps working when you SSH into a server and run `qc` inside tmux. That last part is the hard one.

## How it works

A full-screen terminal app redraws constantly, and an image written straight to the screen gets wiped the moment the text under it changes. So we used the Kitty graphics protocol's Unicode placeholders instead:

1. Each PNG goes to the terminal once, under a small numeric id.
2. The app then prints a special placeholder character in the cells where the image belongs, colored with that id.
3. The terminal paints the image wherever those characters appear.

Because the placeholders are ordinary characters, everything a TUI already does keeps working: redraws, scrolling, clipping, resizing. tmux only has to pass the one-time upload through to your terminal (`set -g allow-passthrough on`), and it keeps the placeholders in its own screen like any other text.

## Try it

```
npm i -g @profullstack/qryptchat
qc login
qc
```

In Kitty or Ghostty it turns on by itself. Over SSH or inside tmux, start it with `QC_HD=1 qc`. Everywhere else you get the normal emoji characters, so nothing breaks.

## Use it in your own TUI

The image layer lives in hqtui 0.9.0, our immediate-mode TUI library, so any hqtui app can use it:

```ts
import { createImageStore, drawRichText, drawIcon } from "@profullstack/hqtui";

const images = createImageStore({
  write: (s) => app.terminal.write(s),
  onReady: () => app.invalidate(),
});

// inside a draw callback
drawRichText(surface, x, y, "ship it 🚀", { fg }, images);
drawIcon(surface, x, y, "lock", images, "🔒");
```

Images load lazily, show the plain character until they arrive, and are cached on disk after the first fetch. `HQTUI_IMAGES=1` turns it on where the terminal cannot be detected, and `HQTUI_IMAGES=0` turns it off.

The same release fixed a long-standing color bug: an explicit 256-color palette entry used to come out as a dark blue in truecolor terminals. It is now sent as the palette index it is.

Links:

- hqtui 0.9.0: https://github.com/profullstack/hqtui/releases/tag/v0.9.0
- qc and qrypt.chat 0.5.5: https://github.com/profullstack/qryptchat-web/releases/tag/v0.5.5
- qrypt.chat: https://qrypt.chat
