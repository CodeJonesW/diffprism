---
title: Releasing without pushing to main
date: 2026-09-24
kind: infra
---

## What changed

A release no longer commits anything. When a pull request merges, the release job reads the last version published to npm, bumps it in its own workspace, tests, builds and publishes. Then it creates the GitHub release and tag on the merge commit. `package.json` on main now says `0.0.0-development`, so a local build no longer looks like a release.

## Why

We made main accept changes only through pull requests, with an approving review for anyone but the owner. The release job used to commit the new version number straight to main, so the rule turned it away. Three features merged and none of them reached npm.

## Decisions

**Change the job, not the rule.** One fix was to let the job skip the rule. GitHub doesn't offer that for Actions on a personal repository, and a deploy key that can write to main would bring back the very thing the rule prevents. Tags aren't covered by the branch rule, and they're where the release belongs anyway.

**npm is the record of what was released.** The version to bump from is whatever npm last published. A version number kept in a file on main can drift from that, which is how you end up publishing a version that already exists.

**One release at a time.** Two merges close together would both read the same published version and try to publish the same next one. The job now queues instead.

## What we learned

A PR title used in a GitHub Actions script should go through an environment variable, not be pasted into the script. Written as `${{ github.event.pull_request.title }}` inside `run:`, it becomes part of the shell command, and anyone who can open a pull request chooses its contents.
