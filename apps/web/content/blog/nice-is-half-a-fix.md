---
title: nice is half a fix
date: "2026-09-06"
description: moshcode 0.92.0 adds a /nice toggle. It runs the CLIs the pit starts at a lower priority than the terminal you are typing in. The interesting part is not the toggle. It is what I got wrong about…
author: Anthony Ettinger
---

moshcode 0.92.0 adds a `/nice` toggle. It runs the CLIs the pit starts at a lower priority than the terminal you are typing in. The interesting part is not the toggle. It is what I got wrong about `nice` on the way there.

## The freeze

The pit's job is starting other people's programs, and some of them are not shy. A coding engine holding a big context, a bundler, a browser under test. Start a few at once on a box you also want to work on and you get the failure everyone has had: the machine stops answering.

Nothing crashed. Every core is busy, the last of the RAM went to swap, and the swap went to disk. You wait, you get impatient, you eventually decide the box has locked up.

I had this happen twice in one night on our dev box. My first instinct was that it had rebooted. It had not. `uptime` said seven days, continuously, and I nearly believed the machine over the person who watched it happen.

What actually happened was two out-of-memory kills at 00:14 and 01:55. The second one is the interesting one. The kernel's OOM killer runs in the context of whatever process asks for memory next, and at 01:55 that was `sshd`. So the session went dead for several seconds and came back with things missing. That is indistinguishable from a reboot from where you are sitting.

## Why nice does not fix it

`nice` is the classic answer to "this process is eating the box", and it is exactly the right tool for a CPU problem. It reorders the scheduler. Your shell gets picked before the bundler does.

But look at what a freeze is actually made of. RAM fills. The kernel starts reclaiming pages. Reclaim goes to disk. Every process blocks on that disk. Load climbs because blocked processes still count. And then the OOM killer fires, late, and shoots whatever was biggest.

A nice level does not touch a single step of that. Scheduling priority decides who runs next among processes that are ready to run. It has nothing to say about a process that is blocked on I/O, and nothing at all to say about who gets killed when memory runs out. You can `nice -n 19` a process and it will still take the machine down.

That is the half `nice` does not cover, and it is the half that costs you a session. CPU contention makes things slow. Memory exhaustion kills work.

## So the throttle covers three things

`nice -n 10` for CPU, so the engine yields to what you are typing.

`ionice -c 2 -n 7` for I/O, so its reads stop starving everything else. This is the one people forget, and on a box that is already swapping it matters more than the CPU priority does.

A systemd scope with `MemoryMax` for the ceiling, so a runaway process dies on its own instead of taking the box with it.

None of the levels are the extremes, on purpose. `nice 19` and `ionice` idle both mean "run only when nothing else wants the machine". That sounds correct and is not: an engine that yields completely can sit there for minutes while one background job holds the box, and a coding CLI that never finishes reads as broken rather than as considerate. Ten and seven mean "last in line among normal work", which is what you actually wanted.

## Fixing the box too

The same week I put earlyoom and zram on every box we run, because the application-level throttle is only worth so much if the machine has no slack at all.

zram is a compressed block device in RAM used as swap. Cold pages get compressed at roughly three to one instead of written to disk, so the reclaim that used to stall on I/O costs some CPU and no seeks. It does not add memory. It moves the wall further out.

earlyoom watches free memory and kills the biggest consumer while the box is still responsive. The kernel's own killer is not wrong about what to kill. It is late. That is the entire difference.

Two of our public boxes turned out to have zero swap. One of them has 961 MB of RAM and was running at 575 MB. That box was one traffic spike away from an OOM kill with no reclaim runway whatsoever.

## Things that fail quietly

Three of these cost me time, and all three look like success:

DigitalOcean images ship no zram kernel module. `modprobe zram` fails, and the systemd unit then reports a failed dependency on `dev-zram0.device` rather than naming the missing module. The real cause never appears in the error. You need `linux-modules-extra` for the running kernel.

A zram device that already has a size set refuses reconfiguration with `Device or resource busy` and quietly keeps its old settings. Your new config appears to apply and has not. You have to reset the device first.

And systemd expands variables from an `EnvironmentFile` by splitting on whitespace with no shell quote removal. So writing `--avoid '^(sshd|systemd)$'` puts the quote characters inside the regex, where they match nothing. The service starts perfectly happily either way. The only way to know is `ps -o args=` on the running process.

That last one is my favourite kind of bug. Every layer reports success and the thing simply does not do what it says.

## Off by default

`/nice` is off unless you turn it on. A throttle nobody asked for is a slow engine nobody can explain, and I would rather you opt into the tradeoff than discover it.

```
/nice on
/nice mem 2G
/nice
```

It also degrades rather than failing. Each wrapper is added only if the binary is actually there, so a box with no `ionice` still gets `nice`, and a box with neither spawns exactly what it spawned before. The memory ceiling is opt-in because `systemd-run --user` needs a session bus that an ssh login without lingering does not have, and it fails outright rather than degrading, which would take the engine down with it. When you set a ceiling that cannot be enforced, `/nice` tells you instead of silently doing nothing.

`npm i -g moshcode` for 0.92.0.
