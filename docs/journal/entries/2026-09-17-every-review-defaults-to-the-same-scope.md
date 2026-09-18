---
title: Every review defaults to the same scope
date: 2026-09-17
kind: decision
pr: 169
---

## What changed

Every interactive way to open a review now defaults to the same scope: the working copy. That covers `diffprism review`, Open Project in the dashboard, and the MCP tools `open_review`, `get_diff` and `analyze_diff`. The MCP tools used to require a scope. The commit gate still reviews staged changes, and now says why.

The skill, README and setup docs each have a Choosing a scope table.

## Why

Scope is carried by one `diff_ref` string, and each entry point picked its own default. The dashboard hardcoded the working copy. The MCP tools made the caller choose.

## Decisions

The default lives in one place in core. Including `get_diff` and `analyze_diff` matters: an agent's self-review and the human review it leads to should look at the same diff.

The commit gate reviews `staged` because a commit contains exactly the index. Unstaged edits aren't part of what gets approved.

The dashboard can't import core. Our first version copied the default into the dashboard and added a test to check the two matched. That test only passed because the test runner doesn't typecheck. Instead of working around that, the server now reports its default on the status endpoint the dashboard already calls. The scope picker stays disabled until the answer arrives. There is no copy to drift.

## What we learned

Comparing against another ref overwrote the session's ref. So "reset" in the ref picker had nothing to go back to and always chose the working copy. For a staged commit-gate review, reset showed edits the commit didn't include. Sessions now remember the ref they were opened with, and the server decides where reset goes, since it's the only place that still knows.
