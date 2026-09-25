---
title: Every pull request review gets its agent, however you open it
date: 2026-09-24
kind: feature
pr: 227
---

## What changed

A pull request you open from the dashboard's **Review PR** form now gets the same Claude Code agent as one opened with `diffprism review`: comment on a line and it answers in the thread. And `diffprism review <PR URL>` no longer keeps your terminal. It opens the review, tells you Claude is answering, prints the `claude --resume` command for the conversation, and gives you your prompt back.

## Why

The agent used to live inside the `diffprism review` command, and the command stayed running for as long as the review was open so the agent could keep going. The dashboard's form has no command running behind it, so a PR opened there had no agent at all: you were back to opening a Claude Code session and pasting in a prompt.

## Decisions

**The DiffPrism server runs the agent.** Every pull request review goes through the server however it's opened, so that's the one place that sees them all. The server starts one agent per review. Opening the same PR again finds the agent that's already answering it, and after an agent stops, opening the PR again starts a fresh one.

**The server doesn't know about Claude Code.** How to run an agent lives in the CLI, which hands the server a way to start one when the server starts. The server only knows that an agent has started for a review and when it has stopped.

**It runs where it can see the code, and nowhere else.** With a local clone, the agent runs there. Without one, it runs in an empty folder of its own, not the folder the server happened to start in, because its tools can read whatever is around them.

**What it does goes to the server's log.** With no terminal to print to, what the agent does, and the reason it stopped if something went wrong, goes to `~/.diffprism/server.log`. If an agent stops, the dashboard shows it: once a question goes unanswered, the notice that nobody is listening comes back.
