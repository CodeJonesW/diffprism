---
title: The dojo shows its work while it runs
date: 2026-09-24
kind: feature
pr: 237
---

## What changed

While a review dojo runs, its panel shows each agent on its own row. Each row has the agent's stage (starting, reviewing, voting, done, or dropped out) and how long it's been in that stage, counting up every second. It also shows what the agent is doing right now, such as "Reading the diff of src/cache.ts", "Searching for “ttl”" or "Thinking", and how many findings it raised once its own review is in. The top of the panel shows how long the whole dojo has been running. An agent that drops out says why on its row, as soon as it happens.

## Why

A dojo on a real pull request takes minutes, and the panel used to show one spinner until it was over. That's long enough to wonder whether anything is happening at all.

## Decisions

**Show what the agents are actually doing.** Claude Code and Cursor both stream their work as JSON events when asked to. The dojo reads those events as they arrive and turns each tool call into a sentence. Paths are shown relative to your clone. This is a report of what the agent did, not a guess.

**Progress travels with the dojo.** Starting a dojo returns two things: a stream of per-agent updates, and the final result. The server passes each update to the panel as it arrives. Once the result is in, it's final, and a late update can't undo it.

**The answering agent streams too.** The agent that replies in threads runs the same way, so there's one way of running each tool rather than two.

## What we learned

Before adding progress, we timed where a dojo's minutes actually go. Both CLIs are ready in under two seconds and answer a small question in three to five. The time is the agents working through the pull request. One early measurement said startup took 30 to 60 seconds, but that came from our test script launching the wrong MCP server, so the agent waited for a connection that never came. Measure the thing you'll ship, not a stand-in for it.
