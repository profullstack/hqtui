---
title: readm3 is now a plain text editor
date: "2026-11-11"
description: "readm3.com is now a plain, Sublime-style text editor: multiple cursors, find and replace, Ctrl+P, a command palette, save back to disk, offline, and a Linux desktop app as Flatpak and AppImage."
canonical: "https://dev.profullstack.com/~anthony/blog/251-post.html"
author: Anthony Ettinger
---

I wanted Sublime Text without the plugin ecosystem, the license nag or the settings files. Just a quick window that opens a folder, lets me fix things, and saves. So readm3, which started as a terminal Markdown reader, now does that at [readm3.com/viewer](https://readm3.com/viewer).

## What it does

- **Editing that feels right.** Line numbers, syntax colors for about a hundred languages, multiple cursors (Ctrl+click, Ctrl+D for the next match, Alt+drag for a column), find and replace, folding, bracket matching, Ctrl+/ to comment.
- **Ctrl+P** to jump to any file by typing a few letters of its path, and **Ctrl+Shift+P** for every command: open, save, word wrap, the sidebar, any of the nine themes.
- **Real files.** In Chrome, Edge or the installed app, Open folder works on the files themselves. Ctrl+S writes the change back to disk, and a dot marks a file you have not saved yet. Firefox and Safari open a copy and Ctrl+S downloads it.
- **Offline.** Every grammar loads the first time you need it and is cached, so after one visit the whole editor works with no connection.

Code opens straight into the editor. Markdown still opens rendered, the way readm3 always has, and `e` edits it.

## On the desktop

There is a Linux desktop app too, on the [release page](https://github.com/profullstack/readm3/releases/latest): a Flatpak and an AppImage. Run `readm3-desktop notes.md src/app.ts` and the files open as tabs; Ctrl+S saves them back. Or install it with the CLI in one line:

```sh
curl -fsSL https://readm3.com/install.sh | sh -s -- --desktop
```

Prefer the Flatpak on Ubuntu 24.04 and newer. AppArmor there stops an AppImage from using Chromium's sandbox, so the AppImage starts without one and tells you so.

It is MIT licensed and the code is on [GitHub](https://github.com/profullstack/readm3).
