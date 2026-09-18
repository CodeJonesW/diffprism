---
title: A build journal we write as we go
date: 2026-09-17
kind: infra
pr: 201
---

## What changed

Every change to DiffPrism now comes with a short journal entry in
`docs/journal/entries/`: what changed, why, and the decisions behind it, in
plain language. `pnpm journal export --since <date>` gathers entries into one
markdown bundle, which is the starting material for posts on diffprism.com.

We backfilled entries for the PRs merged in the weeks before this one, so the
journal starts with the recent history rather than an empty page.

## Why

We ship several changes a day, often built with coding agents. The reasoning
behind each one lives in a PR body at best, and writing a blog post later
meant digging through PRs to rebuild why things changed. Writing that down
while the change is fresh is cheaper and more accurate.

## Decisions

- **One file per change, not a single changelog.** Separate files don't
  conflict between parallel branches, and a post can pull any subset of them.
- **Plain markdown with a strict, tiny frontmatter.** Entries stay readable on
  GitHub, and `pnpm journal check` rejects unknown keys or missing sections
  instead of letting the format drift.
- **CI requires every PR to add or edit an entry.** A journal you only
  sometimes write is not a record of progress. The check runs against the PR's
  base branch, so the release commits CI pushes to main are not affected.
- **Not generated from PR bodies.** PR bodies are written for reviewers and
  release notes. The journal is written for a developer reading our blog, so
  it's its own document. We used PR bodies only to backfill.
