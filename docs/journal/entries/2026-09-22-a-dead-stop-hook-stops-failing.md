---
title: The Stop hook that failed on every turn is gone
date: 2026-09-22
kind: fix
pr: 216
---

## What changed

If you set up DiffPrism in a project before March, every Claude Code turn there ended with `Stop hook error: … too many arguments`. Running `diffprism setup` in that project now removes the hook, and `diffprism teardown` removes it too. The same cleanup runs on your global settings whenever the DiffPrism server starts.

DiffPrism's own repo had the hook as well, committed to its `.claude/settings.json`, along with tool permissions from before the tools were renamed. Both are fixed, and a test now fails if that file drifts from the tools the server registers.

## Why

Early versions of `setup` installed a Stop hook that ran `npx diffprism@latest notify-stop`. In March we deleted the `notify-stop` command, and in the same change we deleted the code that cleaned up DiffPrism's old hooks. The hook stayed behind with nothing to call. It has failed at the end of every turn since, in every project set up before then.

It showed up as "happening on the latest DiffPrism". It wasn't new. `@latest` always runs the newest release, so the hook broke the day the command was removed and stayed broken through every release after.

## Decisions

Setup already knew how to clean up after itself for permissions: it removes permissions for tools that no longer exist. Hooks now work the same way. A short list names the commands that used to be installed as hooks. Setup and teardown remove any hook that calls one of them, and leave every other hook alone, other tools' hooks included.

Because of the check added in #213, this also reaches machines nobody touches. A global settings file with the dead hook no longer counts as current, so the server repairs it on startup. A project's own settings get fixed the next time someone runs `diffprism setup` there. For projects where nobody will, #214 (`diffprism doctor`) is the place to report it.

This is the same kind of bug as #211. Something DiffPrism installed outlived the thing it pointed at.
