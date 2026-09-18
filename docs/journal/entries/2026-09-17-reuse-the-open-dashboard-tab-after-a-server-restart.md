---
title: Reuse the open dashboard tab after a server restart
date: 2026-09-17
kind: fix
pr: 189
---

## What changed

When the DiffPrism server restarts, the dashboard tab you already have open reconnects to it. New reviews show up in that tab instead of in a new one.

## Why

DiffPrism tabs were piling up. Every server restart ended with a fresh tab. Restarts had become routine because a new build now replaces the running server (#183), so this happened every time we rebuilt.

There were three causes:

1. The dashboard's port was random on each start. The open tab pointed at a dead address and couldn't even reload into the new server.
2. The dashboard never reconnected. When the connection closed, it only marked itself disconnected. The new server saw no dashboard and opened a tab when the next review arrived.
3. A race. The command that restarts the server sends its review within a second, before an open tab could reconnect.

## Decisions

The dashboard now prefers a fixed port, 24682, like the API ports already did.

After a dropped connection, the dashboard retries every second and asks the server for its process id. If the id is different, it's a new server: none of the old sessions exist there and it may be a newer build, so the page reloads. If the id is the same, the connection only dropped. The dashboard re-selects the session it was showing without reloading, so unsaved drafts survive.

For 3 seconds after starting, the server waits before deciding nobody is watching. That gives an open tab time to reconnect.

## What we learned

Tests for the grace period caught delayed checks from one server opening tabs for a later server in the same test run. Stopping a server now cancels its pending checks, so a stopped server can't open a tab later.
