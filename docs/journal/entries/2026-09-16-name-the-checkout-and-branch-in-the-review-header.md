---
title: Name the checkout and branch in the review header
date: 2026-09-16
kind: feature
pr: 162
---

## What changed

The review header now shows which checkout and branch the diff on screen came from:

```
radius / main
install-steps-306 / worktree-install-steps-306
```

Hovering shows the full project path. The header reads this from the same session record as the sidebar, so the two can't disagree.

## Why

With several reviews open, nothing in the review pane said which branch or checkout you were looking at. The sidebar showed it for each session, but the header didn't.

The chip in the top right reads `working copy`. That's the diff scope, not the branch, so it doesn't change when you switch sessions. It's easy to read as a branch name that's stuck.

Several sessions across several worktrees is what a machine running a few agents looks like. It's also how we submitted a review decision to the wrong session while testing an earlier fix.

## Decisions

The first version fell back to the repo's current branch when no session was active. Outside server mode, the ref picker already shows that as a badge, so the branch printed twice, and a render test failed. We dropped the fallback. The header reads only the session record, because the real gap was server mode, where the branch appeared nowhere.
