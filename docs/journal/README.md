# Build journal

A running record of what we change in DiffPrism and why, written in plain
language as we go. It exists so the story of the product is not lost in
commit messages and PR bodies, and so blog posts for diffprism.com can be
drafted from it without reconstructing history.

Every PR adds or edits an entry in `docs/journal/entries/`. CI fails a PR
that doesn't (`pnpm journal check --base origin/main`).

## Writing an entry

One file per change: `docs/journal/entries/YYYY-MM-DD-<slug>.md`, dated
the day the change lands.

```markdown
---
title: One paste starts a conversation that stays open
date: 2026-09-18
kind: feature
pr: 194
---

## What changed

What a DiffPrism user sees now that they didn't before.

## Why

The problem or friction that prompted it.

## Decisions

What we chose, what we rejected, and why. (Optional.)

## What we learned

A lesson another developer would find useful. (Optional.)
```

- **Frontmatter** is exactly these keys. `kind` is one of `feature`, `fix`,
  `decision` (the story is the choice we made), `infra` (CI, tooling, docs).
  `pr` is optional — add it once the PR exists.
- **Sections** are these four, in this order. `What changed` and `Why` are
  required.
- **Write for the reader of a blog post:** a developer who uses coding agents.
  Say what they can now do, not which function moved. Record the alternatives
  you actually weighed; don't invent them after the fact.

`pnpm journal check` validates every entry.

## Turning entries into a post

```bash
pnpm journal export --since 2026-09-01 > /tmp/journal.md
pnpm journal export --since 2026-09-01 --kind feature,decision
```

The export is one markdown bundle, oldest first, with dates and PR links. Use
it as the source material for a post in the landing site
(`diffprism-landing/src/blog/posts.tsx`): pick the thread that ties the
entries together, and cite the PRs.
