---
title: Answer a reviewer's question from the CLI with diffprism reply
date: 2026-09-17
kind: feature
pr: 180
---

## What changed

A new command, `diffprism reply --session <id> <annotation-id> <message…>`, posts an agent's answer to a reviewer's question. It fails loudly if no server is running, the reply is empty, or the server refuses it.

When `diffprism review` or the commit gate stops because the reviewer asked something, each printed question now ends with the exact command to answer it:

```
  src/limit.ts:5
    why do we need to keep every timestamp for this
  Answer: diffprism reply --session session-8b29860f 096e30ad-… "<your answer>"
```

## Why

While using DiffPrism in another project, a reviewer asked a question during `diffprism review`. The wait ended as planned, and the output said "Answer each question with the DiffPrism reply tool." That tool only exists over MCP, and the agent in that session had no DiffPrism MCP server connected. It couldn't follow the instruction, so it answered in the terminal. The dashboard kept saying "Waiting for an agent".

## Decisions

The CLI path can only rely on the CLI. Whoever ran `git commit` or `diffprism review` has a shell. Nothing else is guaranteed.

The printed answer command is built by the same function that defines the command, so the two can't drift apart.

The dashboard hint changed from "Waiting for an agent to reply — it answers when it's listening with wait_for_comments" to "Waiting for the agent to reply." The old text only applied to PR reviews over MCP.

## What we learned

An instruction to an agent is only useful if the agent has the tool it names. Point to something the agent is sure to have in that context.
