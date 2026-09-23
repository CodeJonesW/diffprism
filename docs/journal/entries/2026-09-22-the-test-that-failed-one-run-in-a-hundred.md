---
title: The test that failed one run in a hundred
date: 2026-09-22
kind: infra
---

## What changed

A test that checks the dashboard reopens on the same address after a restart failed now and then in CI, on pull requests that had nothing to do with it. It no longer does. Nothing in DiffPrism itself changed; the test was asking the wrong question.

## Why

The test needs a free port to hand the server as its preferred one. It got one the usual way: listen on port 0, let the operating system pick a free port, note which, close it. Then it asked the server to use that port and checked it did.

Port 0 gives you a port from the operating system's ephemeral range, and two things were taking it back before the server could use it:

- **The library the server uses to claim ports.** It remembers every port it has handed out in the last 15 to 30 seconds, and refuses them even once they're free again. The earlier tests in the same file had started dozens of servers, and every random port they were given came from that same range. So now and then, the "free" port the test picked was one the library had already handed out, and the server was given a different one. A short script showed it: a port handed out, closed and free, and then refused when asked for by number.
- **Outgoing connections.** The ephemeral range is also where your machine picks the local port for every outgoing connection, and other test files make HTTP requests in parallel.

In both cases the server did the right thing: it doesn't take a port that isn't available. The test's assumption that the port was still free was what failed.

## Decisions

The test now looks for a free port between 20000 and 30000, below the ephemeral range on both Linux and macOS, and skips DiffPrism's own default ports. Nothing hands those ports out on its own, so a port that's free when the test checks is still free when the server asks for it. The full core suite then passed 20 runs out of 20.

Keeping the probe port open until just before the server started would have narrowed the gap, but not closed it.
