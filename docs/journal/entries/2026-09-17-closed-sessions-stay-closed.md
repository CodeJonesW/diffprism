---
title: Closed sessions stay closed
date: 2026-09-17
kind: fix
pr: 166
---

## What changed

A review session you close in the dashboard stays closed. It no longer reappears when you reconnect or reload.

## Why

Closing a session stopped its watcher, recorded a "dismissed" result and told the dashboard to remove it. But the session stayed in the server's list. Every place that listed sessions returned that whole list, so the session came back the moment you returned.

## Decisions

The session couldn't simply be deleted. A command blocked on that review, such as `diffprism review`, the commit gate or an MCP poll, is still reading its result. Deleting it would hand that command an error and leave it polling until its ten-minute timeout.

The real problem was how closing was modelled. "The user closed this" was stored as "a result was submitted", which looks the same as an approved review that should stay visible. Sessions now carry a closed time. A closed session stays readable for anyone waiting on its result, but is left out of every listing. All three listing paths go through one helper, since three places each reading the list directly is how the bug happened.

## What we learned

A second bug hid behind the first. When a new review reused a closed session's repo, the server announced it as an update. The dashboard ignores updates for sessions it no longer has, so the reopened review would never have appeared. It's now announced as a new session.
