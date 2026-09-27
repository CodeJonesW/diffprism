---
title: A pull request review reads the pull request, from any folder
date: 2026-09-26
kind: fix
pr: 241
---

## What changed

`diffprism review <PR URL>` works from any folder, and whatever you ask about a PR is answered from the PR's own code.

When a review opens, DiffPrism fetches the PR's head commit, and the base it's measured against, into a copy of the repository of its own under `~/.diffprism/repos/`. It checks the head out in a folder for that PR. The agent answering your comments works there, and `get_file_context` reads from there. Opening the PR again moves the checkout to the PR's latest commit. Your own clone isn't read or touched.

## Why

Reviewing a PR without checking it out is the point of DiffPrism, and it only half worked. Code was read from the clone you ran the command in:

- **Run from anywhere else,** the review had no code beyond the diff. The agent couldn't open a whole file.
- **Run from your clone,** the agent read your clone as it was. When you're reviewing someone else's PR, that's usually your own branch, not theirs. Asked about a function the PR changed, it could read the version without the change and answer about that.
- `get_file_context` asked git for `origin/<branch>`. That's stale unless you've fetched, and doesn't exist at all for a PR from a fork. When it wasn't there, the tool quietly read your working tree instead: the wrong code, with nothing to say so.

## Decisions

**DiffPrism fetches the code itself, instead of borrowing your clone.** We considered creating a worktree from your clone for each PR. Your clone already has most of the history, so it's quicker to set up. But you'd still have to run the command from inside it, and DiffPrism's worktrees would show up in your `git worktree list`. A copy of its own works from any folder, and from the dashboard, which has no folder at all.

**It fetches the exact commit, not the branch.** The PR's head commit is the one whose diff the review shows. Fetching it by commit means the code the agent reads matches that diff, even if someone pushes while the review is opening. It works the same for a PR from a fork, whose branch isn't in the repository at all. Only the head and base commits are fetched, not the history, so the first fetch costs about as much as downloading a copy of the repo.

**The token stays out of sight.** The fetch uses the same GitHub token DiffPrism reads the PR with. It's passed in the fetch's environment, so it isn't in the command line other processes can see, and it isn't written into the repository's config.

**If the fetch fails, the review doesn't open.** A review whose agent can't read the code would give confident answers about code it never saw. So a PR that can't be fetched fails to open and says why. For the same reason, `get_file_context` on a PR no longer falls back to any other copy of a file: a file missing at the PR's head is reported as missing.

## What we learned

For every fallback, ask what it returns on the day it fires. "Read the working tree if git can't find the file" looked like harmless robustness. It fired exactly when the ref was missing, which was also exactly when the working tree was the wrong branch.
