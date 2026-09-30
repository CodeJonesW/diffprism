---
title: Hand your agent the link and it sets DiffPrism up
date: 2026-09-29
kind: feature
pr: 293
---

## What changed

**Your agent can install DiffPrism (#291).** Give Claude Code, Cursor or any coding agent diffprism.com, the GitHub repo or the npm package, and ask it to set DiffPrism up. The README now points agents at a setup guide written for them, `docs/usage/agent-setup.md`, which covers:
- the prerequisites to check;
- the few questions to ask you, each with a default: which agent you use, which repos, whether to gate commits, and which agent answers PR comments;
- the commands to run, for Claude Code and for Cursor;
- how to confirm the install with `diffprism doctor`, and what to tell you afterwards (restart the agent).

**Setup no longer fails silently in an agent's shell.** In a repo without a `.gitignore`, `diffprism setup` asks before creating one. An agent's shell has no terminal to answer, so the question read end-of-input and the process exited with code 0, having written nothing. The agent reported success, and none of DiffPrism's tools appeared after the restart. Now setup asks only at a terminal. Anywhere else it creates the `.gitignore` and says so. At a terminal, pressing Ctrl+C at the question cancels setup (exit 130) instead of exiting 0 halfway.

## Why

Setup should take no effort from you. An agent can already run every command DiffPrism needs. What it lacked was one page that says which ones, in what order, and what to ask you. The agent also needed setup to finish when nobody is at the keyboard.

## Decisions

- **One guide for every agent, not one per agent.** The steps are the same apart from where the MCP server is registered. `diffprism setup` writes Claude Code's config, and for Cursor the guide gives the `mcp.json` entry to add. A Cursor mode in `setup` can come when someone needs more than that entry.
- **Ask only where someone can answer.** The first fix treated end-of-input as the default answer. The review dojo found two holes in that: Ctrl+C also closes the question, so cancelling counted as yes, and a pipe that never closes still hung. Checking for a terminal before asking avoids both problems, and makes a closed question mean cancel.
- **Setup for a user, not a contributor.** `CLAUDE.md` now opens by telling an agent that has cloned the repo to install the npm package instead of building from source.

## What we learned

An interactive prompt is also an API. Before asking, check that someone can answer. When nobody does, end with a decision or an error, never with exit code 0 after doing nothing.
