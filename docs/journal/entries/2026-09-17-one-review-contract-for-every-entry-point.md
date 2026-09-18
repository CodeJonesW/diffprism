---
title: One review contract for every entry point
date: 2026-09-17
kind: decision
pr: 167
---

## What changed

DiffPrism could be opened about nine ways, and they behaved differently. Now they share one contract:

- `open_review` waits for the decision by default, like the CLI and the commit gate. `wait: false` returns right away. A timeout returns the session id, because the review is still open in someone's browser.
- One repo has one review session. Opening from a subdirectory finds the repo's session. A linked worktree gets its own.
- Tools that act on a review find it by session id, then repo path, then the current directory. No match, or several, is an error that lists the candidates.
- One `annotate` tool replaces three older ones. It takes many findings and reports any that failed.

This was a breaking change to the MCP tools.

## Why

Two differences did real damage. Waiting was inconsistent: the CLI and hook blocked, while `open_review` returned at once and needed a second call. And duplicate rules collided. An agent's open overwrote the repo's session in place, wiping its annotations. A dashboard open never checked for an existing one. Open a repo in the dashboard, let a hook fire, and you had two live sessions with the hook updating the wrong one.

## Decisions

One function is now the only way a session is created or reused. Reuse keeps annotations and doesn't reset a review in progress.

PR sessions are keyed by `owner/repo#number`, not by repo. A PR review reads from the local clone, so keying it by repo would let a PR review and a working-copy review of the same clone overwrite each other.

We removed the fallback to "the most recent session across all repos". A tool guessing which review you meant is worse than an error.

`open_review` no longer takes PR refs. Agents join PR reviews through the PR tools.

## What we learned

Setup and teardown kept separate tool lists that had drifted apart. Uninstalling left a tool behind in users' settings. Both now read one list.
