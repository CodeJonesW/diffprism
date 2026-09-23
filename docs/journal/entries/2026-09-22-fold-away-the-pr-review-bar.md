---
title: Fold away the PR review bar while you read
date: 2026-09-22
kind: feature
pr: 220
---

## What changed

The bar at the bottom of a pull request review — the summary box, the threads to post, Approve, Comment and the rest — now folds down to a single line. Click the line to fold it, click again to bring it back. The line still says where the review goes: `Submit your review to GitHub as @you · owner/repo#7`. DiffPrism remembers whether you left it folded, so the next PR review opens the same way.

## Why

The bar took about a fifth of the screen for the whole review, and you only need it at the end. Everything above it — the diff — is what you're there to read.

## Decisions

Folding hides the controls, not what's in them. A summary you've started, or threads you've ticked to post, are still there when you open the bar again.

The bar folds rather than resizes. The side panels can be dragged to any width, but a form has one useful size: big enough to use. So it's open or it's out of the way.
