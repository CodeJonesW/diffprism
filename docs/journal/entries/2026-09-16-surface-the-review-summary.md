---
title: Surface the review summary, not just inline comments
date: 2026-09-16
kind: fix
pr: 158
---

## What changed

When the commit gate blocks a commit, it now prints the reviewer's summary as well as their line comments. A rejection with no feedback at all says so. An approval that carries feedback prints it too.

## Why

A rejection that carried only a summary printed nothing. The reviewer typed "what is this?????" into the box above the decision buttons and clicked Request Changes. The agent that ran `git commit` saw only:

```
Commit blocked: the review requested changes.
```

It knew the commit was rejected and had no idea why. Avoiding that round trip is the whole point of this output.

A review result carries feedback in two places: the summary, and a list of comments on specific lines. Only the line comments were printed. A general remark isn't about one line, so the most natural way to reject a change was also the one sure to lose the reason.

## Decisions

A rejection with neither a summary nor comments now says there is nothing to act on. Silence looks the same as a bug, and the agent should ask rather than guess. A summary with only whitespace counts as empty.

Approving with a note and having the note vanish is the same failure in a quieter form, so approvals print their feedback too.
