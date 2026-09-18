---
title: Comments stay on the side of the diff they were written on
date: 2026-09-18
kind: fix
pr: 202
---

## What changed

When a line is replaced, the deleted line and the line that replaces it can have the same number: old line 12 and new line 12. A comment or question on one of them now shows up only under that line. Before, it also appeared under the other one, so a question about removed code looked like it was about the code that replaced it.

Your comments in a local review now record which side of the diff they are on, too. When the review goes back to the agent, each comment says whether its line number counts in the old file or the new one. The commit gate prints a comment on removed code as `a.ts:12 (deleted line)`.

## Why

A deleted line is numbered in the old file and every other line in the new one, so a line number alone doesn't say which line you mean. Threads started recording their side when we began posting PR comments to GitHub, which needs it. The diff viewer still placed everything by number alone, and local comments never recorded a side at all. So an agent told "line 12" about removed code would open the new file and read the wrong line 12.

## Decisions

We fixed where comments land and what they record together. Fixing only the viewer would have left the agent with the same ambiguity in the comments it gets back.

The comment form now takes where a comment is (file, line and side) as one value instead of separate optional fields. A form that knew the line but not the side would have saved a comment that points at the wrong line, and one value makes that impossible.

## What we learned

The test for this builds a diff where a line is replaced and checks that each thread shows under its own line. We ran it against the old code first to confirm it fails there, with both threads under the deleted line. A test that passes on the broken code doesn't prove the fix.
