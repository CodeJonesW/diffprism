---
title: An approved commit-gate review clears once the commit lands
date: 2026-09-27
kind: fix
---

## What changed

When you approve a commit-gate review, the commit goes in and the review now leaves the session list straight away. Any review you've decided goes the same way once its changes are no longer there to review: committed, or dropped.

## Why

After approving, the review stayed in the sidebar marked **Approved**. Opened, it showed "0 files changed" with Approve and Request Changes still at the bottom, asking for a verdict on nothing. It only went away when a five-minute expiry, counted from when the review opened, got to it.

That happened because the review kept watching the staged diff after the decision. Once the commit landed, the staged diff was empty, and the review showed that.

## Decisions

**An empty diff after a decision means the review is done.** Before the decision, an empty diff is left alone: you might still be reading it, or the agent might stage something new. After the decision, the only way the diff empties is that the change was committed, or thrown away. Either way, nothing is waiting on the review any more.
