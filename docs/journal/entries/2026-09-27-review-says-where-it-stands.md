---
title: A review says where it stands: waiting on you, on the agent, or decided
date: 2026-09-27
kind: feature
---

## What changed

A line above the decision buttons now says who a local review is waiting on:

- **A commit is waiting on you.** "A git commit is waiting on this review. Approve to let it through, or Request Changes to stop it. It waits another 7:42." If the commit gives up, it says so, and that your decision is kept for the next `git commit`.
- **The agent has work.** After you send findings with **Send to the agent to fix**: "2 are with the agent, 1 fixed so far… No need to request changes — wait for it, then decide." When they're all back: "The agent is back: 3 fixed. Check the fixes, then decide."
- **Decided.** A review you've decided says what you decided. It no longer flips back to "In Review" when you look at it again.

The dojo's own notice after sending says the same: no need to press Request Changes.

## Why

Three reports from one morning of dogfooding, all the same problem. The review showed the same buttons whatever was going on:
- A reviewer on a commit-gate review didn't know a commit was blocked on them, or that the decision buttons were what released it.
- Another sent findings to the agent and couldn't tell whether they also had to press Request Changes.
- A review they had just decided popped back up as "In Review" with its findings, as if nothing had happened.

## Decisions

**The caller says what it is.** The server knew someone was polling for a decision, but not who. Now the wait itself says: the commit gate as a commit, `diffprism review` as a review, an agent's `open_review` or `reply` as an agent. It also says until when. The server keeps that on the review and notices when the polling stops.

**Read off what's already there.** What's out with the agent comes from the threads: which ones wait on the agent, and which came back marked Fixed. It isn't a separate record that could disagree with them.

**One line, most urgent first.** Decided beats everything. Findings out with the agent come before "stopped waiting", because a commit stops waiting on purpose when findings go out, and "decide, then commit again" would be the wrong advice then.
