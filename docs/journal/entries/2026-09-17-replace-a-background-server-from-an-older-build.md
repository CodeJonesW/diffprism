---
title: Replace a background server from an older build
date: 2026-09-17
kind: feature
pr: 183
---

## What changed

Every DiffPrism command reuses the background server if one is running. Now, if that server is from an older build and has no review open, the command stops it and starts a new one on the current build. If a review is open, it keeps the old server and says so.

Two smaller changes shipped with it. The built dashboard files are no longer tracked in git. And `diffprism reply` now ends by telling the agent to go back to waiting for the decision, rather than asking the user in the terminal.

## Why

A new build kept talking to the old server until someone remembered to run `diffprism server stop`. That made it easy to test a change against code that didn't include it.

The built dashboard files were gitignored, but four stale ones were still tracked. Every build changed them, and the dirty tree blocked `git checkout` of another branch.

The reply message came from using the tool. An agent answered a reviewer's question with `diffprism reply`, then stopped and asked the user to decide in the terminal. The reviewer's next question, asked seconds later in the dashboard, reached no one. The instruction to keep waiting was only printed before the reply, not after it.

## Decisions

Each build is stamped with its build time, and the server records that stamp. Only a newer build replaces an older server. "Different" isn't enough: Claude Code keeps `diffprism serve` running on whatever build it started with, and that stale process would otherwise restart a newer server back onto the old build.

Before starting the new server, the command waits for the old process to exit, and fails loudly if it doesn't.

## What we learned

This PR replaced #182, which was merged into a stale base branch. GitHub only retargets a PR when its base branch is deleted, so #182's commits landed on a feature branch, not main, and were never released.
