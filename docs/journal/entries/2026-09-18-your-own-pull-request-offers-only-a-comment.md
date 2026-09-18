---
title: Your own pull request offers only a comment
date: 2026-09-18
kind: fix
---

## What changed

When you review a pull request you opened yourself, DiffPrism no longer offers Approve or Request changes. It offers Comment, and says why: GitHub doesn't let a PR's author approve it or request changes on it. The review bar also now says which GitHub account your review will post as.

## Why

We found it the hard way. Reviewing our own PRs in DiffPrism, we clicked Approve, and GitHub refused with a 422 error. The server log showed the same failure on PRs in two different repos. DiffPrism knew who had opened the PR, but not who was reviewing it, so it couldn't tell they were the same person.

## Decisions

"You" means the account whose token DiffPrism posts with, which isn't necessarily whoever is at the keyboard. So we ask GitHub who that token belongs to when the PR is opened, and keep the answer with the PR's details. The comparison ignores letter case, as GitHub logins do.

Some tokens have no user behind them, such as the ones GitHub Actions and GitHub Apps use, and GitHub won't say who they are. Then the review bar offers every decision, as before, and GitHub's own answer decides. Any other failure asking GitHub still stops the PR from opening, rather than being quietly ignored.
