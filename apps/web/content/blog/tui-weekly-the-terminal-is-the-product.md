---
title: "TUI Weekly: The Terminal Is the Product"
date: "2026-11-11"
description: "SSH launchers, file browsers, keymap adapters, and document tools each solve a different part of working in a terminal. This week’s releases make a case for focused interfaces that fit the job."
canonical: "https://tuiweekly.bl0ggers.com/blog/2026-11-11-terminal-roundup-b"
author: Anthony Ettinger
---

## Start with the terminal workflow

This week’s TUI releases are easiest to understand as tools for different moments in terminal work. [sshub-tui 0.22.1](https://www.npmjs.com/package/sshub-tui/v/0.22.1) is described as a TUI launcher for SSH hosts. [opencode-file-browser 0.3.2](https://www.npmjs.com/package/opencode-file-browser/v/0.3.2) lets people browse folders and preview Markdown and code inside the OpenCode TUI. One helps choose a destination; the other puts files in view within a coding interface. They sit near each other in a terminal workflow, but they aren’t the same tool.

That distinction matters. A launcher is most useful at the point where you’re deciding where to connect. A file browser is useful when you’re already working in an interface and need to inspect a folder or read a file. The records don’t tell us how either behaves in a real session, so there’s no basis for comparing speed or claiming one reduces context switching. Still, the jobs are concrete enough to ask a good question: which step in your actual terminal routine has enough friction to deserve its own screen?

The search example points to another distinct job. [athenasearch-tui 1.0.38](https://www.npmjs.com/package/athenasearch-tui/v/1.0.38) is described as an alias for athena-tui, a terminal UI for Athena Search that takes browser bookmarks into its “brain.” That’s a route from saved web pages toward a searchable collection, not the same thing as browsing local project files. The useful comparison is about what you’re trying to find: a host, a file, or a bookmark.

## The interface also has an input layer

The [hjkl-keymap-tui 0.45.1](https://crates.io/crates/hjkl-keymap-tui) release describes itself as an adapter between Ratatui/crossterm KeyEvent and hjkl-keymap KeyEvent. That is a narrow boundary, and the narrowness is appealing: it gives a TUI a defined connection to a keymap library without pretending to be a whole navigation system. It also makes the practical question visible. Which keys should mean movement in this app, and how does that fit the framework’s input events?

[Tui-lipan-macro 0.41.0](https://crates.io/crates/tui-lipan-macro) takes a different route. It provides procedural macros for the tui-lipan TUI framework: ui!, rsx!, and mockup!. The record doesn’t explain what changed in this version, so the safe takeaway is simply that the framework offers these macro entry points. The interesting editorial angle is the tradeoff between a compact way to express an interface and the clarity of the code behind it. A macro can make a common shape convenient; it can also make a project’s conventions part of the learning curve. That’s a question for the people building with it, not a release claim.

## Don’t confuse pretty screens with pretty printing

[doculi 5.12.172](https://www.npmjs.com/package/doculi/v/5.12.172) is the most detailed example of a terminal tool doing document work. Its listing describes a CLI and interactive Ink TUI for documents.js, with conversion, bridge, and editor functions available as a scriptable command or terminal app. The listed formats include DOCX, PPTX, PDF, XLSX, CSV, SVG, Markdown, and RTF. That combination raises a useful workflow question: should a repeated conversion sit in a script, while an exploratory edit belongs in an interactive screen? The package description supports both modes, though it doesn’t tell us how they compare in practice.

The records don’t include a standalone general-purpose pretty-printer. [pi-pretty-tui 0.3.6](https://www.npmjs.com/package/pi-pretty-tui/v/0.3.6) is described as a polished TUI for the Pi coding agent; its listing doesn’t establish that it formats arbitrary terminal output. It’s worth keeping that distinction sharp. A pleasant interface and readable printed output can both improve terminal work, but they’re different claims.

A personal [Tui blog essay](https://til.andrew-quinn.me/tags/tui) offers a small-tool counterpoint: its author describes a home-built Finnish-to-English dictionary for quick lookup, with conveniences for language learning. That’s an individual account, not an independently verified product release. It still makes a good design prompt: solve one straightforward problem, then stop when the tool fits.

For this episode, the test is practical rather than grand: name the terminal task, name the boundary the tool covers, and ask what you need to trust before adopting it. An SSH launcher, a file browser, a keymap adapter, and a document TUI don’t need to become one platform to be useful.

## Sponsors

HQTerm keeps SSH sessions alive across disconnects and preserves terminal escape sequences and images.

HQTUI is a TypeScript library for building terminal interfaces.

## Sponsors

This episode is supported by [HQTerm](https://hqterm.sh), which keeps SSH sessions alive across disconnects and preserves terminal escape sequences and images, and HQTUI, a TypeScript library for building terminal interfaces ([HQTUI](https://hqtui.com/?utm_source=gitblog&utm_medium=blog&utm_campaign=launch-announcement)). Sponsor messages are separate from the editorial coverage.

This is from [TUI Weekly](https://tuiweekly.bl0ggers.com/blog/2026-11-11-terminal-roundup-b), the weekly terminal roundup with a podcast episode.
