---
title: diffprism doctor says whether your install matches the version you run
date: 2026-09-24
kind: feature
---

## What changed

`diffprism doctor` lists everything DiffPrism puts on your machine and whether each one matches the version you're running: the `/review` skill and tool permissions, globally and in the project; the project's `.gitignore` entries and `.mcp.json`, including the command it launches; the pre-commit hook; and the running server, with its port, PID, uptime and the version it serves. It only reads. `diffprism doctor --fix` updates whatever is out of date, the same way `setup` would.

## Why

A PR conversation once died after one reply. The cause was in `~/.claude/`: a `/review` skill six months old, and permissions for tools DiffPrism no longer has. Nothing in DiffPrism could have told you that, so finding it meant reading config files by hand. The server now repairs a stale global install when it starts, but it does that silently, and the project-level install was never checked at all.

## Decisions

**Ask the installers instead of writing a second checker.** The doctor never decides for itself what "current" means. It runs `setup` as a dry run and reports what setup would change. It asks the hook code whether the hook's DiffPrism block matches what this version would write. It asks the same function every command uses whether a running server should be replaced. An earlier check that kept its own list of tool names said "all good" for months while the real tool names changed around it.

**The server now says which build it is.** `diffprism server` records its version, and the checkout it runs from when it's a dev build, in `~/.diffprism/server.json`. Before, an old server and a new one looked the same from outside.

**`--fix` never cuts off a review.** A server running an older build gets replaced only when no review is open in it. If one is open, the doctor tells you and leaves the server running.

**A missing hook isn't a problem.** The pre-commit gate is something you opt into, so "not installed" is reported as a fact, and `--fix` doesn't install it.
