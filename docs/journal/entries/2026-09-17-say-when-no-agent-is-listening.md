---
title: Say when no agent is listening to a reviewer's question
date: 2026-09-17
kind: feature
pr: 190
---

## What changed

If a reviewer asks a question on a line and no agent picks it up within 5 seconds, the thread now says so: "No agent is listening, so nothing will answer this. Ask Claude Code:". Below that is a prompt like `Answer my DiffPrism comments on session-xxxx`, which one click selects and a Copy button copies. The panel shows "No agent listening". Once an agent reads the thread, it goes back to "Waiting for the agent to reply."

A PR opened from the dashboard can now also be found by an agent working in a clone of that repo. The server matches the PR's owner and repo against the clone's GitHub remotes.

## Why

We found this while using DiffPrism on itself. We ran `diffprism` in a terminal, clicked Review PR in the dashboard and asked a question on a line. The thread said "Waiting for the agent to reply." forever. No Claude Code session was attached, so nothing would ever answer, and the server had no way to know that.

Separately, a PR opened from the dashboard only knew its repo if the server happened to be running inside a clone of it. Otherwise an agent in the clone couldn't find the session without being handed its id.

## Decisions

The server now records when an agent last read a session's threads. It only tells the dashboard when a read reaches a message no agent had seen before, not on every 2-second poll. A read in the same millisecond as a message counts as unread until the next poll, so a message is never shown as read by mistake.

We decided not to have the dashboard start an agent itself, for example with a headless `claude -p`. That is a separate feature, and it would still need this warning for when Claude isn't available.
