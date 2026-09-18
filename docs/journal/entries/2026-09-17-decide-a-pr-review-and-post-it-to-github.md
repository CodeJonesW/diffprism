---
title: Decide a PR review from the dashboard and post it to GitHub
date: 2026-09-17
kind: feature
pr: 176
---

## What changed

A PR review in the dashboard now ends with a decision bar. It uses GitHub's own words: Approve, Request changes, Comment. Request changes and Comment stay disabled until you write a summary, because GitHub rejects them without one.

The bar lists your threads, each with a checkbox, all unticked. A ticked thread posts your opening message as an inline comment on GitHub. The agent's replies stay in DiffPrism.

On success you see "Review posted to GitHub" and a link to it. On failure you see GitHub's reason, such as a missing token or not being allowed to approve your own PR. Your summary and ticks are kept. Close without posting closes the session.

## Why

PR reviews had no ending. The decision bar had been hidden for PR reviews, and its "Post to GitHub" checkbox could never be reached. The function to submit a GitHub review existed, but nothing called it. With threads, a PR review became a real conversation, so it needed a way to finish.

## Decisions

- Threads are a conversation with the agent, so nothing goes public unless you tick it.
- The decision is recorded only after GitHub accepts the review. There is no local "approved" that GitHub never saw.
- Threads now record which side of the diff they are on. A thread on a deleted line is numbered in the old file. Without a side, it would post to the same line number in the new file, which is a different line.
- We removed the "Reviewed with DiffPrism" footer the old code appended. A review posted under your name contains only what you wrote.
- The CLI's `--post-to-github` flag was already a no-op. We left it in place, because removing a flag breaks scripts that pass it.
