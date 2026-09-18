---
title: Clicking a thread in the panel scrolls to it, even in the open file
date: 2026-09-17
kind: fix
pr: 185
---

## What changed

Clicking a thread in the Annotations & comments panel now scrolls the diff to that thread. This works when the thread is in the file you already have open, and picking the same thread twice scrolls both times.

## Why

While reviewing a file with two threads, clicking either one in the panel left the diff where it was. Threads in other files seemed to work.

The panel only ever navigated to the file. Switching files resets the view, so a thread in another file looked right by accident. Within the open file, nothing moved.

## Decisions

The panel now passes the whole thread instead of just its file. The review view selects the file and marks the thread as the one to focus. The diff viewer waits for the thread to be drawn, which can take a moment after a file switch, scrolls to it, then clears the focus. Dismissed threads are skipped, because they aren't drawn on the diff.
