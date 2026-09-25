---
title: A pull request you enter opens straight away
date: 2026-09-24
kind: fix
pr: 229
---

## What changed

Enter a pull request URL in the dashboard's **Review PR** form and the review opens as soon as it's ready. Before, the form just closed and left you on the empty dashboard. That was only survivable with the sessions sidebar showing, where you could spot the new session and click it. With the sidebar hidden there was nothing to click.

## Why

Someone who just typed in a pull request came to review it. The server already told the form which review it had opened; the form threw that away.

## Decisions

**The sidebar stays how you left it.** Opening the review doesn't bring the hidden sidebar back. You hid it to have room to read, and the review you asked for is what fills that room.
