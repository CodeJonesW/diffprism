---
title: Stop syntax highlighting leaking across collapsed lines
date: 2026-09-17
kind: fix
pr: 187
---

## What changed

Code after a collapsed region of a diff is no longer shown in comment grey when a comment or string opens before the gap and closes inside it.

## Why

While reviewing a change in another project, a call to `registerServiceWorker();` and everything after it rendered in comment grey. The reviewer asked "why is this added but commented". It wasn't commented out.

A line above it opened a `/* … */` block, and the closing `*/` sat in the unchanged lines between two hunks, which the diff doesn't show. The diff viewer highlighted all hunks as one piece of text, with blank lines standing in for the gaps. The `/*` never closed, so the highlighter treated the rest of the file as a comment. The same could happen with any string, template literal or comment that spans a collapsed region.

## Decisions

Each hunk is now highlighted on its own, and the results are merged back by line number. The highlighter's state can't cross a gap anymore.

One case is still wrong. A hunk that starts inside a comment, with the opener above the hunk, shows those first lines as code. Fixing that needs the whole file's source for every kind of diff, including PRs. We left it for now because it's rarer.

## What we learned

The tests include one that runs the old approach and confirms it reproduces the bug. That keeps the test honest: it proves the fixture actually triggers the problem, not just that the new code passes.
