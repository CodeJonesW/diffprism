---
title: One paste starts a conversation that stays open
date: 2026-09-18
kind: feature
pr: 194
---

## What changed

When no agent is listening, the dashboard gives the reviewer a prompt to paste into Claude Code. That one paste is now enough. `wait_for_comments` returns the review's context along with the questions: the checkout path, whether a local clone is connected, the branch, the PR and the title. Each thread also carries the code its line is on. `open_review` and `get_review_result` return the same context when the reviewer asks something.

Answering no longer ends the conversation. After `reply` posts an answer, it goes back to waiting and returns what happened next: the reviewer's next question, their decision, or a timeout. An agent that wants to stop after one answer passes `then_wait: false`.

## Why

The pasted prompt named only a session id. Before the agent could answer, it had to look up which checkout, branch and PR the review was of, and read the code the question was about. That took several round trips while the reviewer waited.

Then, once the agent answered, the call ended and so did the conversation. The reviewer's next question reached nobody, and they had to paste the prompt again.

## Decisions

The extra context is read once from the session, and only when there is something to answer. If that read fails, the questions still come back without it, so a missing detail never hides a question.

A batch of questions is still answered one at a time. While the agent listens after a reply, a decision on a local review still reaches it.
