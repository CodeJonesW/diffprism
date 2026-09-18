---
title: A review outlives the wait that opened it
date: 2026-09-17
kind: fix
pr: 168
---

## What changed

If the command waiting on a review ends before the reviewer decides, running it again now picks up the decision. For example, an agent's `git commit` is killed mid-review. The reviewer approves in the browser. The agent runs the same `git commit` again, and it goes through right away.

The commit gate now says, before it starts waiting, that the review outlives the command. It repeats that if it's interrupted or times out. The `timed_out` and `pending` messages from the MCP tools tell the agent to keep waiting rather than ask the user. The `/review` skill tells agents to run `git commit` with a shell timeout long enough for a person to read.

## Why

A reviewer noticed that if a review takes a while, the agent asks a question that gets in the way of the eventual decision. There were two ways this happened:

1. `open_review` hands control back when its wait times out, and the agent starts asking the user things.
2. The commit gate. An agent runs `git commit` through a shell tool whose default timeout is 2 minutes. A longer review kills the commit mid-hook. The review stays open in the browser, the agent improvises, and the decision goes nowhere.

We ruled out the client killing a long `open_review`. Claude Code's limits for tool calls are well above our 10-minute wait.

## Decisions

The previous change cleared a decision whenever a session was reused. So re-running the interrupted commit wiped out the decision the reviewer had just given, and asked again. The retry could never succeed.

A decision now records the diff it answered. On reuse, an identical diff keeps an approval or a request for changes. A changed diff clears it, because that's a new question. A dismissal is always cleared, since it isn't a decision.

## What we learned

A shell timeout can end the process with `SIGKILL`, which no handler sees. Advice has to be printed before waiting, not only when interrupted.
