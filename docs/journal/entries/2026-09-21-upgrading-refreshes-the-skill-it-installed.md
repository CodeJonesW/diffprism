---
title: Upgrading DiffPrism now refreshes the skill it installed
date: 2026-09-21
kind: fix
---

## What changed

When the server starts, DiffPrism checks whether the `/review` skill and the tool permissions on your machine match the version you are running, and rewrites them when they don't. Before, it checked whether the skill file existed at all — so an install from an older version stayed exactly as it was, however many times you upgraded.

## Why

Someone commented on a line in a pull request to ask their Claude Code session a question. It answered, and then stopped listening; every follow-up needed another paste of `Answer my DiffPrism comments on <session>`.

The session wasn't ignoring anything. The skill on that machine was six months old. It described nine tools, three of which had since been renamed, and it had never heard of `wait_for_comments` or `reply` — the two tools that hold a conversation open. The permissions were the same vintage. The agent had not been told there was a conversation to stay in, so it did the only thing it knew about: answer once.

Every upgrade in those six months had looked at that machine and concluded it was already set up.

## Decisions

The check now asks the installer. `setup` learned a dry run — work out which files it would create or update, and write none of them — and "is this install current?" is simply a dry run that reports nothing to do.

That matters more than the one bug. The old check kept its own list of the tool names it expected, written once and then left alone while the tools were renamed around it. It was a second copy of the answer, and it went stale at exactly the same rate as the thing it was meant to catch. Now there is one definition of a correct install, in the code that performs it. The next file setup learns to install is covered on the day it's added, with nothing to remember in a second place.

The skill is the only thing DiffPrism installs that is a copy rather than a pointer — the pre-commit hook is one line that calls the CLI, so it upgrades when the CLI does, and `.mcp.json` is a command. A copy needs someone watching it. Now something is.
