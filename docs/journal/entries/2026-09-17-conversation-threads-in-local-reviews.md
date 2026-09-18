---
title: Conversation threads in local reviews
date: 2026-09-17
kind: feature
pr: 178
---

## What changed

You can now ask the agent a question during a local review, not just a PR review. A local review is one an agent opened with `open_review`, or one the commit gate opened.

In the dashboard, the comment form keeps Save, for a comment that goes back with your decision. It adds Ask agent now, which starts a thread right away. If asking fails, your text stays and the reason is shown. Replying to one of the agent's findings also counts as a question.

The agent gets your question wherever it is waiting:

- `open_review` or `get_review_result` returns `reviewer_asked` with the threads.
- The commit gate blocks the commit and prints each question with its id.
- `diffprism review` does the same and exits with code 1.

We also fixed a bug: clicking a line that only had an agent finding didn't open the comment form. It does now.

## Why

On a PR review, the agent listens for questions with `wait_for_comments`. In a local review, the agent is blocked waiting for your decision, so nothing could reach it until you decided. Threads needed to work in both workflows.

## Decisions

The wait for a decision is also the wait for questions. Every wait ends as soon as a thread is waiting on the agent and hands those threads back. The agent answers with `reply`, then waits again. The review stays open the whole time, so the decision still comes. A decision already given wins over an open question.

There is now one wait loop in core. `get_review_result` used to have its own copy. A session that disappears mid-wait now fails with "Session not found" instead of being polled until the timeout.
