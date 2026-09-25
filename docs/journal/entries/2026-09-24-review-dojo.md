---
title: The review dojo — agents review a PR, then argue about it
date: 2026-09-24
kind: feature
---

## What changed

A pull request review has a new **Review dojo** panel on the right of the diff. Tick the coding agents you want — the ones installed on your machine, Claude Code and Cursor today — and start it. Each agent reviews the PR on its own. Then each one votes on what the others found: agree or disagree, how much it matters, and why. You get one list of findings grouped by agreement: **agreed**, **disputed**, **not every agent voted**, and **one reviewer**. Under each finding you can see who raised it and how every other agent voted. Each finding is also posted as a thread on its line in the diff, so you can reply to it there.

## Why

One agent's review is one opinion, and you can't tell how confident to be in any of it. When two agents built on different models flag the same line, it's probably real. When one flags something the other calls a nit, that's the part worth your attention. Seeing where they agree and where they don't tells you where to spend your review time.

## Decisions

**Nobody summarises the argument.** Whether a finding is agreed or disputed is worked out by counting the votes, not by asking an agent to write it up. An agent summarising the others could misreport them, and you'd have no way to tell.

**Two rounds, then stop.** Each agent reviews once and votes once, so a dojo costs two turns per agent and takes a predictable amount of time. We weighed letting agents keep arguing until they converge. That can come later if one round of voting turns out to be too shallow.

**The agents run the same way the answering agent does.** The dojo reuses the code that already runs Claude Code and Cursor headless and read-only for a PR review. Adding another tool means describing how to start it and how to run one turn, and it then works for both the answering agent and the dojo.

**An agent that fails drops out, and the panel says why.** If an agent isn't installed, can't start, or answers with something that isn't the JSON asked for, it leaves the dojo with that reason shown, and the others carry on. The dojo fails only when no agent managed to review at all.

**Replies are still answered by one agent, for now.** Replying on a dojo finding reaches the PR's usual answering agent. Having every dojo agent read the thread and answer each other is the next step.
