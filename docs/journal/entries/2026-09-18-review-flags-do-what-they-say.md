---
title: Every review keeps its --title and --reasoning
date: 2026-09-18
kind: fix
pr: 212
---

## What changed

`diffprism review` now uses the `--title` and `--reasoning` you give it for every kind of review. A pull request review shows your title and reasoning instead of the PR's own title. A review of your local changes shows your reasoning as the session's subtitle, which is how you tell reviews apart in the sidebar.

After opening a PR review, the command also no longer prints a list of tool names. That list named a tool that had been renamed. It now points you at the `/review` skill, which is where Claude Code learns the tools.

## Why

Both flags were accepted and then dropped without a word. For a pull request, the command sent only the PR's URL to the server, and the server wouldn't have read the title and reasoning even if they had been sent. For local changes, `--reasoning` never reached the review at all. A flag that's silently ignored is worse than one that doesn't exist, because you think you've set something you haven't.

## Decisions

We carried both flags through rather than rejecting them for pull requests, since a title and reasoning are just as useful on a PR review. The code that builds a PR review already accepted them; nothing passed them in.

We dropped the tool list rather than update it. It had already gone stale once when tools were renamed, and nothing would catch it next time.
