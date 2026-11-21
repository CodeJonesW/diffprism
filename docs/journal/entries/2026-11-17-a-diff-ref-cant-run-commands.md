---
title: A diff ref can't run commands on your machine
date: 2026-11-17
kind: fix
pr: 303
---

## What changed

**A ref is only ever a ref.** When you review a range like `HEAD~3..HEAD` or `main..feature`, DiffPrism runs `git diff` with it. It used to build that as one command line and hand it to a shell. So a "ref" such as `HEAD; <command>` or `$(<command>)` ran `<command>` as you.

A ref reaches DiffPrism three ways:
- the dashboard, when you open a review or switch what it compares;
- the WebSocket the dashboard talks over;
- an agent's MCP call, through `diff_ref`. An agent fills that in itself, so text in a repository that steers the agent could steer the ref.

Now git runs directly, with the ref as one argument, and no shell sees it. Shell syntax in a ref is just a revision git can't find, and the review fails with git's error.

**A ref can't be a git option either.** Even without a shell, a ref starting with `-` would reach git as a flag: `--output=<file>` makes `git diff` write wherever it says. The ref now follows `--end-of-options`, so git always reads it as a revision.

Every range you could review before works the same.

## Why

An outside review of DiffPrism flagged the shell call. It was the one place a value from outside the process became a shell command, and that value can come from an agent.

## Decisions

**No shell anywhere a value comes in, not a filter on refs.** We didn't try to decide which ref strings are safe. Git already rejects bad revisions, and with no shell there's nothing for a clever string to escape into. The one other command in the same file that took a value, listing recent commits, moved off the shell too, though nothing outside sets that value today. The rule is now written in the package's notes so the next command added follows it.

## What we learned

Dropping the shell isn't the whole fix. An argument array stops shell injection but not option injection, and `git diff` has options that write files. `--end-of-options` before an untrusted revision, and `--` after it, is the pattern.
