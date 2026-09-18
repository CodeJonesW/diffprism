---
title: Conversation threads on PR review comments
date: 2026-09-17
kind: feature
pr: 173
---

## What changed

On a PR review, you can click a line and ask the agent about it. The agent answers in a thread under that line, and you can reply back. Threads show who said what, and "Waiting for an agent to reply" when it's the agent's turn. Your own threads are grouped under Your comments in the panel.

Two new MCP tools support this, bringing the total to 14. `wait_for_comments` blocks until a thread is waiting on the agent, then returns it. `reply` answers a thread. `get_review_comments` now marks which threads are waiting and can filter to just those.

## Why

We wanted a reviewer to be able to comment on a PR and have the agent respond as part of a conversation.

## Decisions

For the agent to respond, it has to be listening, and MCP has no way to push to the agent. So the agent waits: it calls `wait_for_comments`, answers each thread with `reply`, and waits again.

Threads live in DiffPrism, on the review. They are not posted to GitHub. Mirroring them would be a separate decision, about authentication and about whether the agent should speak on the PR in public.

There is one definition of "waiting on the agent": the reviewer spoke last and the thread isn't dismissed.

The dashboard makes no optimistic updates. A new message reaches the screen only through the server's broadcast, so every open dashboard shows the same conversation.

## What we learned

Testing end to end found a loop already on main. When the server announced a dismissal, the dashboard handled it by calling the same function a user's click calls, which sends a dismiss to the server. The server announced that dismissal too. One click on Dismiss produced 54,855 requests. We split "the user wants to dismiss this" from "the server says this was dismissed". Now one click sends one request.
