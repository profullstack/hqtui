---
title: "Live TUIs: the AJAX moment for the terminal"
date: "2026-09-14"
description: "A name for persistent terminal workspaces with independent pane updates, local loading indicators, and work that keeps moving."
author: Anthony Ettinger
---

I'm calling this pattern Live TUIs: a persistent terminal workspace where panes stream data, refresh independently, and show progress while you keep working.

The AJAX analogy is about partial updates. A pane can be waiting for data while the rest of the application remains usable. Loading belongs to the task that is loading, and a refresh updates the part of the screen that needs it.

hqtui-demo is the example behind the idea. It gives me a concrete way to talk about the experience: live state inside one workspace, with visible progress and independent updates.

The mechanics aren't new. Terminal applications have been capable of asynchronous work and partial redraws for a long time. That is also the strongest objection to giving the pattern a new name: an existing description may already be enough.

I think "Live TUI" is useful if it communicates what someone can expect while using the app. They can keep working while another pane refreshes. They can see which task is waiting without the whole screen becoming a waiting room.

That is the experience I want to name. Does "Live TUI" capture it?

Try hqtui-demo: https://hqtui.com
